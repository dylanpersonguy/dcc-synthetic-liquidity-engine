// ============================================================================
// execution-service — Execution Lifecycle Orchestration
// ============================================================================
//
// Accepts execution intents from users, validates them, creates execution
// records, and dispatches to the relayer service for cross-chain routes.
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, ExecutionServiceConfig } from '@dcc/config';
import { createPool, closePool, executionRepo } from '@dcc/database';
import { executionTotal, executionPending, createLogger } from '@dcc/metrics';
import { randomUUID } from 'node:crypto';

const log = createLogger('execution-service');

const ROUTER_SERVICE_URL = process.env['ROUTER_SERVICE_URL'] ?? 'http://localhost:3212';
const RELAYER_SERVICE_URL = process.env['RELAYER_SERVICE_URL'] ?? 'http://localhost:3200';
const EXECUTION_TRACKER_URL = process.env['EXECUTION_TRACKER_URL'] ?? 'http://localhost:3101';

// ── Valid Execution States ──────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  quote_created: ['route_locked', 'expired', 'failed'],
  route_locked: ['local_leg_pending', 'external_leg_pending', 'failed', 'expired'],
  local_leg_pending: ['local_leg_complete', 'failed'],
  local_leg_complete: ['external_leg_pending', 'awaiting_delivery', 'completed', 'partially_filled'],
  external_leg_pending: ['external_leg_complete', 'failed'],
  external_leg_complete: ['awaiting_delivery', 'completed', 'partially_filled'],
  awaiting_delivery: ['completed', 'failed'],
  partially_filled: ['completed', 'refunded', 'failed'],
  failed: ['refunded'],
  expired: ['refunded'],
};

const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'refunded']);

// ── Nonce Tracking (in-memory for vertical slice) ───────────────────────

const userNonces = new Map<string, number>();

// ── In-Memory Execution Cache (supplements DB) ──────────────────────────

