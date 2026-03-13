// ============================================================================
// protocol-control — Protocol Safety Switches
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Emergency pause / resume entire protocol
//   2. Per-market pause / unpause
//   3. Circuit breaker management (none → soft_pause → hard_pause)
//   4. Per-market cap overrides
//   5. Audit log of all control actions
//   6. Emit protocol state as Prometheus metrics
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, ProtocolControlServiceConfig } from '@dcc/config';
import { createPool, closePool, protocolControlRepo, marketRepo, riskAlertRepo } from '@dcc/database';
import { createLogger, protocolPaused, circuitBreakerLevel as circuitBreakerGauge } from '@dcc/metrics';

const log = createLogger('protocol-control');

const CB_LEVELS: Record<string, number> = { none: 0, soft_pause: 1, hard_pause: 2 };

async function refreshMetrics(): Promise<void> {
  const paused = await protocolControlRepo.isEmergencyPaused();
  protocolPaused.set(paused ? 1 : 0);

  const cbLevel = await protocolControlRepo.getCircuitBreakerLevel();
  circuitBreakerGauge.set(CB_LEVELS[cbLevel] ?? 0);
}

async function main() {
  const config = parseConfig(ProtocolControlServiceConfig);
  log.info('Starting protocol-control', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // ---- Protocol-Wide Controls ----

  // Emergency pause
  app.post<{ Body: { operator?: string } }>('/protocol/pause', async (req) => {
    await protocolControlRepo.set('emergency_pause', 'true', req.body.operator);
    log.warn('PROTOCOL EMERGENCY PAUSE activated', {
      operator: req.body.operator,
      event: 'emergency_pause',
    });

    await riskAlertRepo.create({
      severity: 'critical',
      category: 'protocol_pause',
      title: 'Protocol Emergency Pause',
      message: `Emergency pause activated by ${req.body.operator ?? 'system'}`,
      source_service: 'protocol-control',
      pair_id: null,
      venue_id: null,
      relayer_id: null,
      threshold_value: null,
      actual_value: null,
      metadata: { operator: req.body.operator },
    });

    await refreshMetrics();
    return { ok: true, state: 'paused' };
  });

  // Resume protocol
  app.post<{ Body: { operator?: string } }>('/protocol/resume', async (req) => {
    await protocolControlRepo.set('emergency_pause', 'false', req.body.operator);
    log.info('Protocol resumed', { operator: req.body.operator, event: 'protocol_resume' });
    await refreshMetrics();
    return { ok: true, state: 'active' };
  });

  // Set circuit breaker level
  app.post<{ Body: { level: string; operator?: string } }>('/protocol/circuit-breaker', async (req, reply) => {
    const { level, operator } = req.body;
    if (!['none', 'soft_pause', 'hard_pause'].includes(level)) {
      return reply.status(400).send({ error: 'Invalid circuit breaker level' });
    }
    await protocolControlRepo.set('circuit_breaker_level', level, operator);
    log.warn('Circuit breaker level changed', { level, operator, event: 'circuit_breaker_change' });
    await refreshMetrics();
    return { ok: true, level };
  });

  // Get protocol state
  app.get('/protocol/state', async () => {
    const controls = await protocolControlRepo.findAll();
    const state: Record<string, string> = {};
    for (const c of controls) {
      state[c.key] = c.value;
    }
    return state;
  });

  // ---- Per-Market Controls ----

  // Pause a market
  app.post<{ Params: { pairId: string }; Body: { operator?: string } }>(
    '/markets/:pairId/pause',
    async (req, reply) => {
      const market = await marketRepo.updateStatus(req.params.pairId, 'paused');
      if (!market) return reply.status(404).send({ error: 'Market not found' });

      log.warn('Market paused', {
        pairId: req.params.pairId,
        operator: req.body.operator,
        event: 'market_pause',
      });
      return { ok: true, pairId: req.params.pairId, status: 'paused' };
    },
  );

  // Unpause a market
  app.post<{ Params: { pairId: string }; Body: { operator?: string } }>(
    '/markets/:pairId/unpause',
    async (req, reply) => {
      const market = await marketRepo.updateStatus(req.params.pairId, 'active');
      if (!market) return reply.status(404).send({ error: 'Market not found' });

      log.info('Market unpaused', {
        pairId: req.params.pairId,
        operator: req.body.operator,
        event: 'market_unpause',
      });
      return { ok: true, pairId: req.params.pairId, status: 'active' };
    },
  );

  // Set per-market circuit breaker
  app.post<{ Params: { pairId: string }; Body: { level: string; operator?: string } }>(
    '/markets/:pairId/circuit-breaker',
    async (req, reply) => {
      const { level, operator } = req.body;
      if (!['none', 'soft_pause', 'hard_pause'].includes(level)) {
        return reply.status(400).send({ error: 'Invalid circuit breaker level' });
      }
      const market = await marketRepo.updateCircuitBreaker(req.params.pairId, level);
      if (!market) return reply.status(404).send({ error: 'Market not found' });

      log.warn('Market circuit breaker changed', {
        pairId: req.params.pairId,
        level,
        operator,
        event: 'market_circuit_breaker',
      });
      return { ok: true, pairId: req.params.pairId, circuitBreaker: level };
    },
  );

  // Refresh metrics on interval
  const metricsInterval = setInterval(async () => {
    try {
      await refreshMetrics();
    } catch (err) {
      log.error('Metrics refresh failed', { err: err as Error });
    }
  }, 15_000);

  const shutdown = async () => {
    clearInterval(metricsInterval);
    await app.close();
    await closePool();
    log.info('Protocol control shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Protocol control running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
