// ============================================================================
// operator-api — Operator Dashboard REST API
// ============================================================================
//
// ENDPOINTS:
//   GET  /health                          — Health check
//   GET  /metrics                         — Prometheus metrics
//   GET  /admin/summary                   — Dashboard overview
//   GET  /admin/markets                   — List markets with health
//   GET  /admin/markets/:pairId           — Market detail
//   POST /admin/markets/:pairId/pause     — Pause market
//   POST /admin/markets/:pairId/unpause   — Unpause market
//   GET  /admin/executions                — List executions (cursor pagination)
//   GET  /admin/executions/:executionId   — Execution detail with legs
//   GET  /admin/executions/stats          — Execution statistics
//   GET  /admin/relayers                  — List relayers
//   GET  /admin/relayers/:relayerId       — Relayer detail with inventory
//   GET  /admin/venues                    — Venue health overview
//   GET  /admin/venues/:venueId           — Venue detail with connectors
//   GET  /admin/risk                      — Risk overview
//   GET  /admin/alerts                    — List alerts
//   POST /admin/alerts/:id/acknowledge    — Acknowledge alert
//   POST /admin/alerts/:id/resolve        — Resolve alert
//   POST /admin/protocol/pause            — Emergency pause
//   POST /admin/protocol/resume           — Resume protocol
//
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, OperatorApiConfig } from '@dcc/config';
import { createPool, closePool } from '@dcc/database';
import { createLogger, setLogLevel } from '@dcc/metrics';
import { requestLogger } from './middleware/request-logger.js';
import { summaryRoutes } from './routes/summary.js';
import { marketRoutes } from './routes/markets.js';
import { executionRoutes } from './routes/executions.js';
import { relayerRoutes } from './routes/relayers.js';
import { monitoringRoutes } from './routes/monitoring.js';
import { metricsRoute } from './routes/metrics.js';

const log = createLogger('operator-api');

async function main() {
  const config = parseConfig(OperatorApiConfig);
  setLogLevel(config.LOG_LEVEL);
  log.info('Starting operator-api', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // CORS for operator dashboard frontend
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Register middleware and routes
  await app.register(requestLogger);
  await app.register(metricsRoute);
  await app.register(summaryRoutes);
  await app.register(marketRoutes);
  await app.register(executionRoutes);
  await app.register(relayerRoutes);
  await app.register(monitoringRoutes);

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await closePool();
    log.info('Operator API shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Operator API running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
