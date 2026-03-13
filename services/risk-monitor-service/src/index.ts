// ============================================================================
// risk-monitor-service — Real-Time Protocol Risk Monitoring
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Continuously monitor:
//      - Venue quote freshness (stale external quotes)
//      - Relayer exposure (notional outstanding)
//      - Inventory levels across chains
//      - Route failure rates (24h rolling)
//      - Redemption backlog depth
//      - Synthetic backing ratio
//   2. Trip circuit breakers when thresholds are breached
//   3. Send alerts via riskAlertRepo
//   4. Expose /risk/status endpoint for dashboards and frontend warnings
//
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, RiskMonitorConfig } from '@dcc/config';
import { createPool, closePool, executionRepo, relayerRepo, venueHealthRepo, syntheticExposureRepo, riskAlertRepo, protocolControlRepo } from '@dcc/database';
import type { RiskAlertRow } from '@dcc/database';
import {
  createLogger,
  circuitBreakerLevel as circuitBreakerGauge,
  staleQuoteRejections,
  riskBudgetUsed,
  protocolPaused as protocolPausedGauge,
  activeAlerts as activeAlertsGauge,
} from '@dcc/metrics';
import type { RiskStatus } from '@dcc/types';

const log = createLogger('risk-monitor-service');

const POLL_INTERVAL_MS = 30_000;

// ── Thresholds ───────────────────────────────────────────────────────────

const STALE_VENUE_THRESHOLD_MS = 60_000;     // venue stale if no update in 60s
const RELAYER_EXPOSURE_WARN = 500_000;        // $500k
const RELAYER_EXPOSURE_CRITICAL = 1_000_000;  // $1M
const ROUTE_FAILURE_RATE_WARN = 0.10;         // 10%
const ROUTE_FAILURE_RATE_CRITICAL = 0.25;     // 25%
const BACKING_RATIO_WARN = 1.05;             // 105% — warn
const BACKING_RATIO_CRITICAL = 1.0;          // 100% — under-collateralized
const INVENTORY_LOW_THRESHOLD = 10_000;       // $10k available
const INVENTORY_CRITICAL_THRESHOLD = 1_000;   // $1k available

// ── Risk status cache ────────────────────────────────────────────────────

let cachedRiskStatus: RiskStatus = {
  globalCircuitBreaker: 'NONE',
  staleVenues: [],
  relayerExposure: '0',
  syntheticExposure: '0',
  redemptionBacklog: 0,
  routeFailureRate24h: 0,
  inventoryHealth: {},
  alertCount: 0,
  timestamp: Date.now(),
};

// ── Monitor functions ────────────────────────────────────────────────────

async function checkVenueFreshness(): Promise<string[]> {
  const venues = await venueHealthRepo.findAll();
  const staleVenues: string[] = [];
  const now = Date.now();

  for (const venue of venues) {
    const lastQuoteTime = venue.last_successful_quote?.getTime() ?? 0;
    const elapsed = now - lastQuoteTime;

    if (venue.health_status === 'down' || elapsed > STALE_VENUE_THRESHOLD_MS) {
      staleVenues.push(venue.venue_id);
      staleQuoteRejections.inc({ venue_id: venue.venue_id });
    }
  }

  return staleVenues;
}

async function checkRelayerExposure(): Promise<{ totalExposure: number; alert: boolean }> {
  const relayers = await relayerRepo.findAll();
  let totalExposure = 0;

  for (const relayer of relayers) {
    totalExposure += parseFloat(relayer.total_exposure_usd || '0');
  }

  riskBudgetUsed.set({ scope: 'relayer_exposure' }, totalExposure / RELAYER_EXPOSURE_CRITICAL);

  if (totalExposure > RELAYER_EXPOSURE_CRITICAL) {
    await createAlert('CRITICAL', 'relayer_exposure', 'Relayer exposure critical',
      `Total relayer exposure $${totalExposure.toFixed(0)} exceeds critical threshold $${RELAYER_EXPOSURE_CRITICAL}`,
      { threshold_value: String(RELAYER_EXPOSURE_CRITICAL), actual_value: String(totalExposure) });
    return { totalExposure, alert: true };
  }

  if (totalExposure > RELAYER_EXPOSURE_WARN) {
    await createAlert('WARNING', 'relayer_exposure', 'Relayer exposure elevated',
      `Total relayer exposure $${totalExposure.toFixed(0)} exceeds warning threshold $${RELAYER_EXPOSURE_WARN}`,
      { threshold_value: String(RELAYER_EXPOSURE_WARN), actual_value: String(totalExposure) });
  }

  return { totalExposure, alert: false };
}

