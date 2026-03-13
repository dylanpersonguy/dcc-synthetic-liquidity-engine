// ============================================================================
// Relayer Job Repository
// ============================================================================

import { getPool } from '../connection.js';

export interface RelayerJobRow {
  job_id: string;
  execution_id: string;
  route_id: string;
  quote_id: string;
  pair_id: string;
  mode: string;
  input_asset: string;
  output_asset: string;
  amount_in: string;
  expected_amount_out: string;
  min_amount_out: string;
  max_slippage_bps: number;
  expires_at: string;
  delivery_mode: string;
  risk_tier: string;
  user_address: string;
  destination_address: string;
  destination_chain: string;
  legs: unknown;
  nonce: number;
  signature: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: unknown | null;
  reservation_id: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RelayerJobFilter {
  status?: string;
  pairId?: string;
  executionId?: string;
  cursor?: string;
  limit?: number;
}

export interface RelayerAttemptRow {
  id: string;
  job_id: string;
  attempt_number: number;
  status: string;
  venue_id: string | null;
  chain: string | null;
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string | null;
  quote_price: string | null;
  executed_price: string | null;
  slippage_bps: number | null;
  fees_paid: string | null;
  gas_used: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  metadata: unknown;
}

export const relayerJobRepo = {
  async create(job: {
    jobId: string;
    executionId: string;
    routeId: string;
    quoteId: string;
    pairId: string;
    mode: string;
    inputAsset: string;
    outputAsset: string;
    amountIn: string;
    expectedAmountOut: string;
    minAmountOut: string;
    maxSlippageBps: number;
    expiresAt: Date;
    deliveryMode: string;
    riskTier: string;
    userAddress: string;
    destinationAddress: string;
    destinationChain: string;
    legs: unknown;
    nonce: number;
    signature: string;
  }): Promise<RelayerJobRow> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerJobRow>(
      `INSERT INTO relayer_jobs (
        job_id, execution_id, route_id, quote_id, pair_id, mode,
        input_asset, output_asset, amount_in, expected_amount_out, min_amount_out,
        max_slippage_bps, expires_at, delivery_mode, risk_tier, user_address,
        destination_address, destination_chain, legs, nonce, signature
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (execution_id) DO NOTHING
      RETURNING *`,
      [
        job.jobId, job.executionId, job.routeId, job.quoteId, job.pairId, job.mode,
        job.inputAsset, job.outputAsset, job.amountIn, job.expectedAmountOut, job.minAmountOut,
        job.maxSlippageBps, job.expiresAt, job.deliveryMode, job.riskTier, job.userAddress,
        job.destinationAddress, job.destinationChain, JSON.stringify(job.legs), job.nonce, job.signature,
      ],
    );
    return rows[0]!;
  },

