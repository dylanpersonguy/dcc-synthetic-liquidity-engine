// ============================================================================
// Hedge Record Repository
// ============================================================================

import { getPool } from '../connection.js';

export interface HedgeRecordRow {
  id: string;
  job_id: string;
  execution_id: string;
  asset: string;
  chain: string;
  exposure_amount: string;
  hedged_amount: string;
  residual_amount: string;
  hedge_type: string;
  hedge_tx_hash: string | null;
  hedge_venue_id: string | null;
  is_fully_hedged: boolean;
  requires_rebalance: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const hedgeRepo = {
  async create(record: {
    jobId: string;
    executionId: string;
    asset: string;
    chain: string;
    exposureAmount: string;
    hedgedAmount: string;
    residualAmount: string;
    hedgeType: string;
    hedgeTxHash?: string;
    hedgeVenueId?: string;
    isFullyHedged: boolean;
    requiresRebalance: boolean;
    notes?: string;
  }): Promise<HedgeRecordRow> {
    const pool = getPool();
    const { rows } = await pool.query<HedgeRecordRow>(
      `INSERT INTO hedge_records
        (job_id, execution_id, asset, chain, exposure_amount, hedged_amount,
         residual_amount, hedge_type, hedge_tx_hash, hedge_venue_id,
         is_fully_hedged, requires_rebalance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [record.jobId, record.executionId, record.asset, record.chain,
       record.exposureAmount, record.hedgedAmount, record.residualAmount,
       record.hedgeType, record.hedgeTxHash ?? null, record.hedgeVenueId ?? null,
       record.isFullyHedged, record.requiresRebalance, record.notes ?? null],
    );
    return rows[0]!;
  },

  async findByJobId(jobId: string): Promise<HedgeRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<HedgeRecordRow>(
      'SELECT * FROM hedge_records WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId],
    );
    return rows;
  },

  async findByExecutionId(executionId: string): Promise<HedgeRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<HedgeRecordRow>(
      'SELECT * FROM hedge_records WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return rows;
  },

  async getUnhedgedResiduals(): Promise<HedgeRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<HedgeRecordRow>(
      `SELECT * FROM hedge_records
       WHERE requires_rebalance = TRUE AND is_fully_hedged = FALSE
       ORDER BY residual_amount DESC
       LIMIT 100`,
    );
    return rows;
  },

  async updateHedge(
    id: string,
    update: {
      hedgedAmount: string;
      residualAmount: string;
      hedgeTxHash?: string;
      isFullyHedged: boolean;
      requiresRebalance: boolean;
    },
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE hedge_records
       SET hedged_amount = $2, residual_amount = $3, hedge_tx_hash = $4,
           is_fully_hedged = $5, requires_rebalance = $6, updated_at = NOW()
       WHERE id = $1`,
      [id, update.hedgedAmount, update.residualAmount, update.hedgeTxHash ?? null,
       update.isFullyHedged, update.requiresRebalance],
    );
  },

  async getTotalResidualByAsset(): Promise<Array<{ asset: string; chain: string; total_residual: string }>> {
    const pool = getPool();
    const { rows } = await pool.query<{ asset: string; chain: string; total_residual: string }>(
      `SELECT asset, chain, SUM(residual_amount) as total_residual
       FROM hedge_records
       WHERE requires_rebalance = TRUE
       GROUP BY asset, chain
       ORDER BY total_residual DESC`,
    );
    return rows;
  },
};
