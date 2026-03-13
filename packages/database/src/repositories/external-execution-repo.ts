// ============================================================================
// External Execution Repository
// ============================================================================

import { getPool } from '../connection.js';

export interface ExternalExecutionRow {
  id: string;
  job_id: string;
  execution_id: string;
  attempt_id: string | null;
  leg_index: number;
  venue_id: string;
  chain: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  expected_amount_out: string;
  actual_amount_out: string | null;
  quote_price: string | null;
  executed_price: string | null;
  slippage_bps: number | null;
  fees_paid: string | null;
  gas_used: string | null;
  tx_hash: string | null;
  block_number: string | null;
  status: string;
  error_message: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  metadata: unknown;
  created_at: string;
}

export const externalExecutionRepo = {
  async create(exec: {
    jobId: string;
    executionId: string;
    attemptId?: string;
    legIndex: number;
    venueId: string;
    chain: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    expectedAmountOut: string;
  }): Promise<ExternalExecutionRow> {
    const pool = getPool();
    const { rows } = await pool.query<ExternalExecutionRow>(
      `INSERT INTO external_executions
        (job_id, execution_id, attempt_id, leg_index, venue_id, chain,
         token_in, token_out, amount_in, expected_amount_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [exec.jobId, exec.executionId, exec.attemptId ?? null, exec.legIndex,
       exec.venueId, exec.chain, exec.tokenIn, exec.tokenOut,
       exec.amountIn, exec.expectedAmountOut],
    );
    return rows[0]!;
  },

  async updateResult(
    id: string,
    result: {
      status: string;
      actualAmountOut?: string;
      executedPrice?: string;
      slippageBps?: number;
      feesPaid?: string;
      gasUsed?: string;
      txHash?: string;
      blockNumber?: string;
      errorMessage?: string;
      submittedAt?: Date;
      confirmedAt?: Date;
    },
  ): Promise<void> {
    const pool = getPool();
    const sets: string[] = ['status = $2'];
    const params: unknown[] = [id, result.status];
    let idx = 3;

    if (result.actualAmountOut !== undefined) { sets.push(`actual_amount_out = $${idx++}`); params.push(result.actualAmountOut); }
    if (result.executedPrice !== undefined) { sets.push(`executed_price = $${idx++}`); params.push(result.executedPrice); }
    if (result.slippageBps !== undefined) { sets.push(`slippage_bps = $${idx++}`); params.push(result.slippageBps); }
    if (result.feesPaid !== undefined) { sets.push(`fees_paid = $${idx++}`); params.push(result.feesPaid); }
    if (result.gasUsed !== undefined) { sets.push(`gas_used = $${idx++}`); params.push(result.gasUsed); }
    if (result.txHash !== undefined) { sets.push(`tx_hash = $${idx++}`); params.push(result.txHash); }
    if (result.blockNumber !== undefined) { sets.push(`block_number = $${idx++}`); params.push(result.blockNumber); }
    if (result.errorMessage !== undefined) { sets.push(`error_message = $${idx++}`); params.push(result.errorMessage); }
    if (result.submittedAt) { sets.push(`submitted_at = $${idx++}`); params.push(result.submittedAt); }
    if (result.confirmedAt) { sets.push(`confirmed_at = $${idx++}`); params.push(result.confirmedAt); }

    await pool.query(
      `UPDATE external_executions SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  },

  async findByJobId(jobId: string): Promise<ExternalExecutionRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ExternalExecutionRow>(
      'SELECT * FROM external_executions WHERE job_id = $1 ORDER BY leg_index ASC',
      [jobId],
    );
    return rows;
  },

  async findByExecutionId(executionId: string): Promise<ExternalExecutionRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ExternalExecutionRow>(
      'SELECT * FROM external_executions WHERE execution_id = $1 ORDER BY leg_index ASC',
      [executionId],
    );
    return rows;
  },

  async findByTxHash(txHash: string): Promise<ExternalExecutionRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<ExternalExecutionRow>(
      'SELECT * FROM external_executions WHERE tx_hash = $1',
      [txHash],
    );
    return rows[0] ?? null;
  },

  async findPendingConfirmations(olderThanMs: number): Promise<ExternalExecutionRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<ExternalExecutionRow>(
      `SELECT * FROM external_executions
       WHERE status = 'submitted'
       AND submitted_at < NOW() - INTERVAL '1 millisecond' * $1
       ORDER BY submitted_at ASC
       LIMIT 100`,
      [olderThanMs],
    );
    return rows;
  },
};
