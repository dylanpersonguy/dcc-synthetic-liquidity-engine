import { getPool } from '../connection.js';

// ============================================================================
// Relayer Repository
// ============================================================================

export interface RelayerRow {
  relayer_id: string;
  name: string;
  status: string;
  supported_chains: string[];
  total_inventory_usd: string;
  total_exposure_usd: string;
  active_jobs: number;
  success_rate_24h: string;
  avg_latency_ms: number;
  error_rate_1h: string;
  last_heartbeat: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface RelayerInventoryRow {
  id: number;
  relayer_id: string;
  asset: string;
  chain: string;
  balance: string;
  reserved: string;
  available: string;
  last_rebalanced_at: Date | null;
  updated_at: Date;
}

export const relayerRepo = {
  async findAll(): Promise<RelayerRow[]> {
    const pool = getPool();
    const result = await pool.query<RelayerRow>(
      'SELECT * FROM relayers ORDER BY relayer_id',
    );
    return result.rows;
  },

  async findById(relayerId: string): Promise<RelayerRow | null> {
    const pool = getPool();
    const result = await pool.query<RelayerRow>(
      'SELECT * FROM relayers WHERE relayer_id = $1',
      [relayerId],
    );
    return result.rows[0] ?? null;
  },

  async upsert(relayer: Omit<RelayerRow, 'created_at' | 'updated_at'>): Promise<RelayerRow> {
    const pool = getPool();
    const result = await pool.query<RelayerRow>(
      `INSERT INTO relayers (
        relayer_id, name, status, supported_chains,
        total_inventory_usd, total_exposure_usd, active_jobs,
        success_rate_24h, avg_latency_ms, error_rate_1h,
        last_heartbeat, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (relayer_id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        supported_chains = EXCLUDED.supported_chains,
        total_inventory_usd = EXCLUDED.total_inventory_usd,
        total_exposure_usd = EXCLUDED.total_exposure_usd,
        active_jobs = EXCLUDED.active_jobs,
        success_rate_24h = EXCLUDED.success_rate_24h,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        error_rate_1h = EXCLUDED.error_rate_1h,
        last_heartbeat = EXCLUDED.last_heartbeat,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *`,
      [
        relayer.relayer_id, relayer.name, relayer.status,
        relayer.supported_chains, relayer.total_inventory_usd,
        relayer.total_exposure_usd, relayer.active_jobs,
        relayer.success_rate_24h, relayer.avg_latency_ms,
        relayer.error_rate_1h, relayer.last_heartbeat,
        JSON.stringify(relayer.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async updateHeartbeat(relayerId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE relayers SET last_heartbeat = NOW(), updated_at = NOW() WHERE relayer_id = $1',
      [relayerId],
    );
  },

  async updateStatus(relayerId: string, status: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE relayers SET status = $2, updated_at = NOW() WHERE relayer_id = $1',
      [relayerId, status],
    );
  },

  async getInventory(relayerId: string): Promise<RelayerInventoryRow[]> {
    const pool = getPool();
    const result = await pool.query<RelayerInventoryRow>(
      'SELECT * FROM relayer_inventory WHERE relayer_id = $1 ORDER BY asset, chain',
      [relayerId],
    );
    return result.rows;
  },

  async upsertInventory(item: Omit<RelayerInventoryRow, 'id' | 'updated_at'>): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO relayer_inventory (
        relayer_id, asset, chain, balance, reserved, available, last_rebalanced_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (relayer_id, asset, chain) DO UPDATE SET
        balance = EXCLUDED.balance,
        reserved = EXCLUDED.reserved,
        available = EXCLUDED.available,
        last_rebalanced_at = COALESCE(EXCLUDED.last_rebalanced_at, relayer_inventory.last_rebalanced_at),
        updated_at = NOW()`,
      [
        item.relayer_id, item.asset, item.chain,
        item.balance, item.reserved, item.available,
        item.last_rebalanced_at,
      ],
    );
  },
};
