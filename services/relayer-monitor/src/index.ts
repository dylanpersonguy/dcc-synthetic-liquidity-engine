// ============================================================================
// relayer-monitor — Relayer Health & Inventory Monitoring
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Track relayer inventory per-asset, per-chain
//   2. Monitor active jobs, latency, and error rates
//   3. Check chain connectivity and heartbeat freshness
//   4. Detect degraded/offline relayers and update status
//   5. Emit Prometheus metrics for relayer observability
//   6. Flag relayers with depleted inventory for alerting
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, RelayerMonitorConfig } from '@dcc/config';
import { createPool, closePool, relayerRepo } from '@dcc/database';
import {
  createLogger,
  relayerStatus as relayerStatusGauge,
  relayerInventory as relayerInventoryGauge,
  relayerActiveJobs,
} from '@dcc/metrics';

const log = createLogger('relayer-monitor');

const HEARTBEAT_STALE_MS = 60_000; // 1 minute
const HEARTBEAT_DEAD_MS = 300_000; // 5 minutes
const POLL_INTERVAL_MS = 15_000;

function statusToGaugeValue(status: string): number {
  switch (status) {
    case 'active': return 1;
    case 'degraded': return 0.5;
    case 'paused': return 0.25;
    default: return 0;
  }
}

async function evaluateRelayerHealth(): Promise<void> {
  const relayers = await relayerRepo.findAll();
  const now = Date.now();

  for (const relayer of relayers) {
    const heartbeatAge = now - relayer.last_heartbeat.getTime();
    let computedStatus = relayer.status;

    // Evaluate heartbeat freshness
    if (heartbeatAge > HEARTBEAT_DEAD_MS) {
      computedStatus = 'offline';
    } else if (heartbeatAge > HEARTBEAT_STALE_MS) {
      computedStatus = 'degraded';
    }

    // Evaluate error rate
    const errorRate = parseFloat(relayer.error_rate_1h);
    if (errorRate > 0.2 && computedStatus === 'active') {
      computedStatus = 'degraded';
    }

    // Update status if changed
    if (computedStatus !== relayer.status) {
      await relayerRepo.updateStatus(relayer.relayer_id, computedStatus);
      log.warn('Relayer status changed', {
        relayerId: relayer.relayer_id,
        from: relayer.status,
        to: computedStatus,
        heartbeatAge,
        errorRate,
        event: 'relayer_status_change',
      });
    }

    // Update Prometheus gauges
    relayerStatusGauge.set({ relayer_id: relayer.relayer_id }, statusToGaugeValue(computedStatus));
    relayerInventoryGauge.set(
      { relayer_id: relayer.relayer_id },
      parseFloat(relayer.total_inventory_usd),
    );
    relayerActiveJobs.set({ relayer_id: relayer.relayer_id }, relayer.active_jobs);
  }
}

async function main() {
  const config = parseConfig(RelayerMonitorConfig);
  log.info('Starting relayer-monitor', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Receive heartbeat from relayer
  app.post<{ Body: { relayerId: string } }>('/relayer/heartbeat', async (req) => {
    await relayerRepo.updateHeartbeat(req.body.relayerId);
    log.debug('Heartbeat received', { relayerId: req.body.relayerId, event: 'heartbeat' });
    return { ok: true };
  });

  // Register or update relayer state
  app.post('/relayer/report', async (req) => {
    const data = req.body as Record<string, unknown>;
    await relayerRepo.upsert(data as any);
    log.info('Relayer state reported', {
      relayerId: data['relayer_id'] as string,
      event: 'relayer_report',
    });
    return { ok: true };
  });

  // Report inventory snapshot
  app.post('/relayer/inventory', async (req) => {
    const items = req.body as Array<Record<string, unknown>>;
    for (const item of items) {
      await relayerRepo.upsertInventory(item as any);
    }
    return { ok: true };
  });

  // Get relayer health summary
  app.get('/relayer/health', async () => {
    const relayers = await relayerRepo.findAll();
    return {
      total: relayers.length,
      active: relayers.filter((r) => r.status === 'active').length,
      degraded: relayers.filter((r) => r.status === 'degraded').length,
      offline: relayers.filter((r) => r.status === 'offline').length,
      relayers,
    };
  });

  // Background polling loop
  const pollInterval = setInterval(async () => {
    try {
      await evaluateRelayerHealth();
    } catch (err) {
      log.error('Relayer health check failed', { err: err as Error });
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('Relayer monitor shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Relayer monitor running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
