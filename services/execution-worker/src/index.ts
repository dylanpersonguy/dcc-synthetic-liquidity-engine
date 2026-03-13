// ============================================================================
// execution-worker — Relayer Execution Worker Service
// ============================================================================
//
// The core execution pipeline of the relayer engine. Consumes jobs from the
// BullMQ queue, runs the 17-state execution state machine, and reports results.
//
// Architecture:
//   - BullMQ worker processes one job at a time (concurrency=1 for v1 safety)
//   - Each job goes through: validate → reserve inventory → refresh quote →
//     submit to venue → await confirmation → complete → release inventory
//   - Fastify server exposes /health and /metrics for observability
//   - Graceful shutdown drains the worker before exiting
//
// TRUST MODEL:
//   This worker runs as a protocol-operated process. It has access to:
//     - Relayer wallet private keys (for signing venue transactions)
//     - PostgreSQL (for job state, inventory, execution records)
//     - Redis (for job queue)
//     - External venue APIs (Jupiter, Uniswap, Raydium)
//   It does NOT have access to user funds directly — the escrow contract
//   governs fund release based on FillAttestation.
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, ExecutionWorkerConfig } from '@dcc/config';
import { createPool, closePool, relayerJobRepo, externalExecutionRepo, inventoryReservationRepo } from '@dcc/database';
import {
  createLogger,
  registry,
  relayerJobsReceived,
  relayerJobsFailed,
  relayerJobsCompleted,
  relayerExecutionLatency,
  venueSubmissionLatency,
  relayerQueueDepth,
} from '@dcc/metrics';
import {
  createRedisConnection,
  createRelayerWorker,
  createRelayerQueue,
  getQueueHealth,
} from '@dcc/queue';
import type { RelayerJobPayload, RelayerJobResult, Job } from '@dcc/queue';
import { VenueRegistry, JupiterAdapter, UniswapAdapter, RaydiumAdapter } from '@dcc/connectors';
import { executeJob } from './state-machine.js';
import { checkRiskLimits, isEmergencyPaused } from './risk-checks.js';

const log = createLogger('execution-worker');

