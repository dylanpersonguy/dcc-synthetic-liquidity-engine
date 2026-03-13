import type { FastifyInstance } from 'fastify';
import {
  executionRepo, marketRepo, relayerRepo, venueHealthRepo,
  marketHealthRepo, syntheticExposureRepo, riskAlertRepo,
  protocolControlRepo, metricsRepo,
} from '@dcc/database';

export async function summaryRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/summary — Operator dashboard summary
  app.get('/admin/summary', async () => {
    const [
      marketCounts,
      execMetrics,
      relayers,
      venues,
      alertCounts,
      protocolState,
    ] = await Promise.all([
      marketRepo.count(),
      metricsRepo.getGlobalExecutionSummary(24),
      relayerRepo.findAll(),
      venueHealthRepo.findAll(),
      riskAlertRepo.countActive(),
      protocolControlRepo.findAll(),
    ]);

    const controls: Record<string, string> = {};
    for (const c of protocolState) {
      controls[c.key] = c.value;
    }

    return {
      protocol: {
        paused: controls['emergency_pause'] === 'true',
        circuitBreaker: controls['circuit_breaker_level'] ?? 'none',
      },
      markets: {
        total: Object.values(marketCounts).reduce((a, b) => a + b, 0),
        byStatus: marketCounts,
      },
      executions: {
        last24h: execMetrics,
      },
      relayers: {
        total: relayers.length,
        active: relayers.filter((r) => r.status === 'active').length,
        degraded: relayers.filter((r) => r.status === 'degraded').length,
        offline: relayers.filter((r) => r.status === 'offline').length,
      },
      venues: {
        total: venues.length,
        healthy: venues.filter((v) => v.health_status === 'healthy').length,
        degraded: venues.filter((v) => v.health_status === 'degraded').length,
        down: venues.filter((v) => v.health_status === 'down').length,
      },
      alerts: alertCounts,
    };
  });
}
