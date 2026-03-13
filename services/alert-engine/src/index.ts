// ============================================================================
// alert-engine — Alert Generation & Management
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Poll monitoring data and generate alerts for anomalous conditions
//   2. Detect: stale venues, offline relayers, depleted inventory,
//      execution failure spikes, synthetic exposure near cap
//   3. Deduplicate alerts (don't re-fire the same active alert)
//   4. Manage alert lifecycle: create → acknowledge → resolve
//   5. Emit Prometheus metrics for active alert counts
//
// ALERT CATEGORIES:
//   venue_down          — venue health = down
//   relayer_offline     — relayer status = offline
//   relayer_degraded    — relayer status = degraded
//   inventory_low       — relayer inventory below threshold
//   execution_spike     — failure rate > 20% in last hour
//   synthetic_cap       — synthetic utilization > 80%
//   synthetic_backing   — backing ratio < 1.1
//   market_unhealthy    — market health score < 50
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, AlertEngineConfig } from '@dcc/config';
import {
  createPool, closePool, riskAlertRepo, venueHealthRepo,
  relayerRepo, syntheticExposureRepo, marketHealthRepo, executionRepo,
} from '@dcc/database';
import { createLogger, activeAlerts } from '@dcc/metrics';

const log = createLogger('alert-engine');

const POLL_INTERVAL_MS = 30_000;

// Track which alerts are currently active to avoid duplicates
const activeAlertKeys = new Set<string>();

async function createAlertIfNew(
  key: string,
  severity: 'info' | 'warning' | 'critical',
  category: string,
  title: string,
  message: string,
  extra?: {
    pairId?: string;
    venueId?: string;
    relayerId?: string;
    thresholdValue?: string;
    actualValue?: string;
  },
): Promise<void> {
  if (activeAlertKeys.has(key)) return;

  await riskAlertRepo.create({
    severity,
    category,
    title,
    message,
    source_service: 'alert-engine',
    pair_id: extra?.pairId ?? null,
    venue_id: extra?.venueId ?? null,
    relayer_id: extra?.relayerId ?? null,
    threshold_value: extra?.thresholdValue ?? null,
    actual_value: extra?.actualValue ?? null,
    metadata: {},
  });

  activeAlertKeys.add(key);
  log.warn('Alert created', { key, severity, category, title, event: 'alert_created' });
}

