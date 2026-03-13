import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@dcc/metrics';

const log = createLogger('operator-api');

export async function requestLogger(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const duration = Date.now() - ((req as any).startTime ?? Date.now());
    log.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs: duration,
      event: 'http_request',
    });
  });
}
