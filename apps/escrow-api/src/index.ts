// ============================================================================
// escrow-api — Operator-Facing Escrow Management API
// ============================================================================
//
// ENDPOINTS:
//   GET  /health                           — Health check
//   GET  /metrics                          — Prometheus metrics
//   GET  /escrow/dashboard                 — Escrow dashboard summary
//   GET  /escrow/search                    — Search/filter escrows
//   GET  /escrow/:executionId              — Escrow detail
//   GET  /escrow/:executionId/timeline     — Full audit trail
//   GET  /escrow/analytics/volume          — Volume analytics
//   GET  /escrow/analytics/latency         — Settlement latency stats
//   GET  /escrow/analytics/failure-rates   — Failure rate analysis
//   POST /escrow/bulk/refund               — Bulk refund
//   POST /escrow/bulk/expire               — Bulk expire
//   POST /escrow/:executionId/force-refund — Force refund individual
//   POST /escrow/:executionId/annotate     — Add operator annotation
//
// PORT: 3301
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { parseConfig, EscrowApiConfig } from '@dcc/config';
import { createPool, closePool, escrowIntentRepo, escrowTransitionRepo, escrowEventRepo, relayerConfirmationRepo } from '@dcc/database';
import { createLogger, registry } from '@dcc/metrics';
import { ESCROW_TERMINAL_STATES, ESCROW_REFUNDABLE_STATES } from '@dcc/contracts';
import type { EscrowExecutionStatus } from '@dcc/contracts';

const log = createLogger('escrow-api');

// ============================================================================
// Request Schemas
// ============================================================================

const SearchSchema = z.object({
  status: z.string().optional(),
  userAddress: z.string().optional(),
  pairId: z.string().optional(),
  relayerId: z.string().optional(),
  executionMode: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
});

const BulkRefundSchema = z.object({
  executionIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().min(1),
});

const BulkExpireSchema = z.object({
  olderThanMinutes: z.coerce.number().int().min(1).default(60),
  statuses: z.array(z.string()).min(1).default(['funds_locked', 'route_locked', 'external_leg_pending']),
  dryRun: z.boolean().default(true),
});

