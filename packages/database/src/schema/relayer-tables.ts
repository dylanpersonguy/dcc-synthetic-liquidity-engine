// ============================================================================
// @dcc/database — Relayer Engine Schema Definitions
// ============================================================================
// Tables specific to the relayer execution subsystem. Applied after the core
// schema (tables.ts). Separate file to keep concerns clean.
// ============================================================================

export const RELAYER_SCHEMA_SQL = `
-- ============================================================================
-- RELAYER JOB STATUS ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE relayer_job_status AS ENUM (
    'received', 'validated', 'inventory_reserved', 'quote_refreshed',
    'ready_to_execute', 'submitting', 'submitted', 'awaiting_confirmation',
    'partially_filled', 'filled', 'delivery_pending', 'completed',
    'failed', 'timed_out', 'inventory_released', 'reconciled', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM (
    'active', 'released', 'consumed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_status AS ENUM (
    'pending', 'matched', 'mismatched', 'resolved', 'unresolved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- RELAYER JOBS (durable job records)
-- ============================================================================
-- Every execution job accepted by the relayer is recorded here.
-- The BullMQ queue handles transient delivery; this table is the audit log
-- and source of truth for job lifecycle.

CREATE TABLE IF NOT EXISTS relayer_jobs (
  job_id               TEXT PRIMARY KEY,
  execution_id         TEXT NOT NULL,
  route_id             TEXT NOT NULL,
  quote_id             TEXT NOT NULL,
  pair_id              TEXT NOT NULL,
  mode                 TEXT NOT NULL,
  input_asset          TEXT NOT NULL,
  output_asset         TEXT NOT NULL,
  amount_in            NUMERIC NOT NULL,
  expected_amount_out  NUMERIC NOT NULL,
  min_amount_out       NUMERIC NOT NULL,
  max_slippage_bps     INTEGER NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  delivery_mode        TEXT NOT NULL,
  risk_tier            TEXT NOT NULL,
  user_address         TEXT NOT NULL,
  destination_address  TEXT NOT NULL,
  destination_chain    TEXT NOT NULL,
  legs                 JSONB NOT NULL DEFAULT '[]',
  nonce                INTEGER NOT NULL,
  signature            TEXT NOT NULL,
  status               relayer_job_status NOT NULL DEFAULT 'received',
  attempts             INTEGER NOT NULL DEFAULT 0,
  max_attempts         INTEGER NOT NULL DEFAULT 3,
  last_error           TEXT,
  result               JSONB,
  reservation_id       TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  UNIQUE(execution_id)
);

CREATE INDEX IF NOT EXISTS idx_rjobs_status ON relayer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rjobs_pair ON relayer_jobs(pair_id);
CREATE INDEX IF NOT EXISTS idx_rjobs_created ON relayer_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rjobs_expires ON relayer_jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_rjobs_execution ON relayer_jobs(execution_id);
CREATE INDEX IF NOT EXISTS idx_rjobs_status_created ON relayer_jobs(status, created_at DESC);

-- ============================================================================
-- RELAYER ATTEMPTS (per-attempt records)
-- ============================================================================
-- Each retry of a job creates a new attempt record. This gives full visibility
-- into what happened on each try.

CREATE TABLE IF NOT EXISTS relayer_attempts (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  attempt_number       INTEGER NOT NULL,
  status               relayer_job_status NOT NULL,
  venue_id             TEXT,
  chain                TEXT,
  token_in             TEXT,
  token_out            TEXT,
  amount_in            NUMERIC,
  amount_out           NUMERIC,
  tx_hash              TEXT,
  quote_price          NUMERIC,
  executed_price       NUMERIC,
  slippage_bps         INTEGER,
  fees_paid            NUMERIC,
  gas_used             NUMERIC,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  duration_ms          INTEGER,
  metadata             JSONB NOT NULL DEFAULT '{}',
  UNIQUE(job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_attempts_job ON relayer_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON relayer_attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_venue ON relayer_attempts(venue_id);

-- ============================================================================
-- INVENTORY RESERVATIONS (explicit reservation tracking)
-- ============================================================================
-- Every execution reserves inventory before venue submission. Reservations
-- are released on completion, failure, or timeout. This prevents double-
-- spending of inventory.

CREATE TABLE IF NOT EXISTS inventory_reservations (
  reservation_id       TEXT PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  execution_id         TEXT NOT NULL,
  asset                TEXT NOT NULL,
  chain                TEXT NOT NULL,
  amount               NUMERIC NOT NULL,
  status               reservation_status NOT NULL DEFAULT 'active',
  reserved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at          TIMESTAMPTZ,
  consumed_at          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  release_reason       TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_reservations_job ON inventory_reservations(job_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON inventory_reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_asset_chain ON inventory_reservations(asset, chain, status);
CREATE INDEX IF NOT EXISTS idx_reservations_expires ON inventory_reservations(expires_at);

-- ============================================================================
-- EXTERNAL EXECUTIONS (venue execution records)
-- ============================================================================
-- Records the actual transaction submitted to external venues (Jupiter,
-- Uniswap, Raydium). One per leg per attempt.

CREATE TABLE IF NOT EXISTS external_executions (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  execution_id         TEXT NOT NULL,
  attempt_id           BIGINT REFERENCES relayer_attempts(id),
  leg_index            SMALLINT NOT NULL,
  venue_id             TEXT NOT NULL,
  chain                TEXT NOT NULL,
  token_in             TEXT NOT NULL,
  token_out            TEXT NOT NULL,
  amount_in            NUMERIC NOT NULL,
  expected_amount_out  NUMERIC NOT NULL,
  actual_amount_out    NUMERIC,
  quote_price          NUMERIC,
  executed_price       NUMERIC,
  slippage_bps         INTEGER,
  fees_paid            NUMERIC,
  gas_used             NUMERIC,
  tx_hash              TEXT,
  block_number         BIGINT,
  status               TEXT NOT NULL DEFAULT 'pending',
  error_message        TEXT,
  submitted_at         TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_exec_job ON external_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_ext_exec_execution ON external_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_ext_exec_venue ON external_executions(venue_id);
CREATE INDEX IF NOT EXISTS idx_ext_exec_tx ON external_executions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_ext_exec_status ON external_executions(status);

-- ============================================================================
-- HEDGE RECORDS (exposure tracking)
-- ============================================================================
-- In v1, the external execution itself IS the hedge. This table tracks
-- hedged vs residual exposure for each execution. Residuals are flagged
-- for manual or scheduled rebalancing.

CREATE TABLE IF NOT EXISTS hedge_records (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  execution_id         TEXT NOT NULL,
  asset                TEXT NOT NULL,
  chain                TEXT NOT NULL,
  exposure_amount      NUMERIC NOT NULL,
  hedged_amount        NUMERIC NOT NULL DEFAULT 0,
  residual_amount      NUMERIC NOT NULL DEFAULT 0,
  hedge_type           TEXT NOT NULL DEFAULT 'execution_fill',
  hedge_tx_hash        TEXT,
  hedge_venue_id       TEXT,
  is_fully_hedged      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_rebalance   BOOLEAN NOT NULL DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hedge_job ON hedge_records(job_id);
CREATE INDEX IF NOT EXISTS idx_hedge_execution ON hedge_records(execution_id);
CREATE INDEX IF NOT EXISTS idx_hedge_residual ON hedge_records(requires_rebalance) WHERE requires_rebalance = TRUE;

-- ============================================================================
-- RECONCILIATION RECORDS
-- ============================================================================
-- Periodic reconciliation compares our records against on-chain state.
-- Mismatches are flagged for investigation.

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  execution_id         TEXT NOT NULL,
  venue_id             TEXT NOT NULL,
  chain                TEXT NOT NULL,
  tx_hash              TEXT,
  expected_amount_out  NUMERIC NOT NULL,
  actual_amount_out    NUMERIC,
  our_status           TEXT NOT NULL,
  chain_status         TEXT,
  status               reconciliation_status NOT NULL DEFAULT 'pending',
  mismatch_reason      TEXT,
  resolved_by          TEXT,
  resolved_at          TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_job ON reconciliation_records(job_id);
CREATE INDEX IF NOT EXISTS idx_recon_status ON reconciliation_records(status);
CREATE INDEX IF NOT EXISTS idx_recon_mismatched ON reconciliation_records(status) WHERE status = 'mismatched';

-- ============================================================================
-- VENUE STATUS CACHE (venue availability snapshots)
-- ============================================================================
-- Cached venue status for quick availability checks during validation.
-- Updated by venue-health-monitor; read by execution-worker.

CREATE TABLE IF NOT EXISTS venue_status_cache (
  venue_id             TEXT PRIMARY KEY,
  chain                TEXT NOT NULL,
  is_available         BOOLEAN NOT NULL DEFAULT TRUE,
  is_degraded          BOOLEAN NOT NULL DEFAULT FALSE,
  avg_latency_ms       INTEGER NOT NULL DEFAULT 0,
  error_rate_1h        NUMERIC NOT NULL DEFAULT 0,
  last_successful_at   TIMESTAMPTZ,
  supported_pairs      TEXT[] NOT NULL DEFAULT '{}',
  metadata             JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RELAYER RISK LIMITS (per-venue, per-asset, per-market controls)
-- ============================================================================

CREATE TABLE IF NOT EXISTS relayer_risk_limits (
  id                   TEXT PRIMARY KEY,
  limit_type           TEXT NOT NULL,
  scope_key            TEXT NOT NULL,
  max_notional         NUMERIC NOT NULL,
  current_notional     NUMERIC NOT NULL DEFAULT 0,
  daily_budget         NUMERIC,
  daily_used           NUMERIC NOT NULL DEFAULT 0,
  daily_reset_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata             JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(limit_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_risk_limits_type ON relayer_risk_limits(limit_type, scope_key);

-- ============================================================================
-- RELAYER JOB TRANSITIONS (audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS relayer_job_transitions (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES relayer_jobs(job_id),
  from_status          relayer_job_status,
  to_status            relayer_job_status NOT NULL,
  reason               TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rjob_trans_job ON relayer_job_transitions(job_id);
CREATE INDEX IF NOT EXISTS idx_rjob_trans_created ON relayer_job_transitions(created_at DESC);
`;
