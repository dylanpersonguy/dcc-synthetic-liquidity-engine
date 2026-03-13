// ============================================================================
// Reconciliation Repository
// ============================================================================

import { getPool } from '../connection.js';

export interface ReconciliationRecordRow {
  id: string;
  job_id: string;
  execution_id: string;
  venue_id: string;
  chain: string;
  tx_hash: string | null;
  expected_amount_out: string;
  actual_amount_out: string | null;
  our_status: string;
  chain_status: string | null;
  status: string;
  mismatch_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

export const reconciliationRepo = {
  async create(record: {
    jobId: string;
    executionId: string;
    venueId: string;
    chain: string;
    txHash?: string;
    expectedAmountOut: string;
    actualAmountOut?: string;
    ourStatus: string;
    chainStatus?: string;
    status: string;
    mismatchReason?: string;
  }): Promise<ReconciliationRecordRow> {
    const pool = getPool();
    const { rows } = await pool.query<ReconciliationRecordRow>(
      `INSERT INTO reconciliation_records
        (job_id, execution_id, venue_id, chain, tx_hash, expected_amount_out,
         actual_amount_out, our_status, chain_status, status, mismatch_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [record.jobId, record.executionId, record.venueId, record.chain,
       record.txHash ?? null, record.expectedAmountOut, record.actualAmountOut ?? null,
       record.ourStatus, record.chainStatus ?? null, record.status,
       record.mismatchReason ?? null],
    );
    return rows[0]!;
  },

  async findByJobId(jobId: string): Promise<ReconciliationRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ReconciliationRecordRow>(
      'SELECT * FROM reconciliation_records WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId],
    );
    return rows;
  },

  async findMismatches(): Promise<ReconciliationRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ReconciliationRecordRow>(
      `SELECT * FROM reconciliation_records
       WHERE status IN ('mismatched', 'unresolved')
       ORDER BY created_at DESC
       LIMIT 100`,
    );
    return rows;
  },

  async resolve(id: string, resolvedBy: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE reconciliation_records
       SET status = 'resolved', resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, resolvedBy],
    );
  },

  async updateChainStatus(
    id: string,
    chainStatus: string,
    actualAmountOut: string | null,
    status: string,
    mismatchReason?: string,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE reconciliation_records
       SET chain_status = $2, actual_amount_out = $3, status = $4,
           mismatch_reason = $5, updated_at = NOW()
       WHERE id = $1`,
      [id, chainStatus, actualAmountOut, status, mismatchReason ?? null],
    );
  },

  async getPendingReconciliations(): Promise<ReconciliationRecordRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ReconciliationRecordRow>(
      `SELECT * FROM reconciliation_records
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 100`,
    );
    return rows;
  },

  async countByStatus(): Promise<Record<string, number>> {
    const pool = getPool();
    const { rows } = await pool.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM reconciliation_records GROUP BY status',
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = parseInt(row.count, 10);
    }
    return result;
  },
};