  async findById(jobId: string): Promise<RelayerJobRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerJobRow>(
      'SELECT * FROM relayer_jobs WHERE job_id = $1',
      [jobId],
    );
    return rows[0] ?? null;
  },

  async findByExecutionId(executionId: string): Promise<RelayerJobRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerJobRow>(
      'SELECT * FROM relayer_jobs WHERE execution_id = $1',
      [executionId],
    );
    return rows[0] ?? null;
  },

  async findMany(filter: RelayerJobFilter): Promise<RelayerJobRow[]> {
    const pool = getPool();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter.pairId) {
      conditions.push(`pair_id = $${idx++}`);
      params.push(filter.pairId);
    }
    if (filter.executionId) {
      conditions.push(`execution_id = $${idx++}`);
      params.push(filter.executionId);
    }
    if (filter.cursor) {
      conditions.push(`created_at < $${idx++}`);
      params.push(filter.cursor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    params.push(limit);

    const { rows } = await pool.query<RelayerJobRow>(
      `SELECT * FROM relayer_jobs ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return rows;
  },

  async updateStatus(
    jobId: string,
    fromStatus: string | null,
    toStatus: string,
    extras?: { lastError?: string; result?: unknown; reservationId?: string; completedAt?: Date },
  ): Promise<boolean> {
    const pool = getPool();
    const sets = ['status = $2', 'updated_at = NOW()', 'attempts = attempts'];
    const params: unknown[] = [jobId, toStatus];
    let idx = 3;

    if (extras?.lastError !== undefined) {
      sets.push(`last_error = $${idx++}`);
      params.push(extras.lastError);
    }
    if (extras?.result !== undefined) {
      sets.push(`result = $${idx++}`);
      params.push(JSON.stringify(extras.result));
    }
    if (extras?.reservationId !== undefined) {
      sets.push(`reservation_id = $${idx++}`);
      params.push(extras.reservationId);
    }
    if (extras?.completedAt) {
      sets.push(`completed_at = $${idx++}`);
      params.push(extras.completedAt);
    }

    const statusCondition = fromStatus ? ` AND status = $${idx++}` : '';
    if (fromStatus) params.push(fromStatus);

    const { rowCount } = await pool.query(
      `UPDATE relayer_jobs SET ${sets.join(', ')} WHERE job_id = $1${statusCondition}`,
      params,
    );
    return (rowCount ?? 0) > 0;
  },

  async incrementAttempts(jobId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE relayer_jobs SET attempts = attempts + 1, updated_at = NOW() WHERE job_id = $1',
      [jobId],
    );
  },

  async recordTransition(
    jobId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string,
    metadata?: unknown,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO relayer_job_transitions (job_id, from_status, to_status, reason, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, fromStatus, toStatus, reason ?? null, JSON.stringify(metadata ?? {})],
    );
  },

  async createAttempt(attempt: {
    jobId: string;
    attemptNumber: number;
    status: string;
    venueId?: string;
    chain?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
  }): Promise<RelayerAttemptRow> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerAttemptRow>(
      `INSERT INTO relayer_attempts (job_id, attempt_number, status, venue_id, chain, token_in, token_out, amount_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [attempt.jobId, attempt.attemptNumber, attempt.status, attempt.venueId ?? null,
       attempt.chain ?? null, attempt.tokenIn ?? null, attempt.tokenOut ?? null, attempt.amountIn ?? null],
    );
    return rows[0]!;
  },

  async updateAttempt(
    attemptId: string,
    update: {
      status: string;
      amountOut?: string;
      txHash?: string;
      executedPrice?: string;
      slippageBps?: number;
      feesPaid?: string;
      gasUsed?: string;
      errorMessage?: string;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<void> {
    const pool = getPool();
    const sets: string[] = ['status = $2'];
    const params: unknown[] = [attemptId, update.status];
    let idx = 3;

    if (update.amountOut !== undefined) { sets.push(`amount_out = $${idx++}`); params.push(update.amountOut); }
    if (update.txHash !== undefined) { sets.push(`tx_hash = $${idx++}`); params.push(update.txHash); }
    if (update.executedPrice !== undefined) { sets.push(`executed_price = $${idx++}`); params.push(update.executedPrice); }
    if (update.slippageBps !== undefined) { sets.push(`slippage_bps = $${idx++}`); params.push(update.slippageBps); }
    if (update.feesPaid !== undefined) { sets.push(`fees_paid = $${idx++}`); params.push(update.feesPaid); }
    if (update.gasUsed !== undefined) { sets.push(`gas_used = $${idx++}`); params.push(update.gasUsed); }
    if (update.errorMessage !== undefined) { sets.push(`error_message = $${idx++}`); params.push(update.errorMessage); }
    if (update.completedAt) { sets.push(`completed_at = $${idx++}`); params.push(update.completedAt); }
    if (update.durationMs !== undefined) { sets.push(`duration_ms = $${idx++}`); params.push(update.durationMs); }

    await pool.query(
      `UPDATE relayer_attempts SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  },

  async getAttempts(jobId: string): Promise<RelayerAttemptRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerAttemptRow>(
      'SELECT * FROM relayer_attempts WHERE job_id = $1 ORDER BY attempt_number ASC',
      [jobId],
    );
    return rows;
  },

  async countByStatus(): Promise<Record<string, number>> {
    const pool = getPool();
    const { rows } = await pool.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM relayer_jobs GROUP BY status',
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = parseInt(row.count, 10);
    }
    return result;
  },

  async getStaleJobs(timeoutMs: number): Promise<RelayerJobRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerJobRow>(
      `SELECT * FROM relayer_jobs
       WHERE status NOT IN ('completed', 'failed', 'timed_out', 'inventory_released', 'reconciled', 'rejected')
       AND updated_at < NOW() - INTERVAL '1 millisecond' * $1
       ORDER BY updated_at ASC
       LIMIT 100`,
      [timeoutMs],
    );
    return rows;
  },

  async getExpiredJobs(): Promise<RelayerJobRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<RelayerJobRow>(
      `SELECT * FROM relayer_jobs
       WHERE status NOT IN ('completed', 'failed', 'timed_out', 'inventory_released', 'reconciled', 'rejected')
       AND expires_at < NOW()
       ORDER BY expires_at ASC
       LIMIT 100`,
    );
    return rows;
  },
};