const executionCache = new Map<string, any>();

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(ExecutionServiceConfig);
  log.info('Starting execution-service', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // POST /executions — create a new execution
  app.post<{
    Body: {
      pairId: string;
      side: string;
      amount: string;
      userAddress: string;
      destinationAddress: string;
      destinationChain: string;
      minOutputAmount?: string;
      signature?: string;
    };
  }>('/executions', async (req, reply) => {
    const {
      pairId, side, amount, userAddress,
      destinationAddress, destinationChain,
      minOutputAmount, signature,
    } = req.body;

    if (!pairId || !amount || !userAddress) {
      return reply.status(400).send({ error: 'Missing required fields: pairId, amount, userAddress' });
    }

    const executionId = `exec-${randomUUID()}`;

    // Nonce enforcement
    const prevNonce = userNonces.get(userAddress) ?? 0;
    const nonce = prevNonce + 1;
    userNonces.set(userAddress, nonce);

    try {
      // Step 1: Get a quote + route from the router service
      const routeResp = await fetch(`${ROUTER_SERVICE_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairId, side: side ?? 'SELL', amount }),
      });

      if (!routeResp.ok) {
        const err = await routeResp.json() as Record<string, unknown>;
        return reply.status(400).send({ error: 'Route planning failed', ...err });
      }

      const { routePlan } = (await routeResp.json()) as { routePlan: any };

      // Step 2: Create execution record
      const now = Date.now();
      const execution = {
        execution_id: executionId,
        route_id: routePlan.routeId,
        quote_id: routePlan.quoteId,
        pair_id: pairId,
        mode: routePlan.mode,
        user_address: userAddress,
        input_asset: routePlan.legs[0]?.tokenIn ?? pairId.split('/')[0] ?? '',
        output_asset: routePlan.legs[routePlan.legs.length - 1]?.tokenOut ?? pairId.split('/')[1] ?? '',
        amount_in: amount,
        expected_amount_out: routePlan.expectedOutputAmount,
        actual_amount_out: null,
        status: 'quote_created',
        relayer_id: null,
        settlement_mode: routePlan.mode,
        failure_reason: null,
        refund_eligible: false,
        refunded_at: null,
        escrow_address: null,
        escrow_expires_at: null,
        delivery_tx_hash: null,
        metadata: {
          nonce,
          signature: signature ?? 'paper-mode',
          destinationAddress,
          destinationChain,
          minOutputAmount: minOutputAmount ?? '0',
          routePlan,
        },
      };

      // Persist to database
      try {
        await executionRepo.create(execution);
      } catch (dbErr) {
        log.warn('DB write failed, using in-memory fallback', { executionId });
      }

      // Cache in-memory
      executionCache.set(executionId, {
        ...execution,
        created_at: new Date(now),
        updated_at: new Date(now),
        completed_at: null,
      });

      // Step 3: Transition to route_locked
      await transitionExecution(executionId, 'route_locked');

      // Step 4: If TELEPORT, dispatch to relayer
      if (routePlan.requiresRelayer) {
        await transitionExecution(executionId, 'local_leg_pending');

        // Simulate local leg completion (DCC → USDC)
        await transitionExecution(executionId, 'local_leg_complete');
        await transitionExecution(executionId, 'external_leg_pending');

        // Dispatch to relayer service
        try {
          await fetch(`${RELAYER_SERVICE_URL}/intake`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              executionId,
              routeId: routePlan.routeId,
              quoteId: routePlan.quoteId,
              pairId,
              mode: routePlan.mode,
              legs: routePlan.legs,
              inputAmount: amount,
              expectedOutputAmount: routePlan.expectedOutputAmount,
              userAddress,
              destinationAddress,
              destinationChain,
            }),
          });
        } catch (relayerErr) {
          log.warn('Relayer dispatch failed (paper mode continues)', { executionId });
          // In paper mode, simulate completion anyway
          await transitionExecution(executionId, 'external_leg_complete');
          await transitionExecution(executionId, 'completed');
        }
      } else {
        // LOCAL mode — simulate direct execution
        await transitionExecution(executionId, 'local_leg_pending');
        await transitionExecution(executionId, 'local_leg_complete');
        await transitionExecution(executionId, 'completed');
      }

      const finalExecution = executionCache.get(executionId);

      executionTotal.inc({ pair_id: pairId, status: finalExecution?.status ?? 'quote_created', mode: routePlan.mode });

      return reply.status(201).send({
        executionId,
        status: finalExecution?.status ?? 'quote_created',
        routeId: routePlan.routeId,
        quoteId: routePlan.quoteId,
        mode: routePlan.mode,
        inputAmount: amount,
        expectedOutputAmount: routePlan.expectedOutputAmount,
        legs: routePlan.legs,
        nonce,
        createdAt: now,
      });
    } catch (err) {
      log.error('Execution creation failed', { executionId, err: err as Error });
      return reply.status(500).send({ error: 'Execution failed' });
    }
  });

  // GET /executions — list executions
  app.get<{ Querystring: { status?: string; pairId?: string; limit?: string } }>(
    '/executions',
    async (req) => {
      const filter = {
        status: req.query.status,
        pairId: req.query.pairId,
        limit: parseInt(req.query.limit ?? '50', 10),
      };

      try {
        const rows = await executionRepo.findMany(filter);
        return { executions: rows };
      } catch {
        // DB unavailable — return cached executions
        const all = Array.from(executionCache.values());
        return { executions: all.slice(0, filter.limit) };
      }
    },
  );

  // GET /executions/:id — get execution details
  app.get<{ Params: { id: string } }>('/executions/:id', async (req, reply) => {
    const id = req.params.id;

    try {
      const execution = await executionRepo.findById(id);
      if (execution) {
        const legs = await executionRepo.getLegs(id);
        return { execution, legs };
      }
    } catch {
      // DB unavailable
    }

    const cached = executionCache.get(id);
    if (cached) {
      return { execution: cached, legs: cached.metadata?.routePlan?.legs ?? [] };
    }

    return reply.status(404).send({ error: 'Execution not found' });
  });

  // GET /health
  app.get('/health', async () => ({
    status: 'ok',
    activeExecutions: executionCache.size,
    routerServiceUrl: ROUTER_SERVICE_URL,
    relayerServiceUrl: RELAYER_SERVICE_URL,
  }));

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await closePool();
    log.info('Execution service shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Execution service running', { port: config.PORT });
}

async function transitionExecution(executionId: string, toStatus: string): Promise<void> {
  const cached = executionCache.get(executionId);
  if (!cached) return;

  const fromStatus = cached.status;
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed?.includes(toStatus)) {
    log.warn('Invalid execution transition', { executionId, from: fromStatus, to: toStatus });
    return;
  }

  cached.status = toStatus;
  cached.updated_at = new Date();
  if (TERMINAL_STATES.has(toStatus)) {
    cached.completed_at = new Date();
  }
  executionCache.set(executionId, cached);

  // Update DB
  try {
    await executionRepo.updateStatus(executionId, toStatus);
    await executionRepo.recordTransition(executionId, fromStatus, toStatus);
  } catch {
    // DB unavailable, in-memory only
  }

  // Notify execution tracker
  try {
    await fetch(`${EXECUTION_TRACKER_URL}/track/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId, toStatus, reason: 'auto-transition' }),
    });
  } catch {
    // Tracker unavailable
  }

  log.info('Execution transitioned', { executionId, from: fromStatus, to: toStatus });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
