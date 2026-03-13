import type { FastifyInstance } from 'fastify';
import { registry } from '@dcc/metrics';

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  // GET /metrics — Prometheus-compatible metrics endpoint
  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  // GET /health — Basic health check
  app.get('/health', async () => {
    return { status: 'ok', service: 'operator-api', timestamp: new Date().toISOString() };
  });
}