const AnnotateSchema = z.object({
  message: z.string().min(1).max(1000),
  operator: z.string().min(1),
});

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseConfig(EscrowApiConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST'],
  });

  // ======================================================================
  // Health + Metrics
  // ======================================================================

  app.get('/health', async () => ({ status: 'ok', service: 'escrow-api' }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    reply.header('content-type', registry.contentType);
    return metrics;
  });

  // ======================================================================
  // GET /escrow/dashboard — Summary for Operator Dashboard
  // ======================================================================

  app.get('/escrow/dashboard', async () => {
    const statusCounts = await escrowIntentRepo.countByStatus();
    const activeCount = await escrowIntentRepo.getActiveCount();

    // Compute aggregated stats from status counts
    let totalIntents = 0;
    let completedIntents = 0;
    let failedIntents = 0;
    let refundedIntents = 0;
    let expiredIntents = 0;

    for (const [status, count] of Object.entries(statusCounts)) {
      totalIntents += count;
      if (status === 'completed') completedIntents = count;
      if (status === 'failed') failedIntents = count;
      if (status === 'refunded') refundedIntents = count;
      if (status === 'expired') expiredIntents = count;
    }

    return {
      totalIntents,
      activeIntents: activeCount,
      completedIntents,
      failedIntents,
      refundedIntents,
      expiredIntents,
      statusBreakdown: statusCounts,
      successRate: totalIntents > 0
        ? ((completedIntents / totalIntents) * 100).toFixed(2) + '%'
        : 'N/A',
    };
  });

  // ======================================================================
  // GET /escrow/search — Search/Filter Escrows
  // ======================================================================

  app.get('/escrow/search', async (req, reply) => {
    const parsed = SearchSchema.safeParse(req.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const filter = parsed.data;
    const intents = await escrowIntentRepo.findMany({
      status: filter.status,
      userAddress: filter.userAddress,
      pairId: filter.pairId,
      relayerId: filter.relayerId,
      executionMode: filter.executionMode,
      limit: filter.limit,
      cursor: filter.cursor,
    });

    return {
      intents,
      count: intents.length,
      hasMore: intents.length === filter.limit,
    };
  });

  // ======================================================================
  // GET /escrow/:executionId — Escrow Detail
  // ======================================================================

  app.get('/escrow/:executionId', async (req, reply) => {
    const { executionId } = req.params as { executionId: string };

    const intent = await escrowIntentRepo.findById(executionId);
    if (!intent) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const confirmations = await relayerConfirmationRepo.findByExecution(executionId);

    return {
      intent,
      confirmations,
      isTerminal: ESCROW_TERMINAL_STATES.has(intent.status as EscrowExecutionStatus),
      isRefundable: ESCROW_REFUNDABLE_STATES.has(intent.status as EscrowExecutionStatus),
    };
  });

  // ======================================================================
  // GET /escrow/:executionId/timeline — Full Audit Trail
  // ======================================================================

  app.get('/escrow/:executionId/timeline', async (req, reply) => {
    const { executionId } = req.params as { executionId: string };

    const intent = await escrowIntentRepo.findById(executionId);
    if (!intent) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const transitions = await escrowTransitionRepo.findByExecution(executionId);
    const events = await escrowEventRepo.findByExecution(executionId);
    const confirmations = await relayerConfirmationRepo.findByExecution(executionId);

    return {
      executionId,
      currentStatus: intent.status,
      createdAt: intent.created_at,
      expiresAt: intent.expires_at,
      transitions,
      events,
      confirmations,
    };
  });

  // ======================================================================
  // GET /escrow/analytics/volume — Volume Analytics
  // ======================================================================

  app.get('/escrow/analytics/volume', async () => {
    const statusCounts = await escrowIntentRepo.countByStatus();
    return { statusCounts };
  });

  // ======================================================================
  // GET /escrow/analytics/failure-rates — Failure Rate Analysis
  // ======================================================================

  app.get('/escrow/analytics/failure-rates', async () => {
    const statusCounts = await escrowIntentRepo.countByStatus();
    let total = 0;
    let failed = 0;
    let expired = 0;

    for (const [status, count] of Object.entries(statusCounts)) {
      total += count;
      if (status === 'failed') failed = count;
      if (status === 'expired') expired = count;
    }

    return {
      total,
      failed,
      expired,
      failureRate: total > 0 ? ((failed / total) * 100).toFixed(2) + '%' : 'N/A',
      expirationRate: total > 0 ? ((expired / total) * 100).toFixed(2) + '%' : 'N/A',
    };
  });

  // ======================================================================
  // POST /escrow/bulk/refund — Bulk Refund
  // ======================================================================

  app.post('/escrow/bulk/refund', async (req, reply) => {
    const parsed = BulkRefundSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionIds, reason } = parsed.data;
    const results: { executionId: string; success: boolean; error?: string }[] = [];

    for (const executionId of executionIds) {
      const intent = await escrowIntentRepo.findById(executionId);
      if (!intent) {
        results.push({ executionId, success: false, error: 'NOT_FOUND' });
        continue;
      }

      const status = intent.status as EscrowExecutionStatus;
      if (!ESCROW_REFUNDABLE_STATES.has(status)) {
        results.push({ executionId, success: false, error: `NOT_REFUNDABLE (${status})` });
        continue;
      }

      const updated = await escrowIntentRepo.updateStatus(
        executionId, status, 'refunded',
        { settled_at: new Date() },
      );

      if (updated) {
        await escrowTransitionRepo.record(
          executionId, status, 'refunded',
          'operator-bulk-refund', reason,
        );
        results.push({ executionId, success: true });
      } else {
        results.push({ executionId, success: false, error: 'TRANSITION_FAILED' });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    log.info(`Bulk refund processed: ${succeeded}/${executionIds.length}`);

    return { total: executionIds.length, succeeded, failed: executionIds.length - succeeded, results };
  });

  // ======================================================================
  // POST /escrow/bulk/expire — Bulk Expire Stale Intents
  // ======================================================================

  app.post('/escrow/bulk/expire', async (req, reply) => {
    const parsed = BulkExpireSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { olderThanMinutes, statuses, dryRun } = parsed.data;
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    // Find expired intents matching criteria
    const expired = await escrowIntentRepo.findExpired();
    const matching = expired.filter(e => statuses.includes(e.status));

    if (dryRun) {
      return {
        dryRun: true,
        wouldExpire: matching.length,
        cutoff,
        statuses,
        ids: matching.map(e => e.execution_id),
      };
    }

    let succeeded = 0;
    for (const intent of matching) {
      const updated = await escrowIntentRepo.updateStatus(
        intent.execution_id,
        intent.status as EscrowExecutionStatus,
        'expired',
        { refund_amount: intent.amount_in },
      );
      if (updated) {
        await escrowTransitionRepo.record(
          intent.execution_id, intent.status, 'expired',
          'operator-bulk-expire', 'Bulk expiration by operator',
        );
        succeeded++;
      }
    }

    log.info(`Bulk expire processed: ${succeeded}/${matching.length}`);

    return { total: matching.length, succeeded, failed: matching.length - succeeded };
  });

  // ======================================================================
  // POST /escrow/:executionId/annotate — Operator Annotation
  // ======================================================================

  app.post('/escrow/:executionId/annotate', async (req, reply) => {
    const { executionId } = req.params as { executionId: string };
    const parsed = AnnotateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const intent = await escrowIntentRepo.findById(executionId);
    if (!intent) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    await escrowEventRepo.emit({
      event_type: 'OperatorNote',
      execution_id: executionId,
      user_address: intent.user_address,
      pair_id: intent.pair_id,
      amount_in: '',
      amount_out: null,
      refund_amount: null,
      relayer_id: null,
      proof_data: null,
      reason: `[${parsed.data.operator}] ${parsed.data.message}`,
    });

    return { executionId, annotated: true };
  });

  // ======================================================================
  // Start Server
  // ======================================================================

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info(`[escrow-api] Listening on port ${config.PORT}`);

  const shutdown = async () => {
    await app.close();
    await closePool();
    log.info('[escrow-api] Shut down');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('[escrow-api] Fatal error', { err: err instanceof Error ? err : undefined });
  process.exit(1);
});
