import { getPool } from '../connection.js';

// ============================================================================
// Metrics Repositories (Time-Series)
// ============================================================================

export interface ExecutionMetricRow {
  id: number;
  pair_id: string;
  bucket: Date;
  total_executions: number;
  successful: number;
  failed: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_volume_usd: string;
  total_fees_usd: string;
}

export interface RouteMetricRow {
  id: number;
  pair_id: string;
  settlement_mode: string;
  bucket: Date;
  total_routes: number;
  successful: number;
  failed: number;
  avg_execution_time_ms: number;
  avg_slippage_bps: number;
}

export const metricsRepo = {
  async recordExecutionMetric(pairId: string, latencyMs: number, volumeUsd: string, feesUsd: string, success: boolean): Promise<void> {
    const pool = getPool();
    const bucket = new Date();
    bucket.setMinutes(0, 0, 0); // round to hour

    await pool.query(
      `INSERT INTO execution_metrics (
        pair_id, bucket, total_executions, successful, failed,
        avg_latency_ms, p95_latency_ms, total_volume_usd, total_fees_usd
      ) VALUES ($1, $2, 1, $3, $4, $5, $5, $6, $7)
      ON CONFLICT (pair_id, bucket) DO UPDATE SET
        total_executions = execution_metrics.total_executions + 1,
        successful = execution_metrics.successful + $3,
        failed = execution_metrics.failed + $4,
        avg_latency_ms = (execution_metrics.avg_latency_ms * execution_metrics.total_executions + $5) / (execution_metrics.total_executions + 1),
        p95_latency_ms = GREATEST(execution_metrics.p95_latency_ms, $5),
        total_volume_usd = (execution_metrics.total_volume_usd::numeric + $6::numeric)::text,
        total_fees_usd = (execution_metrics.total_fees_usd::numeric + $7::numeric)::text`,
      [pairId, bucket, success ? 1 : 0, success ? 0 : 1, latencyMs, volumeUsd, feesUsd],
    );
  },

  async recordRouteMetric(pairId: string, mode: string, executionTimeMs: number, slippageBps: number, success: boolean): Promise<void> {
    const pool = getPool();
    const bucket = new Date();
    bucket.setMinutes(0, 0, 0);

    await pool.query(
      `INSERT INTO route_metrics (
        pair_id, settlement_mode, bucket, total_routes, successful, failed,
        avg_execution_time_ms, avg_slippage_bps
      ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
      ON CONFLICT (pair_id, settlement_mode, bucket) DO UPDATE SET
        total_routes = route_metrics.total_routes + 1,
        successful = route_metrics.successful + $4,
        failed = route_metrics.failed + $5,
        avg_execution_time_ms = (route_metrics.avg_execution_time_ms * route_metrics.total_routes + $6) / (route_metrics.total_routes + 1),
        avg_slippage_bps = (route_metrics.avg_slippage_bps * route_metrics.total_routes + $7) / (route_metrics.total_routes + 1)`,
      [pairId, mode, bucket, success ? 1 : 0, success ? 0 : 1, executionTimeMs, slippageBps],
    );
  },

  async getExecutionMetrics(pairId: string, hours: number = 24): Promise<ExecutionMetricRow[]> {
    const pool = getPool();
    const since = new Date(Date.now() - hours * 3_600_000);
    const result = await pool.query<ExecutionMetricRow>(
      `SELECT * FROM execution_metrics
       WHERE pair_id = $1 AND bucket >= $2
       ORDER BY bucket DESC`,
      [pairId, since],
    );
    return result.rows;
  },

  async getRouteMetrics(pairId: string, hours: number = 24): Promise<RouteMetricRow[]> {
    const pool = getPool();
    const since = new Date(Date.now() - hours * 3_600_000);
    const result = await pool.query<RouteMetricRow>(
      `SELECT * FROM route_metrics
       WHERE pair_id = $1 AND bucket >= $2
       ORDER BY bucket DESC`,
      [pairId, since],
    );
    return result.rows;
  },

  async getGlobalExecutionSummary(hours: number = 24): Promise<{
    total: number;
    successful: number;
    failed: number;
    avgLatencyMs: number;
    totalVolumeUsd: string;
  }> {
    const pool = getPool();
    const since = new Date(Date.now() - hours * 3_600_000);
    const result = await pool.query<{
      total: string;
      successful: string;
      failed: string;
      avg_latency: string;
      total_volume: string;
    }>(
      `SELECT
        COALESCE(SUM(total_executions), 0) as total,
        COALESCE(SUM(successful), 0) as successful,
        COALESCE(SUM(failed), 0) as failed,
        COALESCE(AVG(avg_latency_ms), 0) as avg_latency,
        COALESCE(SUM(total_volume_usd::numeric), 0)::text as total_volume
      FROM execution_metrics
      WHERE bucket >= $1`,
      [since],
    );
    const row = result.rows[0]!;
    return {
      total: parseInt(row.total, 10),
      successful: parseInt(row.successful, 10),
      failed: parseInt(row.failed, 10),
      avgLatencyMs: parseFloat(row.avg_latency),
      totalVolumeUsd: row.total_volume,
    };
  },
};
