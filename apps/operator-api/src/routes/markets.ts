import type { FastifyInstance } from 'fastify';
import { marketRepo, marketHealthRepo, metricsRepo } from '@dcc/database';

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/markets — List all markets with health
  app.get('/admin/markets', async (req) => {
    const query = req.query as Record<string, string>;
    const markets = await marketRepo.findAll({
      status: query['status'],
      mode: query['mode'],
    });

    const healthScores = await marketHealthRepo.findAll();
    const healthMap = new Map(healthScores.map((h) => [h.pair_id, h]));

    return {
      markets: markets.map((m) => ({
        ...m,
        health: healthMap.get(m.pair_id) ?? null,
      })),
    };
  });

  // GET /admin/markets/:pairId — Single market detail
  app.get<{ Params: { pairId: string } }>('/admin/markets/:pairId', async (req, reply) => {
    const market = await marketRepo.findById(req.params.pairId);
    if (!market) return reply.status(404).send({ error: 'Market not found' });

    const [health, execMetrics, routeMetrics] = await Promise.all([
      marketHealthRepo.findById(req.params.pairId),
      metricsRepo.getExecutionMetrics(req.params.pairId, 24),
      metricsRepo.getRouteMetrics(req.params.pairId, 24),
    ]);

    return { market, health, execMetrics, routeMetrics };
  });

  // POST /admin/markets/:pairId/pause
  app.post<{ Params: { pairId: string }; Body: { operator?: string } }>(
    '/admin/markets/:pairId/pause',
    async (req, reply) => {
      const market = await marketRepo.updateStatus(req.params.pairId, 'paused');
      if (!market) return reply.status(404).send({ error: 'Market not found' });
      return { ok: true, market };
    },
  );

  // POST /admin/markets/:pairId/unpause
  app.post<{ Params: { pairId: string }; Body: { operator?: string } }>(
    '/admin/markets/:pairId/unpause',
    async (req, reply) => {
      const market = await marketRepo.updateStatus(req.params.pairId, 'active');
      if (!market) return reply.status(404).send({ error: 'Market not found' });
      return { ok: true, market };
    },
  );
}
