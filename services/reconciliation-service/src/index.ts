// ============================================================================
// reconciliation-service — On-Chain Reconciliation Pipeline
// ============================================================================
//
// Reconciliation verifies that on-chain reality matches our internal records.
// For every external venue execution that reached "confirmed" status, we:
//   1. Query on-chain state via venue adapters
//   2. Compare expected vs actual amounts
//   3. Flag mismatches for investigation
//   4. Track resolution of discrepancies
//
// Reconciliation runs as a periodic background loop (every 60s) plus
// manual trigger endpoint. Mismatches are surfaced via Prometheus metrics
// and the REST API for operator review.
//
// Port: 3204
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, ReconciliationServiceConfig } from '@dcc/config';
import {
  createPool,
  closePool,
  reconciliationRepo,
  externalExecutionRepo,
} from '@dcc/database';
import {
  createLogger,
  registry,
  reconciliationMismatch,
} from '@dcc/metrics';
import { VenueRegistry, JupiterAdapter, UniswapAdapter } from '@dcc/connectors';

const log = createLogger('reconciliation-service');

async function main() {
  const config = parseConfig(ReconciliationServiceConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  // ── Venue registry for on-chain queries ─────────────────────────────
  const venueRegistry = new VenueRegistry();
  venueRegistry.register(
    new JupiterAdapter({ baseUrl: config.JUPITER_API_URL }),
  );
  venueRegistry.register(
    new UniswapAdapter({ baseUrl: config.UNISWAP_API_URL }),
  );

  const app = Fastify();

  // ── Core reconciliation loop ────────────────────────────────────────
  async function runReconciliation(): Promise<{
    checked: number;
    matched: number;
    mismatched: number;
    errors: number;
  }> {
    const stats = { checked: 0, matched: 0, mismatched: 0, errors: 0 };

    // Get external executions that have been submitted but not confirmed
    // within the last 60 seconds (give them time to confirm first)
    const pending = await externalExecutionRepo.findPendingConfirmations(60_000);
    log.info('Running reconciliation', { pendingCount: pending.length });

    for (const exec of pending) {
      stats.checked++;

      // Skip if already reconciled
      const existing = await reconciliationRepo.findByJobId(exec.job_id);
      const alreadyReconciled = existing.some(
        (r) => r.venue_id === exec.venue_id && r.status !== 'pending',
      );
      if (alreadyReconciled) continue;

      try {
        // V1: Compare internal records. Full on-chain query in v2.
        // For now, we reconcile based on whether the execution has a confirmed
        // tx_hash and the amounts match expectations.
        const hasConfirmedTx = exec.tx_hash !== null && exec.confirmed_at !== null;
        const hasActualAmount = exec.actual_amount_out !== null;

        let status: string;
        let mismatchReason: string | null = null;

        if (!hasConfirmedTx) {
          // No confirmation yet — create a pending reconciliation record
          status = 'pending';
        } else if (!hasActualAmount) {
          // Confirmed but no actual amount — data gap
          status = 'mismatched';
          mismatchReason = 'confirmed_but_no_actual_amount';
          stats.mismatched++;
          reconciliationMismatch.inc({ venue_id: exec.venue_id });
        } else {
          // Both confirmed and have actual amount — compare
          const expected = parseFloat(exec.expected_amount_out);
          const actual = parseFloat(exec.actual_amount_out!);
          const deviation = Math.abs(expected - actual) / expected;

          if (deviation <= 0.02) {
            // Within 2% tolerance — matched
            status = 'matched';
            stats.matched++;
          } else {
            // Outside tolerance — mismatch
            status = 'mismatched';
            mismatchReason = `amount_deviation_${(deviation * 100).toFixed(1)}pct`;
            stats.mismatched++;
            reconciliationMismatch.inc({ venue_id: exec.venue_id });

            log.warn('Reconciliation mismatch', {
              jobId: exec.job_id,
              venueId: exec.venue_id,
              expected: exec.expected_amount_out,
              actual: exec.actual_amount_out,
              deviationPct: (deviation * 100).toFixed(2),
            });
          }
        }

        await reconciliationRepo.create({
          jobId: exec.job_id,
          executionId: exec.execution_id,
          venueId: exec.venue_id,
          chain: exec.chain,
          txHash: exec.tx_hash ?? undefined,
          expectedAmountOut: exec.expected_amount_out,
          actualAmountOut: exec.actual_amount_out ?? undefined,
          ourStatus: exec.status,
          chainStatus: hasConfirmedTx ? 'confirmed' : 'unknown',
          status,
          mismatchReason: mismatchReason ?? undefined,
        });
      } catch (err) {
        stats.errors++;
        log.error('Reconciliation check failed', {
          jobId: exec.job_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Also re-check pending reconciliation records
    const pendingRecords = await reconciliationRepo.getPendingReconciliations();
    for (const rec of pendingRecords) {
      if (!rec.tx_hash) continue;

      try {
        // V1: re-query internal state. V2: on-chain query via adapter.
        const exec = await externalExecutionRepo.findByTxHash(rec.tx_hash);
        if (!exec) continue;

        if (exec.confirmed_at !== null && exec.actual_amount_out !== null) {
          const expected = parseFloat(rec.expected_amount_out);
          const actual = parseFloat(exec.actual_amount_out);
          const deviation = Math.abs(expected - actual) / expected;

          const newStatus = deviation <= 0.02 ? 'matched' : 'mismatched';
          const reason = deviation > 0.02
            ? `amount_deviation_${(deviation * 100).toFixed(1)}pct`
            : null;

          await reconciliationRepo.updateChainStatus(
            rec.id,
            'confirmed',
            exec.actual_amount_out,
            newStatus,
            reason ?? undefined,
          );

          if (newStatus === 'mismatched') {
            reconciliationMismatch.inc({ venue_id: rec.venue_id });
          }
        }
      } catch (err) {
        log.error('Pending reconciliation re-check failed', {
          recordId: rec.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info('Reconciliation cycle complete', stats);
    return stats;
  }

  // ── POST /reconciliation/trigger — manual trigger ───────────────────
  app.post('/reconciliation/trigger', async () => {
    const stats = await runReconciliation();
    return { triggered: true, ...stats };
  });

  // ── GET /reconciliation/status — aggregate counts ───────────────────
  app.get('/reconciliation/status', async () => {
    const counts = await reconciliationRepo.countByStatus();
    return { counts, timestamp: Date.now() };
  });

  // ── GET /reconciliation/mismatches — unresolved mismatches ──────────
  app.get('/reconciliation/mismatches', async () => {
    const records = await reconciliationRepo.findMismatches();
    return { records, count: records.length };
  });

  // ── GET /reconciliation/:jobId — by job ─────────────────────────────
  app.get<{ Params: { jobId: string } }>('/reconciliation/:jobId', async (req) => {
    const records = await reconciliationRepo.findByJobId(req.params.jobId);
    return { records };
  });

  // ── POST /reconciliation/:id/resolve — manual resolution ────────────
  const ResolveSchema = z.object({
    resolvedBy: z.string().min(1),
  });

  app.post<{ Params: { id: string } }>('/reconciliation/:id/resolve', async (req, reply) => {
    const body = ResolveSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    await reconciliationRepo.resolve(req.params.id, body.data.resolvedBy);
    return { resolved: true, id: req.params.id };
  });

  // ── Health + Metrics ────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'reconciliation-service',
    timestamp: Date.now(),
  }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  // ── Background reconciliation loop ──────────────────────────────────
  const reconciliationInterval = setInterval(() => {
    runReconciliation().catch((err) => {
      log.error('Background reconciliation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 60_000);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Reconciliation service started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down reconciliation service...');
    clearInterval(reconciliationInterval);
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
