// ============================================================================
// relayer-api — Relayer Operations REST API
// ============================================================================
//
// The administrative and operational API for the Relayer + Hedging Engine.
// Provides operator-facing endpoints for:
//
//   /health, /metrics                    — Standard observability
//   /status                              — Relayer system status overview
//   /jobs                                — Job listing, detail, retry, cancel
//   /executions                          — External execution records
//   /inventory                           — Inventory positions and reservations
//   /venues                              — Venue health snapshots
//   /admin                               — Pause/resume, risk limits, controls
//   /hedge                               — Hedge exposure overview
//   /reconciliation                      — Reconciliation status
//
// Port: 3200
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import Redis from 'ioredis';
import { parseConfig, RelayerApiConfig } from '@dcc/config';
import {
  createPool,
  closePool,
  getPool,
  relayerJobRepo,
  externalExecutionRepo,
  inventoryReservationRepo,
  hedgeRepo,
  reconciliationRepo,
  relayerRepo,
} from '@dcc/database';
import {
  createLogger,
  registry,
  relayerQueueDepth,
} from '@dcc/metrics';
import {
  createRedisConnection,
  createRelayerQueue,
  enqueueRelayerJob,
  getQueueHealth,
  RELAYER_QUEUE_NAME,
} from '@dcc/queue';
import type { RelayerJobPayload } from '@dcc/queue';

const log = createLogger('relayer-api');
const RELAYER_ID = 'protocol-relayer';

