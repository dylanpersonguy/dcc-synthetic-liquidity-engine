// ============================================================================
// @dcc/database — Escrow Schema Definitions
// ============================================================================
// DDL for the Execution Escrow + Finalization + Refund system.
// Applied by the migration runner after core and relayer schemas.
// ============================================================================

export const ESCROW_SCHEMA_SQL = `
-- ============================================================================
-- ESCROW ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE escrow_execution_status AS ENUM (
    'created', 'funds_locked', 'route_locked',
    'local_leg_executed', 'external_leg_pending', 'external_leg_confirmed',
    'delivery_pending', 'completed', 'partially_completed',
    'failed', 'refunded', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE escrow_execution_mode AS ENUM (
    'LOCAL', 'TELEPORT', 'SYNTHETIC', 'REDEEMABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ESCROW INTENTS — primary escrow records
-- ============================================================================

CREATE TABLE IF NOT EXISTS escrow_intents (
  execution_id         TEXT PRIMARY KEY,
  user_address         TEXT NOT NULL,
  pair_id              TEXT NOT NULL,
  input_asset          TEXT NOT NULL,
  output_asset         TEXT NOT NULL,
  amount_in            NUMERIC NOT NULL,
  expected_amount_out  NUMERIC NOT NULL,
  min_amount_out       NUMERIC NOT NULL,
  actual_amount_out    NUMERIC,
  status               escrow_execution_status NOT NULL DEFAULT 'created',
  route_plan_hash      TEXT NOT NULL,
  execution_mode       escrow_execution_mode NOT NULL,
  relayer_id           TEXT,
  nonce                INTEGER NOT NULL,
  escrow_tx_id         TEXT,
  refund_tx_id         TEXT,
  completion_tx_id     TEXT,
  refund_amount        NUMERIC,
  proof_data           TEXT,
  failure_reason       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  settled_at           TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_intents(status);
CREATE INDEX IF NOT EXISTS idx_escrow_user ON escrow_intents(user_address);
CREATE INDEX IF NOT EXISTS idx_escrow_pair ON escrow_intents(pair_id);
CREATE INDEX IF NOT EXISTS idx_escrow_relayer ON escrow_intents(relayer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_created ON escrow_intents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_expires ON escrow_intents(expires_at);
CREATE INDEX IF NOT EXISTS idx_escrow_status_expires ON escrow_intents(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_escrow_user_nonce ON escrow_intents(user_address, nonce);

-- ============================================================================
-- ESCROW TRANSITIONS — audit log of all state transitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS escrow_transitions (
  id                   BIGSERIAL PRIMARY KEY,
  execution_id         TEXT NOT NULL REFERENCES escrow_intents(execution_id),
  from_status          escrow_execution_status,
  to_status            escrow_execution_status NOT NULL,
  triggered_by         TEXT NOT NULL,
  reason               TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_trans_exec ON escrow_transitions(execution_id);
CREATE INDEX IF NOT EXISTS idx_escrow_trans_created ON escrow_transitions(created_at DESC);

-- ============================================================================
-- ESCROW EVENTS — structured event log
-- ============================================================================

CREATE TABLE IF NOT EXISTS escrow_events (
  id                   BIGSERIAL PRIMARY KEY,
  event_type           TEXT NOT NULL,
  execution_id         TEXT NOT NULL REFERENCES escrow_intents(execution_id),
  user_address         TEXT NOT NULL,
  pair_id              TEXT NOT NULL,
  amount_in            NUMERIC NOT NULL,
  amount_out           NUMERIC,
  refund_amount        NUMERIC,
  relayer_id           TEXT,
  proof_data           TEXT,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_events_exec ON escrow_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_escrow_events_type ON escrow_events(event_type);
CREATE INDEX IF NOT EXISTS idx_escrow_events_created ON escrow_events(created_at DESC);

-- ============================================================================
-- RELAYER CONFIRMATIONS — relayer-submitted proof of external execution
-- ============================================================================

CREATE TABLE IF NOT EXISTS relayer_confirmations (
  id                   BIGSERIAL PRIMARY KEY,
  execution_id         TEXT NOT NULL REFERENCES escrow_intents(execution_id),
  relayer_id           TEXT NOT NULL,
  actual_amount_out    NUMERIC NOT NULL,
  tx_hash              TEXT NOT NULL,
  chain                TEXT NOT NULL,
  proof_data           TEXT NOT NULL,
  signature            TEXT NOT NULL,
  verified             BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relayer_conf_exec ON relayer_confirmations(execution_id);
CREATE INDEX IF NOT EXISTS idx_relayer_conf_relayer ON relayer_confirmations(relayer_id);
CREATE INDEX IF NOT EXISTS idx_relayer_conf_tx ON relayer_confirmations(tx_hash);

-- ============================================================================
-- ESCROW METRICS — time-series aggregates
-- ============================================================================

CREATE TABLE IF NOT EXISTS escrow_metrics (
  id                   BIGSERIAL PRIMARY KEY,
  bucket               TIMESTAMPTZ NOT NULL,
  total_created        INTEGER NOT NULL DEFAULT 0,
  total_completed      INTEGER NOT NULL DEFAULT 0,
  total_failed         INTEGER NOT NULL DEFAULT 0,
  total_refunded       INTEGER NOT NULL DEFAULT 0,
  total_expired        INTEGER NOT NULL DEFAULT 0,
  total_partial        INTEGER NOT NULL DEFAULT 0,
  total_volume_in      NUMERIC NOT NULL DEFAULT 0,
  total_volume_out     NUMERIC NOT NULL DEFAULT 0,
  total_refund_volume  NUMERIC NOT NULL DEFAULT 0,
  avg_settlement_ms    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bucket)
);

CREATE INDEX IF NOT EXISTS idx_escrow_metrics_bucket ON escrow_metrics(bucket DESC);
`;
