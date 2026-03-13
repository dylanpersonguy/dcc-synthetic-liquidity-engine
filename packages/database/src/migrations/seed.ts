import { createPool, closePool, getPool } from '../connection.js';

const SEED_SQL = `
-- ============================================================================
-- Seed Data: Vertical Slice (DCC → SOL, DCC → USDC)
-- ============================================================================
-- Populates markets, relayers, venue health, and relayer inventory
-- so the system is immediately usable after migration.
-- All INSERTs use ON CONFLICT DO NOTHING for idempotency.
-- ============================================================================

-- Markets -------------------------------------------------------------------

INSERT INTO markets (pair_id, base_asset_id, quote_asset_id, base_symbol, quote_symbol,
  primary_mode, supported_modes, status, risk_tier, max_trade_size, max_daily_volume,
  local_pool_id, external_sources)
VALUES
  ('DCC/USDC', 'DCC', 'USDC', 'DCC', 'USDC',
   'native', '{native}', 'active', 'tier_1', 100000, 5000000,
   'dcc-amm-dcc-usdc', '[]'::jsonb),
  ('DCC/SOL', 'DCC', 'SOL', 'DCC', 'SOL',
   'teleport', '{teleport}', 'active', 'tier_2', 50000, 2000000,
   NULL, '[{"venue":"jupiter","pair":"SOL/USDC"},{"venue":"raydium","pair":"SOL/USDC"}]'::jsonb),
  ('USDC/SOL', 'USDC', 'SOL', 'USDC', 'SOL',
   'teleport', '{teleport}', 'active', 'tier_1', 100000, 10000000,
   NULL, '[{"venue":"jupiter","pair":"SOL/USDC"},{"venue":"raydium","pair":"SOL/USDC"}]'::jsonb)
ON CONFLICT (pair_id) DO NOTHING;

-- Relayers ------------------------------------------------------------------

INSERT INTO relayers (relayer_id, status, supported_chains, total_inventory_usd)
VALUES
  ('relayer-alpha', 'active', '{decentralchain,solana}', 250000),
  ('relayer-beta',  'active', '{decentralchain,solana}', 150000)
ON CONFLICT (relayer_id) DO NOTHING;

-- Relayer Inventory ---------------------------------------------------------

INSERT INTO relayer_inventory (relayer_id, asset, chain, amount, reserved_amount, available_amount, amount_usd)
VALUES
  ('relayer-alpha', 'DCC',  'decentralchain', 100000, 0, 100000, 85000),
  ('relayer-alpha', 'USDC', 'decentralchain', 50000,  0, 50000,  50000),
  ('relayer-alpha', 'USDC', 'solana',         50000,  0, 50000,  50000),
  ('relayer-alpha', 'SOL',  'solana',         500,    0, 500,    67750),
  ('relayer-beta',  'DCC',  'decentralchain', 80000,  0, 80000,  68000),
  ('relayer-beta',  'USDC', 'solana',         40000,  0, 40000,  40000),
  ('relayer-beta',  'SOL',  'solana',         300,    0, 300,    40650)
ON CONFLICT (relayer_id, asset, chain) DO NOTHING;

-- Venue Health --------------------------------------------------------------

INSERT INTO venue_health (venue_id, venue_type, venue_name, health, latency_ms,
  last_quote_at, quotes_served_24h, success_rate_24h, supported_pairs, connection_healthy)
VALUES
  ('dcc-amm',  'amm', 'DCC AMM',  'healthy', 12, NOW(), 5000, 0.998, '{DCC/USDC}',               true),
  ('jupiter',  'dex', 'Jupiter',   'healthy', 45, NOW(), 8000, 0.995, '{SOL/USDC,USDC/SOL}',      true),
  ('raydium',  'dex', 'Raydium',   'healthy', 38, NOW(), 6000, 0.993, '{SOL/USDC,USDC/SOL}',      true)
ON CONFLICT (venue_id) DO NOTHING;

-- Market Health -------------------------------------------------------------

INSERT INTO market_health (pair_id, health_score, local_liquidity_usd, external_liquidity_usd,
  route_success_rate, venue_health_avg, relayer_coverage, total_sources)
VALUES
  ('DCC/USDC', 0.95, 500000, 0,       0.99, 0.998, true, 1),
  ('DCC/SOL',  0.92, 500000, 1000000, 0.98, 0.994, true, 3),
  ('USDC/SOL', 0.97, 0,      1500000, 0.99, 0.994, true, 2)
ON CONFLICT (pair_id) DO NOTHING;
`;

async function runSeed() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('[seed] Connecting to database...');
  createPool({
    connectionString: databaseUrl,
    poolMin: 1,
    poolMax: 2,
  });

  const pool = getPool();

  try {
    console.log('[seed] Inserting seed data...');
    await pool.query(SEED_SQL);
    console.log('[seed] Seed data inserted successfully.');
  } catch (err) {
    console.error('[seed] Failed to insert seed data:', err);
    process.exit(1);
  } finally {
    await closePool();
    console.log('[seed] Connection closed.');
  }
}

runSeed();
