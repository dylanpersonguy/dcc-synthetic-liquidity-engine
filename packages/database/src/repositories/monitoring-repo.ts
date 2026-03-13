import { getPool } from '../connection.js';

// ============================================================================
// Market Health Repository
// ============================================================================

export interface MarketHealthRow {
  pair_id: string;
  health_score: string;
  local_liquidity_usd: string;
  external_liquidity_usd: string;
  route_success_rate_24h: string;
  avg_execution_time_ms: number;
  active_venues: number;
  relayer_coverage: string;
  synthetic_utilization: string;
  factors: Record<string, unknown>;
  updated_at: Date;
}

export const marketHealthRepo = {
  async findAll(): Promise<MarketHealthRow[]> {
    const pool = getPool();
    const result = await pool.query<MarketHealthRow>(
      'SELECT * FROM market_health ORDER BY health_score ASC',
    );
    return result.rows;
  },

  async findById(pairId: string): Promise<MarketHealthRow | null> {
    const pool = getPool();
    const result = await pool.query<MarketHealthRow>(
      'SELECT * FROM market_health WHERE pair_id = $1',
      [pairId],
    );
    return result.rows[0] ?? null;
  },

  async upsert(health: MarketHealthRow): Promise<MarketHealthRow> {
    const pool = getPool();
    const result = await pool.query<MarketHealthRow>(
      `INSERT INTO market_health (
        pair_id, health_score, local_liquidity_usd, external_liquidity_usd,
        route_success_rate_24h, avg_execution_time_ms, active_venues,
        relayer_coverage, synthetic_utilization, factors
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (pair_id) DO UPDATE SET
        health_score = EXCLUDED.health_score,
        local_liquidity_usd = EXCLUDED.local_liquidity_usd,
        external_liquidity_usd = EXCLUDED.external_liquidity_usd,
        route_success_rate_24h = EXCLUDED.route_success_rate_24h,
        avg_execution_time_ms = EXCLUDED.avg_execution_time_ms,
        active_venues = EXCLUDED.active_venues,
        relayer_coverage = EXCLUDED.relayer_coverage,
        synthetic_utilization = EXCLUDED.synthetic_utilization,
        factors = EXCLUDED.factors,
        updated_at = NOW()
      RETURNING *`,
      [
        health.pair_id, health.health_score, health.local_liquidity_usd,
        health.external_liquidity_usd, health.route_success_rate_24h,
        health.avg_execution_time_ms, health.active_venues,
        health.relayer_coverage, health.synthetic_utilization,
        JSON.stringify(health.factors),
      ],
    );
    return result.rows[0]!;
  },
};

// ============================================================================
// Synthetic Exposure Repository
// ============================================================================

export interface SyntheticExposureRow {
  synthetic_asset_id: string;
  asset_name: string;
  current_supply: string;
  max_supply_cap: string;
  collateral_ratio: string;
  mark_price: string;
  backing_ratio: string;
  redeemable_value: string;
  net_exposure_usd: string;
  redemption_queue_size: number;
  metadata: Record<string, unknown>;
  updated_at: Date;
}

export const syntheticExposureRepo = {
  async findAll(): Promise<SyntheticExposureRow[]> {
    const pool = getPool();
    const result = await pool.query<SyntheticExposureRow>(
      'SELECT * FROM synthetic_exposure ORDER BY synthetic_asset_id',
    );
    return result.rows;
  },

  async findById(syntheticAssetId: string): Promise<SyntheticExposureRow | null> {
    const pool = getPool();
    const result = await pool.query<SyntheticExposureRow>(
      'SELECT * FROM synthetic_exposure WHERE synthetic_asset_id = $1',
      [syntheticAssetId],
    );
    return result.rows[0] ?? null;
  },

  async upsert(exposure: SyntheticExposureRow): Promise<SyntheticExposureRow> {
    const pool = getPool();
    const result = await pool.query<SyntheticExposureRow>(
      `INSERT INTO synthetic_exposure (
        synthetic_asset_id, asset_name, current_supply, max_supply_cap,
        collateral_ratio, mark_price, backing_ratio, redeemable_value,
        net_exposure_usd, redemption_queue_size, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (synthetic_asset_id) DO UPDATE SET
        asset_name = EXCLUDED.asset_name,
        current_supply = EXCLUDED.current_supply,
        max_supply_cap = EXCLUDED.max_supply_cap,
        collateral_ratio = EXCLUDED.collateral_ratio,
        mark_price = EXCLUDED.mark_price,
        backing_ratio = EXCLUDED.backing_ratio,
        redeemable_value = EXCLUDED.redeemable_value,
        net_exposure_usd = EXCLUDED.net_exposure_usd,
        redemption_queue_size = EXCLUDED.redemption_queue_size,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *`,
      [
        exposure.synthetic_asset_id, exposure.asset_name,
        exposure.current_supply, exposure.max_supply_cap,
        exposure.collateral_ratio, exposure.mark_price,
        exposure.backing_ratio, exposure.redeemable_value,
        exposure.net_exposure_usd, exposure.redemption_queue_size,
        JSON.stringify(exposure.metadata),
      ],
    );
    return result.rows[0]!;
  },
};