async function main() {
  const config = parseConfig(ExecutionWorkerConfig);

  // ── Database ──────────────────────────────────────────────────────
  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  // ── Redis ─────────────────────────────────────────────────────────
  const redis = createRedisConnection(config.REDIS_URL);
  const queue = createRelayerQueue(redis);

  // ── Venue Registry ────────────────────────────────────────────────
  const venueRegistry = new VenueRegistry();
  venueRegistry.register(new JupiterAdapter({
    baseUrl: config.JUPITER_API_URL,
    timeoutMs: config.JUPITER_TIMEOUT_MS,
    maxStalenessMs: config.JUPITER_MAX_STALENESS_MS,
  }));
  venueRegistry.register(new UniswapAdapter({
    baseUrl: config.UNISWAP_API_URL,
    timeoutMs: config.UNISWAP_TIMEOUT_MS,
    maxStalenessMs: config.UNISWAP_MAX_STALENESS_MS,
  }));
  venueRegistry.register(new RaydiumAdapter({
    baseUrl: config.RAYDIUM_API_URL,
    timeoutMs: config.RAYDIUM_TIMEOUT_MS,
    maxStalenessMs: config.RAYDIUM_MAX_STALENESS_MS,
  }));

  // ── Wallet addresses (from config) ───────────────────────────────
  const walletAddresses: Record<string, string> = {};
  if (config.RELAYER_SOLANA_PRIVATE_KEY) {
    walletAddresses['solana'] = 'relayer-solana-address'; // Derived from key in production
  }
  if (config.RELAYER_EVM_PRIVATE_KEY) {
    walletAddresses['ethereum'] = 'relayer-evm-address'; // Derived from key in production
  }

  // ── Execution Dependencies ────────────────────────────────────────
  const deps = {
    async reserveInventory(jobId: string, asset: string, chain: string, amount: string) {
      // Check available balance in relayer_inventory
      const { rows } = await (await import('@dcc/database')).getPool().query<{ available_amount: string }>(
        `SELECT available_amount FROM relayer_inventory
         WHERE relayer_id = 'protocol-relayer' AND asset = $1 AND chain = $2`,
        [asset, chain],
      );

      const available = parseFloat(rows[0]?.available_amount ?? '0');
      const requested = parseFloat(amount);

      if (available < requested) {
        log.warn('Insufficient inventory for reservation', { asset, chain, available, requested });
        return null;
      }

      const reservationId = `res_${jobId}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 300_000); // 5 min reservation TTL

      await inventoryReservationRepo.create({
        reservationId,
        jobId,
        executionId: jobId, // Will be updated
        asset,
        chain,
        amount,
        expiresAt,
      });

      // Deduct from available, add to reserved
      await (await import('@dcc/database')).getPool().query(
        `UPDATE relayer_inventory
         SET reserved_amount = reserved_amount + $3,
             available_amount = available_amount - $3,
             last_updated = NOW()
         WHERE relayer_id = 'protocol-relayer' AND asset = $1 AND chain = $2`,
        [asset, chain, amount],
      );

      log.info('Inventory reserved', { reservationId, asset, chain, amount });
      return { reservationId };
    },

    async releaseInventory(reservationId: string, reason: string) {
      const reservation = await inventoryReservationRepo.findById(reservationId);
      if (!reservation || reservation.status !== 'active') return;

      await inventoryReservationRepo.release(reservationId, reason);

      // Return to available
      await (await import('@dcc/database')).getPool().query(
        `UPDATE relayer_inventory
         SET reserved_amount = GREATEST(reserved_amount - $3, 0),
             available_amount = available_amount + $3,
             last_updated = NOW()
         WHERE relayer_id = 'protocol-relayer' AND asset = $1 AND chain = $2`,
        [reservation.asset, reservation.chain, reservation.amount],
      );

      log.info('Inventory released', { reservationId, reason });
    },

    async consumeInventory(reservationId: string) {
      const reservation = await inventoryReservationRepo.findById(reservationId);
      if (!reservation || reservation.status !== 'active') return;

      await inventoryReservationRepo.consume(reservationId);

      // Deduct from reserved (already removed from available during reservation)
      await (await import('@dcc/database')).getPool().query(
        `UPDATE relayer_inventory
         SET reserved_amount = GREATEST(reserved_amount - $3, 0),
             amount = GREATEST(amount - $3, 0),
             last_updated = NOW()
         WHERE relayer_id = 'protocol-relayer' AND asset = $1 AND chain = $2`,
        [reservation.asset, reservation.chain, reservation.amount],
      );

      log.info('Inventory consumed', { reservationId });
    },

    async refreshQuote(venueId: string, tokenIn: string, tokenOut: string, amountIn: string) {
      const adapter = venueRegistry.get(venueId);
      if (!adapter) {
        log.error('Venue adapter not found', { venueId });
        return null;
      }

      const freshness = await adapter.getFreshness();
      if (freshness.isStale) {
        log.warn('Venue data is stale', { venueId, lastUpdateMs: freshness.lastUpdateMs });
      }

      const quote = await adapter.getQuote({ tokenIn, tokenOut, amountIn });
      if (!quote) {
        log.warn('Quote refresh returned null', { venueId, tokenIn, tokenOut, amountIn });
        return null;
      }

      return {
        amountOut: quote.amountOut,
        price: quote.price,
        slippageBps: quote.slippageEstimateBps,
      };
    },

    async submitVenueExecution(
      leg: RelayerJobPayload['legs'][number],
      quote: { amountOut: string; price: string },
      walletAddress: string,
      deadline: number,
      recipientAddress: string,
    ) {
      const adapter = venueRegistry.get(leg.venueId);
      if (!adapter) {
        return { success: false, txHash: null, amountOut: null, executedPrice: null, slippageBps: null, feesPaid: null, error: `Venue ${leg.venueId} not found` };
      }

      const submitStart = Date.now();

      try {
        // Build execution payload via adapter
        const venueQuote = await adapter.getQuote({
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          amountIn: leg.amountIn,
        });

        if (!venueQuote) {
          return { success: false, txHash: null, amountOut: null, executedPrice: null, slippageBps: null, feesPaid: null, error: 'Failed to get execution quote' };
        }

        const payload = await adapter.buildExecutionPayload(venueQuote);

        // In production, this would sign and submit the transaction
        // For v1, we record the execution intent and simulate success
        const txHash = `0x${Date.now().toString(16)}_${leg.venueId}_sim`;

        const submitDuration = Date.now() - submitStart;
        venueSubmissionLatency.observe({ venue_id: leg.venueId, chain: leg.chain }, submitDuration);

        // Record external execution
        await externalExecutionRepo.create({
          jobId: leg.venueId, // Will get correct jobId from caller context
          executionId: txHash,
          legIndex: leg.legIndex,
          venueId: leg.venueId,
          chain: leg.chain,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          amountIn: leg.amountIn,
          expectedAmountOut: leg.expectedAmountOut,
        });

        void payload; // Used in production for actual submission

        return {
          success: true,
          txHash,
          amountOut: quote.amountOut,
          executedPrice: quote.price,
          slippageBps: 0,
          feesPaid: '0',
          error: null,
        };
      } catch (err) {
        const submitDuration = Date.now() - submitStart;
        venueSubmissionLatency.observe({ venue_id: leg.venueId, chain: leg.chain }, submitDuration);
        return {
          success: false,
          txHash: null,
          amountOut: null,
          executedPrice: null,
          slippageBps: null,
          feesPaid: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async waitForConfirmation(txHash: string, chain: string, timeoutMs: number) {
      // In production: poll the chain for transaction confirmation
      // For v1, simulate confirmation after a short delay
      void txHash;
      void chain;
      void timeoutMs;
      await new Promise(resolve => setTimeout(resolve, 100));
      return { confirmed: true, blockNumber: 12345678 };
    },

    async recordHedge(jobId: string, executionId: string, asset: string, chain: string, exposureAmount: string, hedgedAmount: string) {
      const { hedgeRepo } = await import('@dcc/database');
      const exposure = parseFloat(exposureAmount);
      const hedged = parseFloat(hedgedAmount);
      const residual = Math.abs(exposure - hedged);

      await hedgeRepo.create({
        jobId,
        executionId,
        asset,
        chain,
        exposureAmount,
        hedgedAmount,
        residualAmount: residual.toString(),
        hedgeType: 'execution_fill',
        isFullyHedged: residual < exposure * 0.01, // <1% residual = fully hedged
        requiresRebalance: residual >= exposure * 0.01,
      });
    },

    async reportToUpstream(executionId: string, result: RelayerJobResult) {
      // In production: call execution-service API to update status
      // For v1, log the report
      log.info('Reporting execution result upstream', {
        executionId,
        success: result.success,
        amountOut: result.amountOut,
        txHash: result.txHash,
      });
    },

    isEmergencyPaused,

    checkRiskLimits: (pairId: string, amount: string, venueId: string) =>
      checkRiskLimits(pairId, amount, venueId, log),

    getWalletAddress(chain: string): string {
      return walletAddresses[chain] ?? `relayer-${chain}-address`;
    },
  };

  // ── BullMQ Worker ─────────────────────────────────────────────────
  const worker = createRelayerWorker(
    redis,
    async (job: Job<RelayerJobPayload, RelayerJobResult>) => {
      const { data: payload } = job;
      const jobLog = createLogger('execution-worker');

      jobLog.info('Processing job', {
        jobId: payload.jobId,
        executionId: payload.executionId,
        pairId: payload.pairId,
        event: 'job_start',
      });

      relayerJobsReceived.inc({ pair_id: payload.pairId, risk_tier: payload.riskTier });

      // Store initial job record
      await relayerJobRepo.create({
        jobId: payload.jobId,
        executionId: payload.executionId,
        routeId: payload.routeId,
        quoteId: payload.quoteId,
        pairId: payload.pairId,
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

      await relayerJobRepo.incrementAttempts(payload.jobId);

      const startTime = Date.now();
      const result = await executeJob(payload, jobLog, deps);
      const elapsed = Date.now() - startTime;

      if (result.success) {
        relayerJobsCompleted.inc({ pair_id: payload.pairId, venue_id: payload.legs[0]?.venueId ?? 'unknown' });
        relayerExecutionLatency.observe({ pair_id: payload.pairId, venue_id: payload.legs[0]?.venueId ?? 'unknown' }, elapsed);
      } else {
        relayerJobsFailed.inc({ pair_id: payload.pairId, failure_reason: result.failureReason ?? 'unknown' });
      }

      return result;
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Worker job failed', {
      jobId: job?.id,
      error: err.message,
      event: 'worker_job_failed',
    });
  });

  worker.on('error', (err) => {
    log.error('Worker error', { error: err.message, event: 'worker_error' });
  });

  // ── Queue depth monitoring ────────────────────────────────────────
  const queueMonitor = setInterval(async () => {
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

  // ── Stale reservation cleanup ─────────────────────────────────────
  const reservationCleanup = setInterval(async () => {
    try {
      const expired = await inventoryReservationRepo.expireStale();
      if (expired > 0) {
        log.info('Expired stale reservations', { count: expired });
      }
    } catch {
      // Ignore cleanup errors
    }
  }, 60_000);

  // ── HTTP health endpoint ──────────────────────────────────────────
  const app = Fastify();

  app.get('/health', async () => {
    const queueHealthData = await getQueueHealth(queue);
    return {
      status: 'ok',
      service: 'execution-worker',
      queue: queueHealthData,
      timestamp: Date.now(),
    };
  });

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Execution worker started', { port: config.PORT });

  // ── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = async () => {
    log.info('Shutting down execution worker...');
    clearInterval(queueMonitor);
    clearInterval(reservationCleanup);
    await worker.close();
    await queue.close();
    await app.close();
    await closePool();
    log.info('Execution worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
