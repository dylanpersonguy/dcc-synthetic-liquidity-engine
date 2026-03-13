import type { FastifyInstance } from 'fastify';
import { venueHealthRepo, syntheticExposureRepo, riskAlertRepo, protocolControlRepo } from '@dcc/database';

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/venues — Venue health overview
  app.get('/admin/venues', async () => {
    const venues = await venueHealthRepo.findAll();
    return {
      total: venues.length,
      healthy: venues.filter((v) => v.health_status === 'healthy').length,
      degraded: venues.filter((v) => v.health_status === 'degraded').length,
      down: venues.filter((v) => v.health_status === 'down').length,
      venues,
    };
  });

  // GET /admin/venues/:venueId — Single venue detail with connector health
  app.get<{ Params: { venueId: string } }>(
    '/admin/venues/:venueId',
    async (req, reply) => {
      const venue = await venueHealthRepo.findById(req.params.venueId);
      if (!venue) return reply.status(404).send({ error: 'Venue not found' });
      const connectors = await venueHealthRepo.getConnectorHealth(req.params.venueId);
      return { venue, connectors };
    },
  );

  // GET /admin/risk — Risk overview (synthetic exposure + alerts)
  app.get('/admin/risk', async () => {
    const [exposures, alertCounts, controls] = await Promise.all([
      syntheticExposureRepo.findAll(),
      riskAlertRepo.countActive(),
      protocolControlRepo.findAll(),
    ]);

    const state: Record<string, string> = {};
    for (const c of controls) {
      state[c.key] = c.value;
    }

    return {
      protocol: {
        paused: state['emergency_pause'] === 'true',
        circuitBreaker: state['circuit_breaker_level'] ?? 'none',
      },
      syntheticExposure: exposures,
      activeAlerts: alertCounts,
    };
  });

  // GET /admin/alerts — List alerts with filters
  app.get('/admin/alerts', async (req) => {
    const query = req.query as Record<string, string>;
    const alerts = await riskAlertRepo.findMany({
      severity: query['severity'],
      category: query['category'],
      acknowledged: query['acknowledged'] === 'true' ? true : query['acknowledged'] === 'false' ? false : undefined,
      resolved: query['resolved'] === 'true' ? true : query['resolved'] === 'false' ? false : undefined,
      limit: query['limit'] ? parseInt(query['limit'], 10) : undefined,
    });
    return { alerts };
  });

  // POST /admin/alerts/:id/acknowledge
  app.post<{ Params: { id: string }; Body: { acknowledgedBy: string } }>(
    '/admin/alerts/:id/acknowledge',
    async (req, reply) => {
      const result = await riskAlertRepo.acknowledge(
        parseInt(req.params.id, 10),
        req.body.acknowledgedBy,
      );
      if (!result) return reply.status(404).send({ error: 'Alert not found' });
      return result;
    },
  );

  // POST /admin/alerts/:id/resolve
  app.post<{ Params: { id: string } }>(
    '/admin/alerts/:id/resolve',
    async (req, reply) => {
      const result = await riskAlertRepo.resolve(parseInt(req.params.id, 10));
      if (!result) return reply.status(404).send({ error: 'Alert not found' });
      return result;
    },
  );

  // POST /admin/protocol/pause — Emergency pause
  app.post<{ Body: { operator?: string } }>('/admin/protocol/pause', async (req) => {
    await protocolControlRepo.set('emergency_pause', 'true', req.body.operator);
    return { ok: true, state: 'paused' };
  });

  // POST /admin/protocol/resume — Resume protocol
  app.post<{ Body: { operator?: string } }>('/admin/protocol/resume', async (req) => {
    await protocolControlRepo.set('emergency_pause', 'false', req.body.operator);
    return { ok: true, state: 'active' };
  });
}
