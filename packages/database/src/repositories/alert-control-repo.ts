import { getPool } from '../connection.js';

// ============================================================================
// Risk Alerts Repository
// ============================================================================

export interface RiskAlertRow {
  id: number;
  severity: string;
  category: string;
  title: string;
  message: string;
  source_service: string;
  pair_id: string | null;
  venue_id: string | null;
  relayer_id: string | null;
  threshold_value: string | null;
  actual_value: string | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved: boolean;
  resolved_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface AlertFilter {
  severity?: string;
  category?: string;
  acknowledged?: boolean;
  resolved?: boolean;
  limit?: number;
  cursor?: number;
}

export const riskAlertRepo = {
  async create(alert: Omit<RiskAlertRow, 'id' | 'created_at' | 'acknowledged' | 'acknowledged_by' | 'acknowledged_at' | 'resolved' | 'resolved_at'>): Promise<RiskAlertRow> {
    const pool = getPool();
    const result = await pool.query<RiskAlertRow>(
      `INSERT INTO risk_alerts (
        severity, category, title, message, source_service,
        pair_id, venue_id, relayer_id,
        threshold_value, actual_value, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        alert.severity, alert.category, alert.title, alert.message,
        alert.source_service, alert.pair_id, alert.venue_id,
        alert.relayer_id, alert.threshold_value, alert.actual_value,
        JSON.stringify(alert.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async findMany(filter: AlertFilter): Promise<RiskAlertRow[]> {
    const pool = getPool();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.severity) {
      conditions.push(`severity = $${idx++}`);
      params.push(filter.severity);
    }
    if (filter.category) {
      conditions.push(`category = $${idx++}`);
      params.push(filter.category);
    }
    if (filter.acknowledged !== undefined) {
      conditions.push(`acknowledged = $${idx++}`);
      params.push(filter.acknowledged);
    }
    if (filter.resolved !== undefined) {
      conditions.push(`resolved = $${idx++}`);
      params.push(filter.resolved);
    }
    if (filter.cursor) {
      conditions.push(`id < $${idx++}`);
      params.push(filter.cursor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 100);
    params.push(limit);

    const result = await pool.query<RiskAlertRow>(
      `SELECT * FROM risk_alerts ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return result.rows;
  },

  async acknowledge(id: number, acknowledgedBy: string): Promise<RiskAlertRow | null> {
    const pool = getPool();
    const result = await pool.query<RiskAlertRow>(
      `UPDATE risk_alerts SET
        acknowledged = true,
        acknowledged_by = $2,
        acknowledged_at = NOW()
      WHERE id = $1 RETURNING *`,
      [id, acknowledgedBy],
    );
    return result.rows[0] ?? null;
  },

  async resolve(id: number): Promise<RiskAlertRow | null> {
    const pool = getPool();
    const result = await pool.query<RiskAlertRow>(
      `UPDATE risk_alerts SET
        resolved = true,
        resolved_at = NOW()
      WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async countActive(): Promise<Record<string, number>> {
    const pool = getPool();
    const result = await pool.query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*) as count FROM risk_alerts
       WHERE resolved = false GROUP BY severity`,
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.severity] = parseInt(row.count, 10);
    }
    return counts;
  },
};

// ============================================================================
// Protocol Controls Repository
// ============================================================================

export interface ProtocolControlRow {
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: Date;
}

export const protocolControlRepo = {
  async findAll(): Promise<ProtocolControlRow[]> {
    const pool = getPool();
    const result = await pool.query<ProtocolControlRow>(
      'SELECT * FROM protocol_controls ORDER BY key',
    );
    return result.rows;
  },

  async get(key: string): Promise<string | null> {
    const pool = getPool();
    const result = await pool.query<ProtocolControlRow>(
      'SELECT * FROM protocol_controls WHERE key = $1',
      [key],
    );
    return result.rows[0]?.value ?? null;
  },

  async set(key: string, value: string, updatedBy?: string): Promise<ProtocolControlRow> {
    const pool = getPool();
    const result = await pool.query<ProtocolControlRow>(
      `INSERT INTO protocol_controls (key, value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [key, value, updatedBy ?? null],
    );
    return result.rows[0]!;
  },

  async isEmergencyPaused(): Promise<boolean> {
    const val = await protocolControlRepo.get('emergency_pause');
    return val === 'true';
  },

  async getCircuitBreakerLevel(): Promise<string> {
    return (await protocolControlRepo.get('circuit_breaker_level')) ?? 'none';
  },
};
