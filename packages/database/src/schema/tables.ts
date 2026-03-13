// ============================================================================
// @dcc/database — PostgreSQL Schema Definitions
// ============================================================================
// All DDL statements for the operator backend. Executed by the migration runner.
// Tables designed for production: indexes on hot paths, JSONB for flexible
// metadata, explicit status enums, composite indexes for common query patterns.
// ============================================================================

export const SCHEMA_SQL = `
-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE execution_status AS ENUM (
    'quote_created', 'route_locked',
    'local_leg_pending', 'local_leg_complete',
    'external_leg_pending', 'external_leg_complete',
    'awaiting_delivery', 'completed',
    'partially_filled', 'failed', 'refunded', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE market_status AS ENUM (
    'active', 'quote_only', 'paused', 'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE market_mode AS ENUM (
    'native', 'synthetic', 'teleport', 'redeemable'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE risk_tier AS ENUM (
    'tier_1', 'tier_2', 'tier_3', 'tier_4'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE venue_health_status AS ENUM (
    'healthy', 'degraded', 'down'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE relayer_status AS ENUM (
    'active', 'degraded', 'paused', 'offline'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM (
    'info', 'warning', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE circuit_breaker_level AS ENUM (
    'none', 'soft_pause', 'hard_pause'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE leg_status AS ENUM (
    'pending', 'submitted', 'confirmed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- MARKETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS markets (
  pair_id            TEXT PRIMARY KEY,
  base_asset_id      TEXT NOT NULL,
  quote_asset_id     TEXT NOT NULL,
  base_symbol        TEXT NOT NULL,
  quote_symbol       TEXT NOT NULL,
  primary_mode       market_mode NOT NULL DEFAULT 'native',
  supported_modes    market_mode[] NOT NULL DEFAULT '{}',
  status             market_status NOT NULL DEFAULT 'active',
  risk_tier          risk_tier NOT NULL DEFAULT 'tier_2',
  circuit_breaker    circuit_breaker_level NOT NULL DEFAULT 'none',
  max_trade_size     NUMERIC,
  max_daily_volume   NUMERIC,
  local_pool_id      TEXT,
  local_book_id      TEXT,
  synthetic_asset_id TEXT,
  external_sources   JSONB NOT NULL DEFAULT '[]',
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_mode ON markets(primary_mode);

-- ============================================================================
-- EXECUTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS executions (
  execution_id           TEXT PRIMARY KEY,
  route_id               TEXT NOT NULL,
  quote_id               TEXT NOT NULL,
  pair_id                TEXT NOT NULL REFERENCES markets(pair_id),
  mode                   market_mode NOT NULL,
  user_address           TEXT NOT NULL,
  input_asset            TEXT NOT NULL,
  output_asset           TEXT NOT NULL,
  amount_in              NUMERIC NOT NULL,
  expected_amount_out    NUMERIC NOT NULL,
  actual_amount_out      NUMERIC,
  status                 execution_status NOT NULL DEFAULT 'quote_created',
  relayer_id             TEXT,
  settlement_mode        TEXT,
  failure_reason         TEXT,
  refund_eligible        BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_at            TIMESTAMPTZ,
  escrow_address         TEXT,
  escrow_expires_at      TIMESTAMPTZ,
  delivery_tx_hash       TEXT,
  metadata               JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_pair ON executions(pair_id);
CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_address);
CREATE INDEX IF NOT EXISTS idx_executions_relayer ON executions(relayer_id);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status_created ON executions(status, created_at DESC);

-- ============================================================================
-- EXECUTION LEGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_legs (
  id                 BIGSERIAL PRIMARY KEY,
  execution_id       TEXT NOT NULL REFERENCES executions(execution_id),
  leg_index          SMALLINT NOT NULL,
  venue_id           TEXT NOT NULL,
  venue_name         TEXT NOT NULL,
  chain              TEXT NOT NULL,
  settlement_mode    TEXT,
  token_in           TEXT NOT NULL,
  token_out          TEXT NOT NULL,
  amount_in          NUMERIC NOT NULL,
  expected_amount_out NUMERIC NOT NULL,
  actual_amount_out  NUMERIC,
  fee_estimate       NUMERIC,
  status             leg_status NOT NULL DEFAULT 'pending',
  tx_hash            TEXT,
  submitted_at       TIMESTAMPTZ,
  confirmed_at       TIMESTAMPTZ,
  failure_reason     TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(execution_id, leg_index)
);

CREATE INDEX IF NOT EXISTS idx_legs_execution ON execution_legs(execution_id);
CREATE INDEX IF NOT EXISTS idx_legs_status ON execution_legs(status);

-- ============================================================================
-- EXECUTION STATE TRANSITIONS (audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_transitions (
  id                BIGSERIAL PRIMARY KEY,
  execution_id      TEXT NOT NULL REFERENCES executions(execution_id),
  from_status       execution_status,
  to_status         execution_status NOT NULL,
  reason            TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transitions_execution ON execution_transitions(execution_id);
CREATE INDEX IF NOT EXISTS idx_transitions_created ON execution_transitions(created_at DESC);

-- ============================================================================
-- ROUTE PLANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_plans (
  route_id             TEXT PRIMARY KEY,
  quote_id             TEXT NOT NULL,
  pair_id              TEXT NOT NULL REFERENCES markets(pair_id),
  mode                 market_mode NOT NULL,
  input_asset          TEXT NOT NULL,
  output_asset         TEXT NOT NULL,
  input_amount         NUMERIC NOT NULL,
  expected_output      NUMERIC NOT NULL,
  min_output           NUMERIC NOT NULL,
  legs                 JSONB NOT NULL DEFAULT '[]',
  score                JSONB NOT NULL DEFAULT '{}',
  requires_escrow      BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_settlement_ms INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_pair ON route_plans(pair_id);
CREATE INDEX IF NOT EXISTS idx_routes_created ON route_plans(created_at DESC);

-- ============================================================================
-- RELAYERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS relayers (
  relayer_id           TEXT PRIMARY KEY,
  status               relayer_status NOT NULL DEFAULT 'active',
  supported_chains     TEXT[] NOT NULL DEFAULT '{}',
  total_inventory_usd  NUMERIC NOT NULL DEFAULT 0,
  total_exposure_usd   NUMERIC NOT NULL DEFAULT 0,
  active_executions    INTEGER NOT NULL DEFAULT 0,
  completed_24h        INTEGER NOT NULL DEFAULT 0,
  failed_24h           INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms       INTEGER NOT NULL DEFAULT 0,
  last_heartbeat       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RELAYER INVENTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS relayer_inventory (
  id                   BIGSERIAL PRIMARY KEY,
  relayer_id           TEXT NOT NULL REFERENCES relayers(relayer_id),
  asset                TEXT NOT NULL,
  chain                TEXT NOT NULL,
  amount               NUMERIC NOT NULL DEFAULT 0,
  reserved_amount      NUMERIC NOT NULL DEFAULT 0,
  available_amount     NUMERIC NOT NULL DEFAULT 0,
  amount_usd           NUMERIC NOT NULL DEFAULT 0,
  last_updated         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(relayer_id, asset, chain)
);

CREATE INDEX IF NOT EXISTS idx_inventory_relayer ON relayer_inventory(relayer_id);

-- ============================================================================
-- VENUE HEALTH
-- ============================================================================

CREATE TABLE IF NOT EXISTS venue_health (
  venue_id             TEXT PRIMARY KEY,
  venue_type           TEXT NOT NULL,
  venue_name           TEXT NOT NULL,
  health               venue_health_status NOT NULL DEFAULT 'healthy',
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  last_quote_at        TIMESTAMPTZ,
  error_count_24h      INTEGER NOT NULL DEFAULT 0,
  quotes_served_24h    INTEGER NOT NULL DEFAULT 0,
  success_rate_24h     NUMERIC NOT NULL DEFAULT 1.0,
  uptime_24h           NUMERIC NOT NULL DEFAULT 1.0,
  supported_pairs      TEXT[] NOT NULL DEFAULT '{}',
  connection_healthy   BOOLEAN NOT NULL DEFAULT TRUE,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- MARKET HEALTH
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_health (
  pair_id              TEXT PRIMARY KEY REFERENCES markets(pair_id),
  health_score         NUMERIC NOT NULL DEFAULT 1.0,
  local_liquidity_usd  NUMERIC NOT NULL DEFAULT 0,
  external_liquidity_usd NUMERIC NOT NULL DEFAULT 0,
  route_success_rate   NUMERIC NOT NULL DEFAULT 1.0,
  venue_health_avg     NUMERIC NOT NULL DEFAULT 1.0,
  relayer_coverage     BOOLEAN NOT NULL DEFAULT TRUE,
  synthetic_exposure_pct NUMERIC NOT NULL DEFAULT 0,
  stale_sources        INTEGER NOT NULL DEFAULT 0,
  total_sources        INTEGER NOT NULL DEFAULT 0,
  volume_24h           NUMERIC NOT NULL DEFAULT 0,
  executions_24h       INTEGER NOT NULL DEFAULT 0,
  failed_24h           INTEGER NOT NULL DEFAULT 0,
  factors              JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SYNTHETIC EXPOSURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS synthetic_exposure (
  synthetic_asset_id   TEXT PRIMARY KEY,
  symbol               TEXT NOT NULL,
  underlying_asset_id  TEXT NOT NULL,
  underlying_symbol    TEXT NOT NULL,
  total_supply         NUMERIC NOT NULL DEFAULT 0,
  supply_cap           NUMERIC NOT NULL DEFAULT 0,
  mark_price           NUMERIC NOT NULL DEFAULT 0,
  liability_value_usd  NUMERIC NOT NULL DEFAULT 0,
  backing_allocated_usd NUMERIC NOT NULL DEFAULT 0,
  backing_ratio        NUMERIC NOT NULL DEFAULT 1.0,
  is_redeemable        BOOLEAN NOT NULL DEFAULT FALSE,
  redemption_queue_size INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'active',
  metadata             JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RISK ALERTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_alerts (
  id                   TEXT PRIMARY KEY,
  severity             alert_severity NOT NULL DEFAULT 'info',
  category             TEXT NOT NULL,
  source_service       TEXT NOT NULL,
  message              TEXT NOT NULL,
  details              TEXT,
  pair_id              TEXT,
  venue_id             TEXT,
  relayer_id           TEXT,
  acknowledged         BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by      TEXT,
  acknowledged_at      TIMESTAMPTZ,
  resolved             BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at          TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_severity ON risk_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON risk_alerts(resolved, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON risk_alerts(category);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON risk_alerts(created_at DESC);

-- ============================================================================
-- PROTOCOL CONTROLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS protocol_controls (
  key                  TEXT PRIMARY KEY,
  value                JSONB NOT NULL,
  updated_by           TEXT,
  reason               TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default protocol controls
INSERT INTO protocol_controls (key, value) VALUES
  ('emergency_pause', 'false'::jsonb),
  ('global_circuit_breaker', '"none"'::jsonb),
  ('allowed_relayers', '[]'::jsonb),
  ('max_total_synthetic_notional', '"500000"'::jsonb),
  ('max_relayer_exposure', '"100000"'::jsonb),
  ('default_escrow_timeout_ms', '300000'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- EXECUTION METRICS (time-series aggregates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_metrics (
  id                   BIGSERIAL PRIMARY KEY,
  pair_id              TEXT NOT NULL,
  bucket               TIMESTAMPTZ NOT NULL,
  total_executions     INTEGER NOT NULL DEFAULT 0,
  successful           INTEGER NOT NULL DEFAULT 0,
  failed               INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms       INTEGER NOT NULL DEFAULT 0,
  p95_latency_ms       INTEGER NOT NULL DEFAULT 0,
  total_volume_in      NUMERIC NOT NULL DEFAULT 0,
  total_volume_out     NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(pair_id, bucket)
);

CREATE INDEX IF NOT EXISTS idx_exec_metrics_bucket ON execution_metrics(bucket DESC);
CREATE INDEX IF NOT EXISTS idx_exec_metrics_pair ON execution_metrics(pair_id, bucket DESC);

-- ============================================================================
-- ROUTE METRICS (time-series aggregates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_metrics (
  id                   BIGSERIAL PRIMARY KEY,
  pair_id              TEXT NOT NULL,
  mode                 market_mode NOT NULL,
  bucket               TIMESTAMPTZ NOT NULL,
  routes_planned       INTEGER NOT NULL DEFAULT 0,
  routes_executed      INTEGER NOT NULL DEFAULT 0,
  routes_failed        INTEGER NOT NULL DEFAULT 0,
  avg_legs             NUMERIC NOT NULL DEFAULT 1,
  avg_score            NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(pair_id, mode, bucket)
);

CREATE INDEX IF NOT EXISTS idx_route_metrics_bucket ON route_metrics(bucket DESC);

-- ============================================================================
-- CONNECTOR HEALTH (per-venue per-pair snapshots)
-- ============================================================================

CREATE TABLE IF NOT EXISTS connector_health (
  id                   BIGSERIAL PRIMARY KEY,
  venue_id             TEXT NOT NULL,
  pair_id              TEXT NOT NULL,
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  last_quote_at        TIMESTAMPTZ,
  quote_freshness      NUMERIC NOT NULL DEFAULT 1.0,
  error_rate           NUMERIC NOT NULL DEFAULT 0,
  is_stale             BOOLEAN NOT NULL DEFAULT FALSE,
  metadata             JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, pair_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_venue ON connector_health(venue_id);
`;
