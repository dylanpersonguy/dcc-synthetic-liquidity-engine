// ============================================================================
// relayer-service — Job Intake & Dispatch Engine
// ============================================================================
//
// This service is the entry point for the Relayer Execution Engine.
// It receives execution jobs from the execution-service (or other upstream
// producers), validates them, de-duplicates, and dispatches them to the
// BullMQ execution queue for processing by execution-worker instances.
//
// RESPONSIBILITIES:
//   1. Expose POST /intake — receive RelayerJobPayload from execution-service
//   2. Validate payload schema and business rules
//   3. Check de-duplication by executionId
//   4. Enqueue validated jobs to Redis-backed BullMQ queue
//   5. Return job tracking ID to caller
//   6. Expose health + metrics + queue status endpoints
//
// TRUST MODEL:
//   In v1, this is a CENTRALIZED protocol-run relayer. Users trust that:
//     - The relayer will fill or refund within the escrow timeout.
//     - The relayer's inventory is sufficient for accepted routes.
//     - Fill attestations are honest and verifiable on external chains.
//   The escrow contract provides the safety backstop: if the relayer doesn't
//   fill, the user gets a refund after timeout.
//
// Port: inherited from RelayerServiceConfig (default 3000)
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, RelayerServiceConfig } from '@dcc/config';
import { createPool, closePool, relayerJobRepo } from '@dcc/database';
import {
  createLogger,
  registry,
  relayerJobsReceived,
  relayerQueueDepth,
} from '@dcc/metrics';
import {
  createRedisConnection,
  createRelayerQueue,
  enqueueRelayerJob,
  getQueueHealth,
} from '@dcc/queue';
import type { RelayerJobPayload } from '@dcc/queue';

const log = createLogger('relayer-service');

// ── Intake validation schema ──────────────────────────────────────────
const IntakeSchema = z.object({
  executionId: z.string().min(1),
  pairId: z.string().min(1),
  mode: z.string(),
  inputAsset: z.string(),
  outputAsset: z.string(),
  amountIn: z.string(),
  expectedAmountOut: z.string(),
  minAmountOut: z.string(),
  maxSlippageBps: z.number().int().min(0).max(1000),
  expiresAt: z.number().int().positive(),
  legs: z.array(z.object({
    legIndex: z.number().int().min(0),
    venueId: z.string(),
    chain: z.string(),
    settlementMode: z.string(),
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    expectedAmountOut: z.string(),
    minAmountOut: z.string(),
    feeEstimate: z.string(),
    requiresRelayer: z.boolean(),
  })).min(1),
  deliveryMode: z.string(),
  riskTier: z.string(),
  userAddress: z.string(),
  destinationAddress: z.string(),
  destinationChain: z.string(),
  routeId: z.string(),
  quoteId: z.string(),
  nonce: z.number().int().min(0),
  signature: z.string(),
});

async function main() {
  const config = parseConfig(RelayerServiceConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const redis = createRedisConnection(config.REDIS_URL);
  const queue = createRelayerQueue(redis);

  const app = Fastify();

  // ── POST /intake — receive execution job from upstream ──────────────
  app.post('/intake', async (req, reply) => {
    const parsed = IntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      void reply.status(400);
      return { error: 'Invalid payload', details: parsed.error.issues };
    }

    const payload = parsed.data;

    // Check expiry — reject if already expired or expires too soon (<10s)
    const now = Date.now();
    if (payload.expiresAt < now + 10_000) {
      void reply.status(422);
      return { error: 'Execution intent expired or expiring too soon' };
    }

    // De-duplicate by executionId
    const existing = await relayerJobRepo.findByExecutionId(payload.executionId);
    if (existing) {
      log.info('Duplicate execution rejected', { executionId: payload.executionId });
      void reply.status(409);
      return {
        error: 'Duplicate executionId',
        existingJobId: existing.job_id,
        existingStatus: existing.status,
      };
    }

    // Build job payload with generated jobId
    const jobId = `rj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const jobPayload: RelayerJobPayload = {
      jobId,
      ...payload,
      createdAt: Date.now(),
    };

    // Store durable record in PostgreSQL
    await relayerJobRepo.create({
      jobId,
      executionId: payload.executionId,
      pairId: payload.pairId,
      routeId: payload.routeId,
      quoteId: payload.quoteId,
      mode: payload.mode,
      inputAsset: payload.inputAsset,
      outputAsset: payload.outputAsset,
      amountIn: payload.amountIn,
      expectedAmountOut: payload.expectedAmountOut,
      minAmountOut: payload.minAmountOut,
      maxSlippageBps: payload.maxSlippageBps,
      expiresAt: new Date(payload.expiresAt),
      deliveryMode: payload.deliveryMode,
      riskTier: payload.riskTier,
      userAddress: payload.userAddress,
      destinationAddress: payload.destinationAddress,
      destinationChain: payload.destinationChain,
      legs: payload.legs,
      nonce: payload.nonce,
      signature: payload.signature,
    });

    // Enqueue to BullMQ for execution-worker processing
    const bullJob = await enqueueRelayerJob(queue, jobPayload);

    relayerJobsReceived.inc({ pair_id: payload.pairId, risk_tier: payload.riskTier });

    log.info('Job accepted and enqueued', {
      jobId,
      executionId: payload.executionId,
      pairId: payload.pairId,
      bullmqId: bullJob.id,
    });

    void reply.status(202);
    return {
      accepted: true,
      jobId,
      executionId: payload.executionId,
      status: 'received',
    };
  });

  // ── GET /queue/status — queue health ────────────────────────────────
  app.get('/queue/status', async () => {
    const health = await getQueueHealth(queue);
    return { queue: health, timestamp: Date.now() };
  });

  // ── Health + Metrics ────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'relayer-service',
    timestamp: Date.now(),
  }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
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
  log.info('Relayer service (intake) started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down relayer service...');
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
