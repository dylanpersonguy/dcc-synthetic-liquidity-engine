import { getPool } from '../connection.js';

// ============================================================================
// Execution Repository
// ============================================================================

export interface ExecutionRow {
  execution_id: string;
  route_id: string;
  quote_id: string;
  pair_id: string;
  mode: string;
  user_address: string;
  input_asset: string;
  output_asset: string;
  amount_in: string;
  expected_amount_out: string;
  actual_amount_out: string | null;
  status: string;
  relayer_id: string | null;
  settlement_mode: string | null;
  failure_reason: string | null;
  refund_eligible: boolean;
  refunded_at: Date | null;
  escrow_address: string | null;
  escrow_expires_at: Date | null;
  delivery_tx_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface ExecutionLegRow {
  id: number;
  execution_id: string;
  leg_index: number;
  venue_id: string;
  venue_name: string;
  chain: string;
  settlement_mode: string | null;
  token_in: string;
  token_out: string;
  amount_in: string;
  expected_amount_out: string;
  actual_amount_out: string | null;
  fee_estimate: string | null;
  status: string;
  tx_hash: string | null;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ExecutionFilter {
  status?: string;
  pairId?: string;
  relayerId?: string;
  limit?: number;
  cursor?: string;
}

export const executionRepo = {
  async create(exec: Omit<ExecutionRow, 'created_at' | 'updated_at' | 'completed_at'>): Promise<ExecutionRow> {
    const pool = getPool();
    const result = await pool.query<ExecutionRow>(
      `INSERT INTO executions (
        execution_id, route_id, quote_id, pair_id, mode, user_address,
        input_asset, output_asset, amount_in, expected_amount_out,
        actual_amount_out, status, relayer_id, settlement_mode,
        failure_reason, refund_eligible, escrow_address, escrow_expires_at,
        delivery_tx_hash, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [
        exec.execution_id, exec.route_id, exec.quote_id, exec.pair_id,
        exec.mode, exec.user_address, exec.input_asset, exec.output_asset,
        exec.amount_in, exec.expected_amount_out, exec.actual_amount_out,
        exec.status, exec.relayer_id, exec.settlement_mode,
        exec.failure_reason, exec.refund_eligible, exec.escrow_address,
        exec.escrow_expires_at, exec.delivery_tx_hash,
        JSON.stringify(exec.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async findById(executionId: string): Promise<ExecutionRow | null> {
    const pool = getPool();
    const result = await pool.query<ExecutionRow>(
      'SELECT * FROM executions WHERE execution_id = $1',
      [executionId],
    );
    return result.rows[0] ?? null;
  },

  async findMany(filter: ExecutionFilter): Promise<ExecutionRow[]> {
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
    if (filter.relayerId) {
      conditions.push(`relayer_id = $${idx++}`);
      params.push(filter.relayerId);
    }
    if (filter.cursor) {
      conditions.push(`created_at < $${idx++}`);
      params.push(new Date(filter.cursor));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 100);
    params.push(limit);

    const result = await pool.query<ExecutionRow>(
      `SELECT * FROM executions ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return result.rows;
  },

  async updateStatus(
    executionId: string,
    status: string,
    extra?: Partial<Pick<ExecutionRow, 'actual_amount_out' | 'failure_reason' | 'delivery_tx_hash' | 'completed_at' | 'refunded_at' | 'refund_eligible'>>,
  ): Promise<ExecutionRow | null> {
    const pool = getPool();
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params: unknown[] = [executionId, status];
    let idx = 3;

    if (extra?.actual_amount_out !== undefined) {
      sets.push(`actual_amount_out = $${idx++}`);
      params.push(extra.actual_amount_out);
    }
    if (extra?.failure_reason !== undefined) {
      sets.push(`failure_reason = $${idx++}`);
      params.push(extra.failure_reason);
    }
    if (extra?.delivery_tx_hash !== undefined) {
      sets.push(`delivery_tx_hash = $${idx++}`);
      params.push(extra.delivery_tx_hash);
    }
    if (extra?.completed_at !== undefined) {
      sets.push(`completed_at = $${idx++}`);
      params.push(extra.completed_at);
    }
    if (extra?.refunded_at !== undefined) {
      sets.push(`refunded_at = $${idx++}`);
      params.push(extra.refunded_at);
    }
    if (extra?.refund_eligible !== undefined) {
      sets.push(`refund_eligible = $${idx++}`);
      params.push(extra.refund_eligible);
    }

    const result = await pool.query<ExecutionRow>(
      `UPDATE executions SET ${sets.join(', ')} WHERE execution_id = $1 RETURNING *`,
      params,
    );
    return result.rows[0] ?? null;
  },

  async recordTransition(
    executionId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO execution_transitions (execution_id, from_status, to_status, reason, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [executionId, fromStatus, toStatus, reason ?? null, JSON.stringify(metadata ?? {})],
    );
  },

  async getLegs(executionId: string): Promise<ExecutionLegRow[]> {
    const pool = getPool();
    const result = await pool.query<ExecutionLegRow>(
      'SELECT * FROM execution_legs WHERE execution_id = $1 ORDER BY leg_index',
      [executionId],
    );
    return result.rows;
  },

  async upsertLeg(leg: Omit<ExecutionLegRow, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO execution_legs (
        execution_id, leg_index, venue_id, venue_name, chain, settlement_mode,
        token_in, token_out, amount_in, expected_amount_out, actual_amount_out,
        fee_estimate, status, tx_hash, submitted_at, confirmed_at, failure_reason, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (execution_id, leg_index) DO UPDATE SET
        status = EXCLUDED.status,
        tx_hash = COALESCE(EXCLUDED.tx_hash, execution_legs.tx_hash),
        actual_amount_out = COALESCE(EXCLUDED.actual_amount_out, execution_legs.actual_amount_out),
        submitted_at = COALESCE(EXCLUDED.submitted_at, execution_legs.submitted_at),
        confirmed_at = COALESCE(EXCLUDED.confirmed_at, execution_legs.confirmed_at),
        failure_reason = COALESCE(EXCLUDED.failure_reason, execution_legs.failure_reason),
        updated_at = NOW()`,
      [
        leg.execution_id, leg.leg_index, leg.venue_id, leg.venue_name,
        leg.chain, leg.settlement_mode, leg.token_in, leg.token_out,
        leg.amount_in, leg.expected_amount_out, leg.actual_amount_out,
        leg.fee_estimate, leg.status, leg.tx_hash, leg.submitted_at,
        leg.confirmed_at, leg.failure_reason, JSON.stringify(leg.metadata),
      ],
    );
  },

  async countByStatus(): Promise<Record<string, number>> {
    const pool = getPool();
    const result = await pool.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM executions GROUP BY status',
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  },

  async getMetrics24h(pairId?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    pending: number;
  }> {
    const pool = getPool();
    const where = pairId ? 'AND pair_id = $2' : '';
    const params: unknown[] = [new Date(Date.now() - 86_400_000)];
    if (pairId) params.push(pairId);

    const result = await pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count FROM executions
       WHERE created_at >= $1 ${where} GROUP BY status`,
      params,
    );

    let total = 0, successful = 0, failed = 0, pending = 0;
    for (const row of result.rows) {
      const c = parseInt(row.count, 10);
      total += c;
      if (row.status === 'completed') successful += c;
      else if (['failed', 'expired', 'refunded'].includes(row.status)) failed += c;
      else pending += c;
    }
    return { total, successful, failed, pending };
  },
};