async function evaluateAlerts(): Promise<void> {
  // --- Venue Alerts ---
  const venues = await venueHealthRepo.findAll();
  for (const venue of venues) {
    const key = `venue_down:${venue.venue_id}`;
    if (venue.health_status === 'down') {
      await createAlertIfNew(key, 'critical', 'venue_down', `Venue down: ${venue.venue_name}`,
        `Venue ${venue.venue_name} (${venue.venue_id}) is currently down`,
        { venueId: venue.venue_id });
    } else {
      activeAlertKeys.delete(key);
    }
  }

  // --- Relayer Alerts ---
  const relayers = await relayerRepo.findAll();
  for (const relayer of relayers) {
    const offlineKey = `relayer_offline:${relayer.relayer_id}`;
    const degradedKey = `relayer_degraded:${relayer.relayer_id}`;
    const inventoryKey = `inventory_low:${relayer.relayer_id}`;

    if (relayer.status === 'offline') {
      await createAlertIfNew(offlineKey, 'critical', 'relayer_offline',
        `Relayer offline: ${relayer.name}`,
        `Relayer ${relayer.name} (${relayer.relayer_id}) is offline`,
        { relayerId: relayer.relayer_id });
    } else {
      activeAlertKeys.delete(offlineKey);
    }

    if (relayer.status === 'degraded') {
      await createAlertIfNew(degradedKey, 'warning', 'relayer_degraded',
        `Relayer degraded: ${relayer.name}`,
        `Relayer ${relayer.name} (${relayer.relayer_id}) is in degraded state`,
        { relayerId: relayer.relayer_id });
    } else {
      activeAlertKeys.delete(degradedKey);
    }

    // Inventory check
    const inventoryUsd = parseFloat(relayer.total_inventory_usd);
    if (inventoryUsd < 1000) {
      await createAlertIfNew(inventoryKey, 'warning', 'inventory_low',
        `Low inventory: ${relayer.name}`,
        `Relayer ${relayer.name} inventory is ${relayer.total_inventory_usd} USD`,
        { relayerId: relayer.relayer_id, thresholdValue: '1000', actualValue: relayer.total_inventory_usd });
    } else {
      activeAlertKeys.delete(inventoryKey);
    }
  }

  // --- Execution Failure Spike ---
  const execMetrics = await executionRepo.getMetrics24h();
  if (execMetrics.total > 10) {
    const failRate = execMetrics.failed / execMetrics.total;
    const key = 'execution_spike:global';
    if (failRate > 0.2) {
      await createAlertIfNew(key, 'critical', 'execution_spike',
        'Execution failure spike',
        `Global execution failure rate is ${(failRate * 100).toFixed(1)}% (${execMetrics.failed}/${execMetrics.total})`,
        { thresholdValue: '0.2', actualValue: String(failRate) });
    } else {
      activeAlertKeys.delete(key);
    }
  }

  // --- Synthetic Risk Alerts ---
  const exposures = await syntheticExposureRepo.findAll();
  for (const exp of exposures) {
    const supply = parseFloat(exp.current_supply);
    const cap = parseFloat(exp.max_supply_cap);
    const utilization = cap > 0 ? supply / cap : 0;
    const backingRatio = parseFloat(exp.backing_ratio);

    const capKey = `synthetic_cap:${exp.synthetic_asset_id}`;
    if (utilization > 0.8) {
      const severity = utilization > 0.95 ? 'critical' : 'warning';
      await createAlertIfNew(capKey, severity, 'synthetic_cap',
        `Synthetic near cap: ${exp.asset_name}`,
        `${exp.asset_name} utilization at ${(utilization * 100).toFixed(1)}%`,
        { thresholdValue: '0.8', actualValue: String(utilization) });
    } else {
      activeAlertKeys.delete(capKey);
    }

    const backingKey = `synthetic_backing:${exp.synthetic_asset_id}`;
    if (backingRatio < 1.1) {
      const severity = backingRatio < 1.0 ? 'critical' : 'warning';
      await createAlertIfNew(backingKey, severity, 'synthetic_backing',
        `Low backing: ${exp.asset_name}`,
        `${exp.asset_name} backing ratio at ${backingRatio}`,
        { thresholdValue: '1.1', actualValue: String(backingRatio) });
    } else {
      activeAlertKeys.delete(backingKey);
    }
  }

  // --- Market Health Alerts ---
  const marketHealthScores = await marketHealthRepo.findAll();
  for (const mh of marketHealthScores) {
    const score = parseFloat(mh.health_score);
    const key = `market_unhealthy:${mh.pair_id}`;
    if (score < 50) {
      const severity = score < 25 ? 'critical' : 'warning';
      await createAlertIfNew(key, severity, 'market_unhealthy',
        `Unhealthy market: ${mh.pair_id}`,
        `Market ${mh.pair_id} health score is ${score}`,
        { pairId: mh.pair_id, thresholdValue: '50', actualValue: String(score) });
    } else {
      activeAlertKeys.delete(key);
    }
  }

  // Update alert count gauge
  const alertCounts = await riskAlertRepo.countActive();
  for (const [severity, count] of Object.entries(alertCounts)) {
    activeAlerts.set({ severity }, count);
  }
}

async function main() {
  const config = parseConfig(AlertEngineConfig);
  log.info('Starting alert-engine', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Get all alerts
  app.get('/alerts', async (req) => {
    const query = req.query as Record<string, string>;
    return riskAlertRepo.findMany({
      severity: query['severity'],
      category: query['category'],
      acknowledged: query['acknowledged'] === 'true' ? true : query['acknowledged'] === 'false' ? false : undefined,
      resolved: query['resolved'] === 'true' ? true : query['resolved'] === 'false' ? false : undefined,
      limit: query['limit'] ? parseInt(query['limit'], 10) : undefined,
    });
  });

  // Acknowledge alert
  app.post<{ Params: { id: string }; Body: { acknowledgedBy: string } }>(
    '/alerts/:id/acknowledge',
    async (req, reply) => {
      const result = await riskAlertRepo.acknowledge(parseInt(req.params.id, 10), req.body.acknowledgedBy);
      if (!result) return reply.status(404).send({ error: 'Alert not found' });
      return result;
    },
  );

  // Resolve alert
  app.post<{ Params: { id: string } }>('/alerts/:id/resolve', async (req, reply) => {
    const result = await riskAlertRepo.resolve(parseInt(req.params.id, 10));
    if (!result) return reply.status(404).send({ error: 'Alert not found' });
    activeAlertKeys.delete(`*:${req.params.id}`);
    return result;
  });

  // Force evaluation
  app.post('/alerts/evaluate', async () => {
    await evaluateAlerts();
    return { ok: true };
  });

  // Background polling
  const pollInterval = setInterval(async () => {
    try {
      await evaluateAlerts();
    } catch (err) {
      log.error('Alert evaluation failed', { err: err as Error });
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('Alert engine shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Alert engine running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
