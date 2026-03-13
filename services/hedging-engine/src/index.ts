// ============================================================================
// hedging-engine — Exposure Tracking & Hedge Management
// ============================================================================
//
// V1 HEDGING MODEL:
//   The external venue execution IS the primary hedge. When the relayer
//   fills DCC→USDC→SOL on Jupiter, the Jupiter fill IS the hedge for the
//   protocol's DCC-side obligation.
//
//   What counts as hedged:
//     - Amount delivered by venue execution (actual fill amount)
//   What counts as residual exposure:
//     - Difference between expected and actual fill (slippage, partial fills)
//     - Fee costs that aren't recovered
//   How residuals are handled:
//     - Small residuals (<1% of exposure): accepted, tracked
//     - Large residuals (≥1%): flagged for manual/scheduled rebalance
//     - No automated speculative hedging in v1
//
// This service provides:
//   - Hedge record creation and query APIs
//   - Aggregate exposure reporting
//   - Residual exposure monitoring
//   - Prometheus metrics for exposure tracking
//
// Port: 3203
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, HedgingEngineConfig } from '@dcc/config';
import { createPool, closePool, hedgeRepo } from '@dcc/database';
import { createLogger, registry, hedgeResidualExposure } from '@dcc/metrics';

const log = createLogger('hedging-engine');

async function main() {
  const config = parseConfig(HedgingEngineConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify();

  // ── POST /hedge/record — record a hedge for an execution ────────────
  const RecordHedgeSchema = z.object({
    jobId: z.string(),
    executionId: z.string(),
    asset: z.string(),
    chain: z.string(),
    exposureAmount: z.string(),
    hedgedAmount: z.string(),
    hedgeType: z.string().default('execution_fill'),
    hedgeTxHash: z.string().optional(),
    hedgeVenueId: z.string().optional(),
    notes: z.string().optional(),
  });

  app.post('/hedge/record', async (req, reply) => {
    const body = RecordHedgeSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const { exposureAmount, hedgedAmount, ...rest } = body.data;
    const exposure = parseFloat(exposureAmount);
    const hedged = parseFloat(hedgedAmount);
    const residual = Math.abs(exposure - hedged);
    const isFullyHedged = residual < exposure * 0.01; // <1% is fully hedged
    const requiresRebalance = !isFullyHedged;

    const record = await hedgeRepo.create({
      ...rest,
      exposureAmount,
      hedgedAmount,
      residualAmount: residual.toString(),
      isFullyHedged,
      requiresRebalance,
    });

    if (requiresRebalance) {
      log.warn('Residual exposure requires rebalance', {
        jobId: rest.jobId,
        asset: rest.asset,
        chain: rest.chain,
        residual: residual.toString(),
      });
    }

    return { hedgeId: record.id, isFullyHedged, residualAmount: residual.toString() };
  });

  // ── GET /hedge/:jobId — get hedge records for a job ─────────────────
  app.get<{ Params: { jobId: string } }>('/hedge/:jobId', async (req) => {
    const records = await hedgeRepo.findByJobId(req.params.jobId);
    return { records };
  });

  // ── GET /hedge/execution/:executionId — by execution ────────────────
  app.get<{ Params: { executionId: string } }>('/hedge/execution/:executionId', async (req) => {
    const records = await hedgeRepo.findByExecutionId(req.params.executionId);
    return { records };
  });

  // ── GET /hedge/residuals — unhedged residual exposure ───────────────
  app.get('/hedge/residuals', async () => {
    const records = await hedgeRepo.getUnhedgedResiduals();
    const byAsset = await hedgeRepo.getTotalResidualByAsset();
    return { records, aggregatedByAsset: byAsset };
  });

  // ── GET /hedge/exposure — aggregate exposure summary ────────────────
  app.get('/hedge/exposure', async () => {
    const byAsset = await hedgeRepo.getTotalResidualByAsset();
    const totalResidual = byAsset.reduce((sum, r) => sum + parseFloat(r.total_residual), 0);
    return {
      totalResidualExposure: totalResidual.toString(),
      byAsset,
      timestamp: Date.now(),
    };
  });

  // ── Health + Metrics ────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', service: 'hedging-engine', timestamp: Date.now() }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  // ── Background: residual exposure metrics ───────────────────────────
  const metricsInterval = setInterval(async () => {
    try {
      const byAsset = await hedgeRepo.getTotalResidualByAsset();
      for (const row of byAsset) {
        hedgeResidualExposure.set(
          { asset: row.asset, chain: row.chain },
          parseFloat(row.total_residual),
        );
      }
    } catch {
      // Ignore monitoring errors
    }
  }, 30_000);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Hedging engine started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down hedging engine...');
    clearInterval(metricsInterval);
    await app.close();
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
