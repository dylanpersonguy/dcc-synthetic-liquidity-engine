import type { FastifyInstance } from 'fastify';
import { relayerRepo } from '@dcc/database';

export async function relayerRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/relayers — List all relayers
  app.get('/admin/relayers', async () => {
    const relayers = await relayerRepo.findAll();
    return {
      total: relayers.length,
      active: relayers.filter((r) => r.status === 'active').length,
      degraded: relayers.filter((r) => r.status === 'degraded').length,
      offline: relayers.filter((r) => r.status === 'offline').length,
      relayers,
    };
  });

  // GET /admin/relayers/:relayerId — Single relayer detail with inventory
  app.get<{ Params: { relayerId: string } }>(
    '/admin/relayers/:relayerId',
    async (req, reply) => {
      const relayer = await relayerRepo.findById(req.params.relayerId);
      if (!relayer) return reply.status(404).send({ error: 'Relayer not found' });

      const inventory = await relayerRepo.getInventory(req.params.relayerId);
      return { relayer, inventory };
    },
  );
}
