// ============================================================================
// execution-tracker — Execution Lifecycle Monitoring Service
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Record execution lifecycle events (state transitions)
//   2. Store route legs with per-leg status tracking
//   3. Track timing, failures, and completion rates
//   4. Maintain execution_metrics time-series data
//   5. Emit Prometheus metrics for execution observability
//   6. Detect stale/stuck executions and flag for alerting
//
// STATE MACHINE (12 states):
//   quote_created → route_locked → local_leg_pending → local_leg_complete →
//   external_leg_pending → external_leg_complete → awaiting_delivery → completed
//   (any non-terminal) → failed / expired / refunded / partially_filled
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, ExecutionTrackerConfig } from '@dcc/config';
import { createPool, closePool, executionRepo, metricsRepo } from '@dcc/database';
import { createLogger, executionTotal, executionLatency, executionPending } from '@dcc/metrics';

const log = createLogger('execution-tracker');

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  quote_created: ['route_locked', 'expired', 'failed'],
  route_locked: ['local_leg_pending', 'external_leg_pending', 'failed', 'expired'],
  local_leg_pending: ['local_leg_complete', 'failed'],
  local_leg_complete: ['external_leg_pending', 'awaiting_delivery', 'completed', 'partially_filled'],
  external_leg_pending: ['external_leg_complete', 'failed'],
  external_leg_complete: ['awaiting_delivery', 'completed', 'partially_filled'],
  awaiting_delivery: ['completed', 'failed'],
  partially_filled: ['completed', 'refunded', 'failed'],
  failed: ['refunded'],
  expired: ['refunded'],
};

const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'refunded']);

interface TransitionRequest {
  executionId: string;
  toStatus: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  actualAmountOut?: string;
  failureReason?: string;
  deliveryTxHash?: string;
}

async function main() {
  const config = parseConfig(ExecutionTrackerConfig);
  log.info('Starting execution-tracker', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Record a state transition
  app.post<{ Body: TransitionRequest }>('/track/transition', async (req, reply) => {
    const { executionId, toStatus, reason, metadata, actualAmountOut, failureReason, deliveryTxHash } = req.body;

    const execution = await executionRepo.findById(executionId);
    if (!execution) {
      return reply.status(404).send({ error: 'Execution not found' });
    }

    const currentStatus = execution.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed?.includes(toStatus)) {
      log.warn('Invalid state transition attempted', {
        executionId,
        from: currentStatus,
        to: toStatus,
      });
      return reply.status(400).send({
        error: `Invalid transition from ${currentStatus} to ${toStatus}`,
      });
    }

    // Record transition audit log
    await executionRepo.recordTransition(executionId, currentStatus, toStatus, reason, metadata);

    // Update execution status
    const isTerminal = TERMINAL_STATES.has(toStatus);
    await executionRepo.updateStatus(executionId, toStatus, {
      actual_amount_out: actualAmountOut,
      failure_reason: failureReason,
      delivery_tx_hash: deliveryTxHash,
      completed_at: isTerminal ? new Date() : undefined,
    });

    // Update Prometheus metrics
    if (isTerminal) {
      const latencyMs = Date.now() - execution.created_at.getTime();
      const success = toStatus === 'completed';
      executionTotal.inc({ pair_id: execution.pair_id, status: toStatus, mode: execution.mode });
      executionLatency.observe({ pair_id: execution.pair_id, mode: execution.mode }, latencyMs);

      await metricsRepo.recordExecutionMetric(
        execution.pair_id,
        latencyMs,
        execution.amount_in,
        '0',
        success,
      );
    }

    log.info('Execution transition recorded', {
      executionId,
      from: currentStatus,
      to: toStatus,
      event: 'state_transition',
    });

    return { ok: true, executionId, from: currentStatus, to: toStatus };
  });

  // Record a leg update
  app.post('/track/leg', async (req, reply) => {
    const leg = req.body as Record<string, unknown>;
    await executionRepo.upsertLeg(leg as any);
    log.info('Execution leg updated', {
      executionId: leg['execution_id'] as string,
      legIndex: leg['leg_index'] as number,
      event: 'leg_update',
    });
    return { ok: true };
  });

  // Get execution details with legs
  app.get<{ Params: { executionId: string } }>('/track/:executionId', async (req, reply) => {
    const execution = await executionRepo.findById(req.params.executionId);
    if (!execution) {
      return reply.status(404).send({ error: 'Execution not found' });
    }
    const legs = await executionRepo.getLegs(req.params.executionId);
    return { execution, legs };
  });

  // Detect stale (stuck) executions
  app.get('/track/stale', async (_req, _reply) => {
    const allPending = await executionRepo.findMany({
      limit: 100,
    });
    const staleThreshold = Date.now() - 300_000; // 5 minutes

    const stale = allPending.filter(
      (e) => !TERMINAL_STATES.has(e.status) && e.created_at.getTime() < staleThreshold,
    );

    return { count: stale.length, executions: stale };
  });

  // Background: refresh pending execution count gauge
  const pendingRefreshInterval = setInterval(async () => {
    try {
      const counts = await executionRepo.countByStatus();
      let pendingCount = 0;
      for (const [status, count] of Object.entries(counts)) {
        if (!TERMINAL_STATES.has(status)) pendingCount += count;
      }
      executionPending.set(pendingCount);
    } catch (err) {
      log.error('Failed to refresh pending counts', { err: err as Error });
    }
  }, 15_000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(pendingRefreshInterval);
    await app.close();
    await closePool();
    log.info('Execution tracker shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Execution tracker running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