async function main() {
  const config = parseConfig(RelayerApiConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const redis = createRedisConnection(config.REDIS_URL);
  const queue = createRelayerQueue(redis);

  const app = Fastify();
  await app.register(cors, { origin: true });

  // ─── HEALTH & METRICS ──────────────────────────────────────────────

  app.get('/health', async () => {
    const queueHealth = await getQueueHealth(queue);
    return {
      status: 'ok',
      service: 'relayer-api',
      queue: queueHealth,
      timestamp: Date.now(),
    };
  });

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  // ─── STATUS — system overview ──────────────────────────────────────

  app.get('/status', async () => {
    const [queueHealth, jobCounts] = await Promise.all([
      getQueueHealth(queue),
      relayerJobRepo.countByStatus(),
    ]);

    return {
      relayerId: RELAYER_ID,
      queue: queueHealth,
      jobs: jobCounts,
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  });

  // ─── JOBS — listing, detail, retry ─────────────────────────────────

  const JobFilterSchema = z.object({
    status: z.string().optional(),
    pairId: z.string().optional(),
    executionId: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  app.get('/jobs', async (req) => {
    const query = JobFilterSchema.parse(req.query);
    const jobs = await relayerJobRepo.findMany({
      status: query.status,
      pairId: query.pairId,
      executionId: query.executionId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { jobs, count: jobs.length };
  });

  app.get<{ Params: { jobId: string } }>('/jobs/:jobId', async (req, reply) => {
    const job = await relayerJobRepo.findById(req.params.jobId);
    if (!job) {
      void reply.status(404);
      return { error: 'Job not found' };
    }

    const [attempts, executions, hedges, reconciliations] = await Promise.all([
      relayerJobRepo.getAttempts(req.params.jobId),
      externalExecutionRepo.findByJobId(req.params.jobId),
      hedgeRepo.findByJobId(req.params.jobId),
      reconciliationRepo.findByJobId(req.params.jobId),
    ]);

    return { job, attempts, executions, hedges, reconciliations };
  });

  // Re-enqueue a failed job
  const RetrySchema = z.object({
    jobId: z.string(),
  });

  app.post('/jobs/retry', async (req, reply) => {
    const body = RetrySchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const job = await relayerJobRepo.findById(body.data.jobId);
    if (!job) {
      void reply.status(404);
      return { error: 'Job not found' };
    }

    if (job.status !== 'failed' && job.status !== 'timed_out' && job.status !== 'inventory_released') {
      void reply.status(409);
      return { error: `Cannot retry job in status: ${job.status}` };
    }

    // Re-enqueue the job - reconstruct payload from stored columns
    const payload: RelayerJobPayload = {
      jobId: `rj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      executionId: job.execution_id,
      pairId: job.pair_id,
      mode: job.mode,
      inputAsset: job.input_asset,
      outputAsset: job.output_asset,
      amountIn: job.amount_in,
      expectedAmountOut: job.expected_amount_out,
      minAmountOut: job.min_amount_out,
      maxSlippageBps: job.max_slippage_bps,
      expiresAt: Date.now() + 300_000, // extend expiry by 5min for retry
      legs: job.legs as RelayerJobPayload['legs'],
      deliveryMode: job.delivery_mode,
      riskTier: job.risk_tier,
      userAddress: job.user_address,
      destinationAddress: job.destination_address,
      destinationChain: job.destination_chain,
      routeId: job.route_id,
      quoteId: job.quote_id,
      nonce: job.nonce,
      signature: job.signature,
      createdAt: Date.now(),
    };
    const newJob = await enqueueRelayerJob(queue, payload);

    log.info('Job re-enqueued for retry', { oldJobId: job.job_id, newBullmqId: newJob.id });
    return { retried: true, jobId: job.job_id, bullmqJobId: newJob.id };
  });

  // Cancel a job (only if not yet submitted to venue)
  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/cancel', async (req, reply) => {
    const job = await relayerJobRepo.findById(req.params.jobId);
    if (!job) {
      void reply.status(404);
      return { error: 'Job not found' };
    }

    const cancellableStatuses = ['received', 'validated', 'inventory_reserved', 'quote_refreshed', 'ready_to_execute'];
    if (!cancellableStatuses.includes(job.status)) {
      void reply.status(409);
      return { error: `Cannot cancel job in status: ${job.status}` };
    }

    await relayerJobRepo.updateStatus(job.job_id, job.status, 'rejected', { lastError: 'admin_cancelled' });

    log.info('Job cancelled by admin', { jobId: job.job_id });
    return { cancelled: true, jobId: job.job_id };
  });

  // ─── EXECUTIONS — external execution records ───────────────────────

  app.get<{ Params: { jobId: string } }>('/executions/:jobId', async (req) => {
    const records = await externalExecutionRepo.findByJobId(req.params.jobId);
    return { records };
  });

  app.get<{ Params: { txHash: string } }>('/executions/tx/:txHash', async (req) => {
    const records = await externalExecutionRepo.findByTxHash(req.params.txHash);
    return { records };
  });

  // ─── INVENTORY — positions and reservations ────────────────────────

  app.get('/inventory', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM relayer_inventory WHERE relayer_id = $1 ORDER BY chain, asset`,
      [RELAYER_ID],
    );
    return { positions: rows };
  });

  app.get('/inventory/reservations', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const asset = query['asset'] ?? '';
    const chain = query['chain'] ?? '';
    if (!asset || !chain) {
      return { reservations: [], note: 'Provide ?asset=X&chain=Y to filter active reservations' };
    }
    const reservations = await inventoryReservationRepo.getActiveReservations(asset, chain);
    return { reservations };
  });

  app.get('/inventory/summary', async () => {
    const pool = getPool();
    const { rows } = await pool.query<{
      asset: string;
      chain: string;
      available_amount: string;
      reserved_amount: string;
      total_amount: string;
    }>(
      `SELECT asset, chain, available_amount, reserved_amount, total_amount
       FROM relayer_inventory WHERE relayer_id = $1`,
      [RELAYER_ID],
    );

    const summary = rows.map((r) => {
      const available = parseFloat(r.available_amount);
      const total = parseFloat(r.total_amount);
      const utilization = total > 0 ? ((total - available) / total) * 100 : 0;
      return {
        ...r,
        utilizationPct: utilization.toFixed(1),
        health: utilization < 70 ? 'HEALTHY' : utilization < 90 ? 'LOW' : 'CRITICAL',
      };
    });

    return { positions: summary, timestamp: Date.now() };
  });

  // ─── VENUES — venue health snapshots ───────────────────────────────

  app.get('/venues', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT * FROM venue_status_cache ORDER BY venue_id',
    );
    return { venues: rows };
  });

  app.get<{ Params: { venueId: string } }>('/venues/:venueId', async (req, reply) => {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT * FROM venue_status_cache WHERE venue_id = $1',
      [req.params.venueId],
    );

    if (rows.length === 0) {
      void reply.status(404);
      return { error: 'Venue not found' };
    }

    return { venue: rows[0] };
  });

  // ─── HEDGE — exposure overview ─────────────────────────────────────

  app.get('/hedge/exposure', async () => {
    const byAsset = await hedgeRepo.getTotalResidualByAsset();
    const unhedged = await hedgeRepo.getUnhedgedResiduals();
    return {
      residualsByAsset: byAsset,
      unhedgedCount: unhedged.length,
      timestamp: Date.now(),
    };
  });

  // ─── RECONCILIATION — status overview ──────────────────────────────

  app.get('/reconciliation/status', async () => {
    const counts = await reconciliationRepo.countByStatus();
    const mismatches = await reconciliationRepo.findMismatches();
    return { counts, unresolvedMismatches: mismatches.length, timestamp: Date.now() };
  });

  // ─── ADMIN — operational controls ──────────────────────────────────

  // Pause relayer (sets emergency pause flag)
  app.post('/admin/pause', async (_req, reply) => {
    const pool = getPool();
    await pool.query(
      `UPDATE protocol_controls SET is_active = TRUE, updated_at = NOW()
       WHERE control_type = 'emergency_pause'`,
    );
    log.warn('ADMIN: Relayer paused via API');
    return { paused: true, timestamp: Date.now() };
  });

  // Resume relayer
  app.post('/admin/resume', async (_req, reply) => {
    const pool = getPool();
    await pool.query(
      `UPDATE protocol_controls SET is_active = FALSE, updated_at = NOW()
       WHERE control_type = 'emergency_pause'`,
    );
    log.info('ADMIN: Relayer resumed via API');
    return { resumed: true, timestamp: Date.now() };
  });

  // Get risk limits
  app.get('/admin/risk-limits', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT * FROM relayer_risk_limits WHERE is_active = TRUE ORDER BY limit_type, scope_key',
    );
    return { limits: rows };
  });

  // Update a risk limit
  const RiskLimitSchema = z.object({
    limitType: z.enum(['per_route', 'per_venue', 'global']),
    scopeKey: z.string(),
    maxNotionalUsd: z.string(),
    dailyBudgetUsd: z.string().optional(),
    maxSingleTradeUsd: z.string().optional(),
  });

  app.post('/admin/risk-limits', async (req, reply) => {
    const body = RiskLimitSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO relayer_risk_limits (limit_type, scope_key, max_notional_usd, daily_budget_usd, max_single_trade_usd, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (limit_type, scope_key) DO UPDATE SET
         max_notional_usd = EXCLUDED.max_notional_usd,
         daily_budget_usd = COALESCE(EXCLUDED.daily_budget_usd, relayer_risk_limits.daily_budget_usd),
         max_single_trade_usd = COALESCE(EXCLUDED.max_single_trade_usd, relayer_risk_limits.max_single_trade_usd),
         updated_at = NOW()`,
      [
        body.data.limitType,
        body.data.scopeKey,
        body.data.maxNotionalUsd,
        body.data.dailyBudgetUsd ?? null,
        body.data.maxSingleTradeUsd ?? null,
      ],
    );

    log.info('Risk limit updated', body.data);
    return { updated: true };
  });

  // Get stale/expired jobs
  app.get('/admin/stale-jobs', async () => {
    const stale = await relayerJobRepo.getStaleJobs(5);
    const expired = await relayerJobRepo.getExpiredJobs();
    return { staleJobs: stale, expiredJobs: expired };
  });

  // ── Background: queue depth monitoring ──────────────────────────────
  const queueMonitorInterval = setInterval(async () => {
    try {
      const health = await getQueueHealth(queue);
      relayerQueueDepth.set({ state: 'waiting' }, health.waiting);
      relayerQueueDepth.set({ state: 'active' }, health.active);
      relayerQueueDepth.set({ state: 'delayed' }, health.delayed);
      relayerQueueDepth.set({ state: 'failed' }, health.failed);
    } catch {
      // Ignore monitoring errors
    }
  }, 15_000);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Relayer API started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down relayer API...');
    clearInterval(queueMonitorInterval);
    await app.close();
    await queue.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