async function checkInventoryLevels(): Promise<Record<string, 'HEALTHY' | 'LOW' | 'CRITICAL'>> {
  const relayers = await relayerRepo.findAll();
  const health: Record<string, 'HEALTHY' | 'LOW' | 'CRITICAL'> = {};

  for (const relayer of relayers) {
    const inventory = await relayerRepo.getInventory(relayer.relayer_id);
    for (const item of inventory) {
      const available = parseFloat(item.available || '0');
      const key = `${relayer.relayer_id}:${item.asset}:${item.chain}`;

      if (available < INVENTORY_CRITICAL_THRESHOLD) {
        health[key] = 'CRITICAL';
        await createAlert('CRITICAL', 'inventory', `Inventory critical: ${item.asset}/${item.chain}`,
          `Available ${item.asset} on ${item.chain} is $${available.toFixed(0)}`,
          { threshold_value: String(INVENTORY_CRITICAL_THRESHOLD), actual_value: String(available), venue_id: null, relayer_id: relayer.relayer_id });
      } else if (available < INVENTORY_LOW_THRESHOLD) {
        health[key] = 'LOW';
      } else {
        health[key] = 'HEALTHY';
      }
    }
  }

  return health;
}

async function checkRouteFailureRate(): Promise<number> {
  const metrics = await executionRepo.getMetrics24h();
  const failureRate = metrics.total > 0 ? metrics.failed / metrics.total : 0;

  riskBudgetUsed.set({ scope: 'route_failure_rate' }, failureRate);

  if (failureRate > ROUTE_FAILURE_RATE_CRITICAL) {
    await createAlert('CRITICAL', 'route_failure', 'Route failure rate critical',
      `24h failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${(ROUTE_FAILURE_RATE_CRITICAL * 100)}%`,
      { threshold_value: String(ROUTE_FAILURE_RATE_CRITICAL), actual_value: String(failureRate) });
  } else if (failureRate > ROUTE_FAILURE_RATE_WARN) {
    await createAlert('WARNING', 'route_failure', 'Route failure rate elevated',
      `24h failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${(ROUTE_FAILURE_RATE_WARN * 100)}%`,
      { threshold_value: String(ROUTE_FAILURE_RATE_WARN), actual_value: String(failureRate) });
  }

  return failureRate;
}

async function checkSyntheticExposure(): Promise<{ totalExposure: number; redemptionBacklog: number }> {
  const synthetics = await syntheticExposureRepo.findAll();
  let totalExposure = 0;
  let redemptionBacklog = 0;

  for (const synth of synthetics) {
    totalExposure += parseFloat(synth.net_exposure_usd || '0');
    redemptionBacklog += synth.redemption_queue_size;

    const backingRatio = parseFloat(synth.backing_ratio || '0');
    if (backingRatio > 0 && backingRatio < BACKING_RATIO_CRITICAL) {
      await createAlert('CRITICAL', 'synthetic_backing', `Under-collateralized: ${synth.asset_name}`,
        `Backing ratio ${backingRatio.toFixed(2)} below ${BACKING_RATIO_CRITICAL}`,
        { threshold_value: String(BACKING_RATIO_CRITICAL), actual_value: String(backingRatio) });
    } else if (backingRatio > 0 && backingRatio < BACKING_RATIO_WARN) {
      await createAlert('WARNING', 'synthetic_backing', `Low backing: ${synth.asset_name}`,
        `Backing ratio ${backingRatio.toFixed(2)} below ${BACKING_RATIO_WARN}`,
        { threshold_value: String(BACKING_RATIO_WARN), actual_value: String(backingRatio) });
    }
  }

  riskBudgetUsed.set({ scope: 'synthetic_exposure' }, totalExposure);

  return { totalExposure, redemptionBacklog };
}

async function checkCircuitBreakers(staleVenues: string[], failureRate: number, relayerExposure: number): Promise<string> {
  // Check if admin already set emergency pause
  const isPaused = await protocolControlRepo.isEmergencyPaused();
  if (isPaused) {
    protocolPausedGauge.set(1);
    circuitBreakerGauge.set(2); // HARD_PAUSE = 2
    return 'HARD_PAUSE';
  }

  const currentLevel = await protocolControlRepo.getCircuitBreakerLevel();

  // Auto-trip SOFT_PAUSE if multiple critical conditions
  const criticalConditions: string[] = [];
  if (staleVenues.length >= 3) criticalConditions.push('3+ stale venues');
  if (failureRate > ROUTE_FAILURE_RATE_CRITICAL) criticalConditions.push('critical failure rate');
  if (relayerExposure > RELAYER_EXPOSURE_CRITICAL) criticalConditions.push('critical relayer exposure');

  if (criticalConditions.length >= 2 && currentLevel === 'none') {
    await protocolControlRepo.set('circuit_breaker_level', 'soft_pause', 'risk-monitor-service');
    await createAlert('CRITICAL', 'circuit_breaker', 'Circuit breaker SOFT_PAUSE triggered',
      `Auto-tripped due to: ${criticalConditions.join(', ')}`,
      {});
    protocolPausedGauge.set(0.5);
    circuitBreakerGauge.set(1); // SOFT_PAUSE = 1
    return 'SOFT_PAUSE';
  }

  const level = currentLevel === 'hard_pause' ? 'HARD_PAUSE'
    : currentLevel === 'soft_pause' ? 'SOFT_PAUSE' : 'NONE';

  protocolPausedGauge.set(level === 'HARD_PAUSE' ? 1 : level === 'SOFT_PAUSE' ? 0.5 : 0);
  circuitBreakerGauge.set(level === 'HARD_PAUSE' ? 2 : level === 'SOFT_PAUSE' ? 1 : 0);

  return level;
}

