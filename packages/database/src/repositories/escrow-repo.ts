import { getPool } from '../connection.js';

// ============================================================================
// Escrow Repository — CRUD for escrow_intents + transitions + events
// ============================================================================

export interface EscrowIntentRow {
  execution_id: string;
  user_address: string;
  pair_id: string;
  input_asset: string;
  output_asset: string;
  amount_in: string;
  expected_amount_out: string;
  min_amount_out: string;
  actual_amount_out: string | null;
  status: string;
  route_plan_hash: string;
  execution_mode: string;
  relayer_id: string | null;
  nonce: number;
  escrow_tx_id: string | null;
  refund_tx_id: string | null;
  completion_tx_id: string | null;
  refund_amount: string | null;
  proof_data: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  settled_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface EscrowTransitionRow {
  id: number;
  execution_id: string;
  from_status: string | null;
  to_status: string;
  triggered_by: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface EscrowEventRow {
  id: number;
  event_type: string;
  execution_id: string;
  user_address: string;
  pair_id: string;
  amount_in: string;
  amount_out: string | null;
  refund_amount: string | null;
  relayer_id: string | null;
  proof_data: string | null;
  reason: string | null;
  created_at: Date;
}

export interface RelayerConfirmationRow {
  id: number;
  execution_id: string;
  relayer_id: string;
  actual_amount_out: string;
  tx_hash: string;
  chain: string;
  proof_data: string;
  signature: string;
  verified: boolean;
  verified_at: Date | null;
  created_at: Date;
}

export interface EscrowFilter {
  status?: string;
  userAddress?: string;
  pairId?: string;
  relayerId?: string;
  executionMode?: string;
  expiredBefore?: Date;
  limit?: number;
  cursor?: string;
}

export const escrowIntentRepo = {
  async create(intent: Omit<EscrowIntentRow, 'created_at' | 'updated_at' | 'settled_at'>): Promise<EscrowIntentRow> {
    const pool = getPool();
    const result = await pool.query<EscrowIntentRow>(
      `INSERT INTO escrow_intents (
        execution_id, user_address, pair_id, input_asset, output_asset,
        amount_in, expected_amount_out, min_amount_out, actual_amount_out,
        status, route_plan_hash, execution_mode, relayer_id, nonce,
        escrow_tx_id, refund_tx_id, completion_tx_id, refund_amount,
        proof_data, failure_reason, expires_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        intent.execution_id, intent.user_address, intent.pair_id,
        intent.input_asset, intent.output_asset, intent.amount_in,
        intent.expected_amount_out, intent.min_amount_out, intent.actual_amount_out,
        intent.status, intent.route_plan_hash, intent.execution_mode,
        intent.relayer_id, intent.nonce, intent.escrow_tx_id,
        intent.refund_tx_id, intent.completion_tx_id, intent.refund_amount,
        intent.proof_data, intent.failure_reason, intent.expires_at,
        JSON.stringify(intent.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async findById(executionId: string): Promise<EscrowIntentRow | null> {
    const pool = getPool();
    const result = await pool.query<EscrowIntentRow>(
      'SELECT * FROM escrow_intents WHERE execution_id = $1',
      [executionId],
    );
    return result.rows[0] ?? null;
  },

  async findMany(filter: EscrowFilter): Promise<EscrowIntentRow[]> {
    const pool = getPool();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter.userAddress) {
      conditions.push(`user_address = $${idx++}`);
      params.push(filter.userAddress);
    }
    if (filter.pairId) {
      conditions.push(`pair_id = $${idx++}`);
      params.push(filter.pairId);
    }
    if (filter.relayerId) {
      conditions.push(`relayer_id = $${idx++}`);
      params.push(filter.relayerId);
    }
    if (filter.executionMode) {
      conditions.push(`execution_mode = $${idx++}`);
      params.push(filter.executionMode);
    }
    if (filter.expiredBefore) {
      conditions.push(`expires_at < $${idx++}`);
      params.push(filter.expiredBefore);
    }
    if (filter.cursor) {
      conditions.push(`created_at < $${idx++}`);
      params.push(new Date(filter.cursor));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 100);
    params.push(limit);

    const result = await pool.query<EscrowIntentRow>(
      `SELECT * FROM escrow_intents ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return result.rows;
  },

  async findExpired(): Promise<EscrowIntentRow[]> {
    const pool = getPool();
    const result = await pool.query<EscrowIntentRow>(
      `SELECT * FROM escrow_intents
       WHERE status NOT IN ('completed', 'refunded', 'expired', 'failed')
         AND expires_at < NOW()
       ORDER BY expires_at ASC
       LIMIT 100`,
    );
    return result.rows;
  },

  async findPendingRefunds(): Promise<EscrowIntentRow[]> {
    const pool = getPool();
    const result = await pool.query<EscrowIntentRow>(
      `SELECT * FROM escrow_intents
       WHERE status IN ('failed', 'expired', 'partially_completed')
         AND refund_tx_id IS NULL
       ORDER BY created_at ASC
       LIMIT 100`,
    );
    return result.rows;
  },

  async updateStatus(
    executionId: string,
    fromStatus: string,
    toStatus: string,
    extras?: Partial<Pick<EscrowIntentRow,
      'actual_amount_out' | 'refund_amount' | 'proof_data' |
      'failure_reason' | 'escrow_tx_id' | 'refund_tx_id' |
      'completion_tx_id' | 'settled_at'
    >>,
  ): Promise<EscrowIntentRow | null> {
    const pool = getPool();
    const sets = ['status = $3', 'updated_at = NOW()'];
    const params: unknown[] = [executionId, fromStatus, toStatus];
    let idx = 4;

    if (extras?.actual_amount_out !== undefined) {
      sets.push(`actual_amount_out = $${idx++}`);
      params.push(extras.actual_amount_out);
    }
    if (extras?.refund_amount !== undefined) {
      sets.push(`refund_amount = $${idx++}`);
      params.push(extras.refund_amount);
    }
    if (extras?.proof_data !== undefined) {
      sets.push(`proof_data = $${idx++}`);
      params.push(extras.proof_data);
    }
    if (extras?.failure_reason !== undefined) {
      sets.push(`failure_reason = $${idx++}`);
      params.push(extras.failure_reason);
    }
    if (extras?.escrow_tx_id !== undefined) {
      sets.push(`escrow_tx_id = $${idx++}`);
      params.push(extras.escrow_tx_id);
    }
    if (extras?.refund_tx_id !== undefined) {
      sets.push(`refund_tx_id = $${idx++}`);
      params.push(extras.refund_tx_id);
    }
    if (extras?.completion_tx_id !== undefined) {
      sets.push(`completion_tx_id = $${idx++}`);
      params.push(extras.completion_tx_id);
    }
    if (extras?.settled_at !== undefined) {
      sets.push(`settled_at = $${idx++}`);
      params.push(extras.settled_at);
    }

    const result = await pool.query<EscrowIntentRow>(
      `UPDATE escrow_intents SET ${sets.join(', ')}
       WHERE execution_id = $1 AND status = $2
       RETURNING *`,
      params,
    );
    return result.rows[0] ?? null;
  },

  async getUserNonce(userAddress: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ max_nonce: number | null }>(
      'SELECT MAX(nonce) as max_nonce FROM escrow_intents WHERE user_address = $1',
      [userAddress],
    );
    return result.rows[0]?.max_nonce ?? 0;
  },

  async countByStatus(): Promise<Record<string, number>> {
    const pool = getPool();
    const result = await pool.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*)::text as count FROM escrow_intents GROUP BY status',
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  },

  async getActiveCount(): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM escrow_intents
       WHERE status NOT IN ('completed', 'refunded')`,
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  },
};

export const escrowTransitionRepo = {
  async record(
    executionId: string,
    fromStatus: string | null,
    toStatus: string,
    triggeredBy: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO escrow_transitions (execution_id, from_status, to_status, triggered_by, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [executionId, fromStatus, toStatus, triggeredBy, reason ?? null, JSON.stringify(metadata ?? {})],
    );
  },

  async findByExecution(executionId: string): Promise<EscrowTransitionRow[]> {
    const pool = getPool();
    const result = await pool.query<EscrowTransitionRow>(
      'SELECT * FROM escrow_transitions WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return result.rows;
  },
};

export const escrowEventRepo = {
  async emit(event: Omit<EscrowEventRow, 'id' | 'created_at'>): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO escrow_events (event_type, execution_id, user_address, pair_id, amount_in, amount_out, refund_amount, relayer_id, proof_data, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        event.event_type, event.execution_id, event.user_address, event.pair_id,
        event.amount_in, event.amount_out, event.refund_amount,
        event.relayer_id, event.proof_data, event.reason,
      ],
    );
  },

  async findByExecution(executionId: string): Promise<EscrowEventRow[]> {
    const pool = getPool();
    const result = await pool.query<EscrowEventRow>(
      'SELECT * FROM escrow_events WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return result.rows;
  },

  async findByType(eventType: string, limit: number = 50): Promise<EscrowEventRow[]> {
    const pool = getPool();
    const result = await pool.query<EscrowEventRow>(
      'SELECT * FROM escrow_events WHERE event_type = $1 ORDER BY created_at DESC LIMIT $2',
      [eventType, Math.min(limit, 100)],
    );
    return result.rows;
  },
};

export const relayerConfirmationRepo = {
  async create(conf: Omit<RelayerConfirmationRow, 'id' | 'verified' | 'verified_at' | 'created_at'>): Promise<RelayerConfirmationRow> {
    const pool = getPool();
    const result = await pool.query<RelayerConfirmationRow>(
      `INSERT INTO relayer_confirmations (execution_id, relayer_id, actual_amount_out, tx_hash, chain, proof_data, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [conf.execution_id, conf.relayer_id, conf.actual_amount_out, conf.tx_hash, conf.chain, conf.proof_data, conf.signature],
    );
    return result.rows[0]!;
  },

  async findByExecution(executionId: string): Promise<RelayerConfirmationRow[]> {
    const pool = getPool();
    const result = await pool.query<RelayerConfirmationRow>(
      'SELECT * FROM relayer_confirmations WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return result.rows;
  },

  async markVerified(id: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE relayer_confirmations SET verified = true, verified_at = NOW() WHERE id = $1',
      [id],
    );
  },

  async findByTxHash(txHash: string): Promise<RelayerConfirmationRow | null> {
    const pool = getPool();
    const result = await pool.query<RelayerConfirmationRow>(
      'SELECT * FROM relayer_confirmations WHERE tx_hash = $1',
      [txHash],
    );
    return result.rows[0] ?? null;
  },
};
