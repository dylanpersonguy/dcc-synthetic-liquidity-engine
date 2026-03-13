import type { FastifyInstance } from 'fastify';
import { executionRepo } from '@dcc/database';

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/executions — List executions with cursor pagination
  app.get('/admin/executions', async (req) => {
    const query = req.query as Record<string, string>;
    const executions = await executionRepo.findMany({
      status: query['status'],
      pairId: query['pairId'],
      relayerId: query['relayerId'],
      limit: query['limit'] ? parseInt(query['limit'], 10) : undefined,
      cursor: query['cursor'],
    });

    const nextCursor = executions.length > 0
      ? executions[executions.length - 1]!.created_at.toISOString()
      : null;

    return {
      executions,
      nextCursor,
    };
  });

  // GET /admin/executions/:executionId — Single execution detail with legs
  app.get<{ Params: { executionId: string } }>(
    '/admin/executions/:executionId',
    async (req, reply) => {
      const execution = await executionRepo.findById(req.params.executionId);
      if (!execution) return reply.status(404).send({ error: 'Execution not found' });

      const legs = await executionRepo.getLegs(req.params.executionId);
      return { execution, legs };
    },
  );

  // GET /admin/executions/stats — Execution status distribution
  app.get('/admin/executions/stats', async () => {
    const [statusCounts, metrics24h] = await Promise.all([
      executionRepo.countByStatus(),
      executionRepo.getMetrics24h(),
    ]);

    return { statusCounts, metrics24h };
  });
}