async function createAlert(
  severity: string,
  category: string,
  title: string,
  message: string,
  extra: { threshold_value?: string; actual_value?: string; venue_id?: string | null; relayer_id?: string | null },
): Promise<void> {
  try {
    await riskAlertRepo.create({
      severity,
      category,
      title,
      message,
      source_service: 'risk-monitor-service',
      pair_id: null,
      venue_id: extra.venue_id ?? null,
      relayer_id: extra.relayer_id ?? null,
      threshold_value: extra.threshold_value ?? null,
      actual_value: extra.actual_value ?? null,
      metadata: {},
    });
    log.warn('Alert created', { severity, category, title });
  } catch (err) {
    log.error('Failed to create alert', { err: err as Error, severity, category });
  }
}

// ── Main poll loop ───────────────────────────────────────────────────────

async function pollRiskStatus(): Promise<void> {
  try {
    const [staleVenues, relayerResult, inventoryHealth, failureRate, syntheticResult] =
      await Promise.all([
        checkVenueFreshness(),
        checkRelayerExposure(),
        checkInventoryLevels(),
        checkRouteFailureRate(),
        checkSyntheticExposure(),
      ]);

    const circuitBreaker = await checkCircuitBreakers(
      staleVenues, failureRate, relayerResult.totalExposure,
    );

    const alertCounts = await riskAlertRepo.countActive();
    const totalAlerts = Object.values(alertCounts).reduce((a, b) => a + b, 0);
    activeAlertsGauge.set(totalAlerts);

    cachedRiskStatus = {
      globalCircuitBreaker: circuitBreaker as 'NONE' | 'SOFT_PAUSE' | 'HARD_PAUSE',
      staleVenues,
      relayerExposure: String(relayerResult.totalExposure),
      syntheticExposure: String(syntheticResult.totalExposure),
      redemptionBacklog: syntheticResult.redemptionBacklog,
      routeFailureRate24h: failureRate,
      inventoryHealth,
      alertCount: totalAlerts,
      timestamp: Date.now(),
    };

    log.debug('Risk poll complete', {
      circuitBreaker,
      staleVenues: staleVenues.length,
      failureRate: failureRate.toFixed(3),
      relayerExposure: relayerResult.totalExposure.toFixed(0),
      alertCount: totalAlerts,
      event: 'risk_poll',
    });
  } catch (err) {
    log.error('Risk poll failed', { err: err as Error });
  }
}

// ── Fastify server ───────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(RiskMonitorConfig);
  log.info('Starting risk-monitor-service', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });
  await app.register(cors);

  // GET /risk/status — current risk snapshot
  app.get('/risk/status', async () => cachedRiskStatus);

  // GET /risk/alerts — active alerts
  app.get<{ Querystring: { severity?: string; limit?: string } }>(
    '/risk/alerts',
    async (req) => {
      const alerts = await riskAlertRepo.findMany({
        severity: req.query.severity,
        resolved: false,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
      });
      return { total: alerts.length, alerts };
    },
  );

  // POST /risk/alerts/:id/acknowledge
  app.post<{ Params: { id: string } }>(
    '/risk/alerts/:id/acknowledge',
    async (req) => {
      const id = parseInt(req.params.id, 10);
      const alert = await riskAlertRepo.acknowledge(id, 'operator');
      return alert ? { ok: true, alert } : { ok: false, error: 'Alert not found' };
    },
  );

  // POST /risk/alerts/:id/resolve
  app.post<{ Params: { id: string } }>(
    '/risk/alerts/:id/resolve',
    async (req) => {
      const id = parseInt(req.params.id, 10);
      const alert = await riskAlertRepo.resolve(id);
      return alert ? { ok: true, alert } : { ok: false, error: 'Alert not found' };
    },
  );

  // POST /risk/circuit-breaker — set circuit breaker level
  app.post<{ Body: { level: string } }>(
    '/risk/circuit-breaker',
    async (req) => {
      const { level } = req.body;
      if (!['none', 'soft_pause', 'hard_pause'].includes(level)) {
        return { ok: false, error: 'Invalid level. Must be: none, soft_pause, hard_pause' };
      }
      await protocolControlRepo.set('circuit_breaker_level', level, 'operator-manual');
      if (level === 'hard_pause') {
        await protocolControlRepo.set('emergency_pause', 'true', 'operator-manual');
      } else {
        await protocolControlRepo.set('emergency_pause', 'false', 'operator-manual');
      }
      log.warn('Circuit breaker manually set', { level });
      return { ok: true, level };
    },
  );

  // POST /risk/poll — force risk re-poll
  app.post('/risk/poll', async () => {
    await pollRiskStatus();
    return { ok: true, status: cachedRiskStatus };
  });

  // Background polling
  const pollInterval = setInterval(pollRiskStatus, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('risk-monitor-service shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('risk-monitor-service running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
