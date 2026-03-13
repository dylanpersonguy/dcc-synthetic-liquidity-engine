// ============================================================================
// venue-health-monitor — External Venue Health Monitoring
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Probe each venue (DCC AMM, DCC Orderbook, Jupiter, Raydium, Uniswap)
//   2. Track latency, quote freshness, error rate, and connection health
//   3. Classify venues as healthy / degraded / down
//   4. Update venue_health and connector_health tables
//   5. Emit Prometheus metrics for venue observability
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, VenueHealthMonitorConfig } from '@dcc/config';
import { createPool, closePool, venueHealthRepo } from '@dcc/database';
import type { VenueHealthRow } from '@dcc/database';
import {
  createLogger,
  venueHealth as venueHealthGauge,
  venueLatency as venueLatencyHisto,
  venueErrorRate as venueErrorRateGauge,
} from '@dcc/metrics';

const log = createLogger('venue-health-monitor');

const POLL_INTERVAL_MS = 30_000;
const VENUES = [
  { id: 'dcc-amm', name: 'DCC AMM', type: 'DCC_AMM' },
  { id: 'dcc-orderbook', name: 'DCC Orderbook', type: 'DCC_ORDERBOOK' },
  { id: 'jupiter', name: 'Jupiter', type: 'JUPITER' },
  { id: 'raydium', name: 'Raydium', type: 'RAYDIUM' },
  { id: 'uniswap', name: 'Uniswap', type: 'UNISWAP' },
];

function computeHealthStatus(
  latencyMs: number,
  errorCount: number,
  quoteCount: number,
): 'healthy' | 'degraded' | 'down' {
  if (quoteCount === 0 && errorCount > 5) return 'down';
  const errorRate = quoteCount > 0 ? errorCount / (quoteCount + errorCount) : 1;
  if (errorRate > 0.5 || latencyMs > 5000) return 'down';
  if (errorRate > 0.1 || latencyMs > 2000) return 'degraded';
  return 'healthy';
}

function healthToGaugeValue(status: string): number {
  switch (status) {
    case 'healthy': return 1;
    case 'degraded': return 0.5;
    default: return 0;
  }
}

async function probeVenue(venue: typeof VENUES[0]): Promise<Partial<VenueHealthRow>> {
  const start = Date.now();
  // Simulated probe — in production this would call the actual venue API
  // and measure real latency/errors.
  const latencyMs = Math.floor(Math.random() * 200) + 20;
  const errorCount = Math.floor(Math.random() * 3);
  const quoteCount = Math.floor(Math.random() * 100) + 50;

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    venue_type: venue.type,
    latency_ms: latencyMs,
    error_count_1h: errorCount,
    quote_count_1h: quoteCount,
    uptime_24h: '99.5',
    last_successful_quote: new Date(),
    last_error: null,
    metadata: { probed_at: new Date(start).toISOString() },
  };
}

async function pollVenues(): Promise<void> {
  for (const venue of VENUES) {
    try {
      const probe = await probeVenue(venue);
      const healthStatus = computeHealthStatus(
        probe.latency_ms!,
        probe.error_count_1h!,
        probe.quote_count_1h!,
      );

      await venueHealthRepo.upsert({
        ...probe,
        health_status: healthStatus,
      } as VenueHealthRow);

      venueHealthGauge.set(
        { venue_id: venue.id, venue_type: venue.type },
        healthToGaugeValue(healthStatus),
      );
      venueLatencyHisto.observe(
        { venue_id: venue.id, venue_type: venue.type },
        probe.latency_ms!,
      );
      venueErrorRateGauge.set(
        { venue_id: venue.id },
        probe.quote_count_1h! > 0
          ? probe.error_count_1h! / (probe.quote_count_1h! + probe.error_count_1h!)
          : 0,
      );

      log.debug('Venue probed', {
        venueId: venue.id,
        healthStatus,
        latencyMs: probe.latency_ms,
        event: 'venue_probe',
      });
    } catch (err) {
      log.error('Venue probe failed', { venueId: venue.id, err: err as Error });
    }
  }
}

async function main() {
  const config = parseConfig(VenueHealthMonitorConfig);
  log.info('Starting venue-health-monitor', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Get all venue health
  app.get('/venues/health', async () => {
    const venues = await venueHealthRepo.findAll();
    return {
      total: venues.length,
      healthy: venues.filter((v) => v.health_status === 'healthy').length,
      degraded: venues.filter((v) => v.health_status === 'degraded').length,
      down: venues.filter((v) => v.health_status === 'down').length,
      venues,
    };
  });

  // Get single venue health
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/health', async (req, reply) => {
    const venue = await venueHealthRepo.findById(req.params.venueId);
    if (!venue) return reply.status(404).send({ error: 'Venue not found' });
    const connectors = await venueHealthRepo.getConnectorHealth(req.params.venueId);
    return { venue, connectors };
  });

  // Force re-probe
  app.post('/venues/probe', async () => {
    await pollVenues();
    return { ok: true };
  });

  // Report connector health from external source
  app.post('/venues/connector-health', async (req) => {
    const data = req.body as Record<string, unknown>;
    await venueHealthRepo.upsertConnectorHealth(data as any);
    return { ok: true };
  });

  // Background polling
  const pollInterval = setInterval(async () => {
    try {
      await pollVenues();
    } catch (err) {
      log.error('Venue polling failed', { err: err as Error });
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('Venue health monitor shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Venue health monitor running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
