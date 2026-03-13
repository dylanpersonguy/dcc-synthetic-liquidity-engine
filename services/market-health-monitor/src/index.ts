// ============================================================================
// market-health-monitor — Market Health Scoring Engine
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Evaluate each market's health score (0-100) using weighted factors
//   2. Factors: local liquidity, external liquidity, route success rate,
//      relayer inventory coverage, synthetic utilization, venue health
//   3. Store computed scores in market_health table
//   4. Emit Prometheus metrics for market health dashboards
//   5. Detect low-health markets for alert engine consumption
//
// SCORING WEIGHTS:
//   Local Liquidity:       20%
//   External Liquidity:    15%
//   Route Success Rate:    25%
//   Avg Execution Time:    15%
//   Venue Coverage:        15%
//   Relayer Coverage:       5%
//   Synthetic Utilization:  5%
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, MarketHealthMonitorConfig } from '@dcc/config';
import {
  createPool, closePool, marketRepo, marketHealthRepo,
  venueHealthRepo, executionRepo, syntheticExposureRepo,
} from '@dcc/database';
import { createLogger, marketHealthScore, marketLiquidity } from '@dcc/metrics';

const log = createLogger('market-health-monitor');

const POLL_INTERVAL_MS = 60_000;

const WEIGHTS = {
  localLiquidity: 0.20,
  externalLiquidity: 0.15,
  routeSuccessRate: 0.25,
  avgExecutionTime: 0.15,
  venueCoverage: 0.15,
  relayerCoverage: 0.05,
  syntheticUtilization: 0.05,
};

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

async function computeMarketHealth(pairId: string): Promise<{
  score: number;
  factors: Record<string, number>;
  localLiquidityUsd: string;
  externalLiquidityUsd: string;
}> {
  // Fetch execution metrics for this market
  const metrics24h = await executionRepo.getMetrics24h(pairId);
  const successRate = metrics24h.total > 0 ? metrics24h.successful / metrics24h.total : 1;

  // Venue health (count healthy venues for this market)
  const venues = await venueHealthRepo.findAll();
  const healthyVenues = venues.filter((v) => v.health_status === 'healthy').length;
  const totalVenues = venues.length || 1;
  const venueCoverageRatio = healthyVenues / totalVenues;

  // Factors — normalize each to 0-100 scale
  const factors = {
    localLiquidity: 75, // placeholder — would query on-chain AMM/orderbook
    externalLiquidity: 70, // placeholder — would aggregate external venue depth
    routeSuccessRate: successRate * 100,
    avgExecutionTime: clamp(100 - (metrics24h.pending * 2), 0, 100),
    venueCoverage: venueCoverageRatio * 100,
    relayerCoverage: 80, // placeholder — would check relayer inventory for this pair
    syntheticUtilization: 90, // placeholder — would compare supply/cap
  };

  const score = Math.round(
    factors.localLiquidity * WEIGHTS.localLiquidity +
    factors.externalLiquidity * WEIGHTS.externalLiquidity +
    factors.routeSuccessRate * WEIGHTS.routeSuccessRate +
    factors.avgExecutionTime * WEIGHTS.avgExecutionTime +
    factors.venueCoverage * WEIGHTS.venueCoverage +
    factors.relayerCoverage * WEIGHTS.relayerCoverage +
    factors.syntheticUtilization * WEIGHTS.syntheticUtilization,
  );

  return {
    score: clamp(score, 0, 100),
    factors,
    localLiquidityUsd: '0',
    externalLiquidityUsd: '0',
  };
}

async function evaluateAllMarkets(): Promise<void> {
  const markets = await marketRepo.findAll({ status: 'active' });

  for (const market of markets) {
    try {
      const health = await computeMarketHealth(market.pair_id);

      await marketHealthRepo.upsert({
        pair_id: market.pair_id,
        health_score: String(health.score),
        local_liquidity_usd: health.localLiquidityUsd,
        external_liquidity_usd: health.externalLiquidityUsd,
        route_success_rate_24h: String((health.factors['routeSuccessRate'] ?? 0) / 100),
        avg_execution_time_ms: 0,
        active_venues: Math.round((health.factors['venueCoverage'] ?? 0) / 20),
        relayer_coverage: String((health.factors['relayerCoverage'] ?? 0) / 100),
        synthetic_utilization: String((health.factors['syntheticUtilization'] ?? 0) / 100),
        factors: health.factors,
        updated_at: new Date(),
      });

      marketHealthScore.set({ pair_id: market.pair_id }, health.score);
      marketLiquidity.set(
        { pair_id: market.pair_id, source: 'local' },
        parseFloat(health.localLiquidityUsd),
      );
      marketLiquidity.set(
        { pair_id: market.pair_id, source: 'external' },
        parseFloat(health.externalLiquidityUsd),
      );

      log.debug('Market health computed', {
        pairId: market.pair_id,
        score: health.score,
        event: 'market_health_computed',
      });
    } catch (err) {
      log.error('Market health computation failed', {
        pairId: market.pair_id,
        err: err as Error,
      });
    }
  }
}

async function main() {
  const config = parseConfig(MarketHealthMonitorConfig);
  log.info('Starting market-health-monitor', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Get all market health scores
  app.get('/markets/health', async () => {
    const scores = await marketHealthRepo.findAll();
    return { markets: scores };
  });

  // Get single market health
  app.get<{ Params: { pairId: string } }>('/markets/:pairId/health', async (req, reply) => {
    const health = await marketHealthRepo.findById(req.params.pairId);
    if (!health) return reply.status(404).send({ error: 'Market health not found' });
    return health;
  });

  // Force re-evaluation
  app.post('/markets/health/evaluate', async () => {
    await evaluateAllMarkets();
    return { ok: true };
  });

  // Background polling
  const pollInterval = setInterval(async () => {
    try {
      await evaluateAllMarkets();
    } catch (err) {
      log.error('Market health evaluation failed', { err: err as Error });
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('Market health monitor shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Market health monitor running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
