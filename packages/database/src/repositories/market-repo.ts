import { getPool } from '../connection.js';

// ============================================================================
// Market Repository
// ============================================================================

export interface MarketRow {
  pair_id: string;
  base_asset: string;
  quote_asset: string;
  base_chain: string;
  quote_chain: string;
  mode: string;
  status: string;
  risk_tier: string;
  circuit_breaker: string;
  daily_volume_cap: string | null;
  per_trade_cap: string | null;
  min_trade_size: string | null;
  external_sources: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface MarketFilter {
  status?: string;
  mode?: string;
  riskTier?: string;
}

export const marketRepo = {
  async findAll(filter?: MarketFilter): Promise<MarketRow[]> {
    const pool = getPool();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter?.mode) {
      conditions.push(`mode = $${idx++}`);
      params.push(filter.mode);
    }
    if (filter?.riskTier) {
      conditions.push(`risk_tier = $${idx++}`);
      params.push(filter.riskTier);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<MarketRow>(
      `SELECT * FROM markets ${where} ORDER BY pair_id`,
      params,
    );
    return result.rows;
  },

  async findById(pairId: string): Promise<MarketRow | null> {
    const pool = getPool();
    const result = await pool.query<MarketRow>(
      'SELECT * FROM markets WHERE pair_id = $1',
      [pairId],
    );
    return result.rows[0] ?? null;
  },

  async upsert(market: Omit<MarketRow, 'created_at' | 'updated_at'>): Promise<MarketRow> {
    const pool = getPool();
    const result = await pool.query<MarketRow>(
      `INSERT INTO markets (
        pair_id, base_asset, quote_asset, base_chain, quote_chain,
        mode, status, risk_tier, circuit_breaker,
        daily_volume_cap, per_trade_cap, min_trade_size,
        external_sources, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (pair_id) DO UPDATE SET
        base_asset = EXCLUDED.base_asset,
        quote_asset = EXCLUDED.quote_asset,
        base_chain = EXCLUDED.base_chain,
        quote_chain = EXCLUDED.quote_chain,
        mode = EXCLUDED.mode,
        status = EXCLUDED.status,
        risk_tier = EXCLUDED.risk_tier,
        circuit_breaker = EXCLUDED.circuit_breaker,
        daily_volume_cap = EXCLUDED.daily_volume_cap,
        per_trade_cap = EXCLUDED.per_trade_cap,
        min_trade_size = EXCLUDED.min_trade_size,
        external_sources = EXCLUDED.external_sources,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *`,
      [
        market.pair_id, market.base_asset, market.quote_asset,
        market.base_chain, market.quote_chain, market.mode,
        market.status, market.risk_tier, market.circuit_breaker,
        market.daily_volume_cap, market.per_trade_cap, market.min_trade_size,
        JSON.stringify(market.external_sources), JSON.stringify(market.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async updateStatus(pairId: string, status: string): Promise<MarketRow | null> {
    const pool = getPool();
    const result = await pool.query<MarketRow>(
      'UPDATE markets SET status = $2, updated_at = NOW() WHERE pair_id = $1 RETURNING *',
      [pairId, status],
    );
    return result.rows[0] ?? null;
  },

  async updateCircuitBreaker(pairId: string, level: string): Promise<MarketRow | null> {
    const pool = getPool();
    const result = await pool.query<MarketRow>(
      'UPDATE markets SET circuit_breaker = $2, updated_at = NOW() WHERE pair_id = $1 RETURNING *',
      [pairId, level],
    );
    return result.rows[0] ?? null;
  },

  async count(): Promise<Record<string, number>> {
    const pool = getPool();
    const result = await pool.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM markets GROUP BY status',
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  },
};
