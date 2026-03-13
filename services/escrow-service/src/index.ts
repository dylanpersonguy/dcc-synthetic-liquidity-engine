// ============================================================================
// escrow-service — Execution Escrow + Finalization + Refund System
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Accept escrow intents and create on-chain deposits
//   2. Manage execution lifecycle through 12-state machine
//   3. Handle relayer confirmations for external execution
//   4. Process partial fills with proportional refunds
//   5. Enforce timeout-based automatic expiration
//   6. Process refunds for failed/expired/partial executions
//   7. Track all state transitions in audit log
//   8. Emit structured events for monitoring
//   9. Expose metrics for operational visibility
//
// STATE MACHINE:
//   created → funds_locked → route_locked → local_leg_executed
//   route_locked → external_leg_pending → external_leg_confirmed
//   external_leg_confirmed → delivery_pending → completed
//   external_leg_pending → partially_completed → refunded
//   Any non-terminal → failed | expired → refunded
//
// PORT: 3300
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, EscrowServiceConfig } from '@dcc/config';
import { createPool, closePool, escrowIntentRepo, escrowTransitionRepo, escrowEventRepo, relayerConfirmationRepo } from '@dcc/database';
import { createLogger, registry, escrowIntentsCreated, escrowIntentsCompleted, escrowIntentsFailed, escrowIntentsRefunded, escrowPartialFills, escrowActiveIntents, escrowSettlementLatency, escrowRefundVolume, escrowRelayerConfirmations } from '@dcc/metrics';
import { transitionEscrow, validateEscrowIntent, isRefundableStatus } from './state-machine.js';
import { startTimeoutMonitor, stopTimeoutMonitor, processAutoRefunds } from './timeout-monitor.js';
import type { EscrowExecutionStatus } from '@dcc/types';

// ============================================================================
// Zod Schemas for Request Validation
// ============================================================================

const CreateIntentSchema = z.object({
  executionId: z.string().min(1),
  userAddress: z.string().min(1),
  pairId: z.string().min(1),
  inputAsset: z.string().min(1),
  outputAsset: z.string().min(1),
  amountIn: z.string().regex(/^\d+(\.\d+)?$/),
  expectedAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
  minAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
  routePlanHash: z.string().min(1),
  executionMode: z.enum(['LOCAL', 'TELEPORT', 'SYNTHETIC', 'REDEEMABLE']),
  relayerId: z.string().nullable().default(null),
  expiresAt: z.number().int().positive(),
  nonce: z.number().int().positive(),
  signature: z.string().min(1),
});

const LockRouteSchema = z.object({
  executionId: z.string().min(1),
  routeHash: z.string().min(1),
});

const MarkLocalSchema = z.object({
  executionId: z.string().min(1),
  localAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
});

const ConfirmExternalSchema = z.object({
  executionId: z.string().min(1),
  relayerId: z.string().min(1),
  actualAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
  txHash: z.string().min(1),
  chain: z.string().min(1),
  proofData: z.string().min(1),
  signature: z.string().min(1),
});

const CompleteSchema = z.object({
  executionId: z.string().min(1),
  outputAmount: z.string().regex(/^\d+(\.\d+)?$/),
});

const PartialFillSchema = z.object({
  executionId: z.string().min(1),
  partialAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
  proofData: z.string().min(1),
});

const FailSchema = z.object({
  executionId: z.string().min(1),
  reason: z.string().min(1),
});

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseConfig(EscrowServiceConfig);
  const logger = createLogger('escrow-service');

  // Database
  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  // Fastify
  const app = Fastify({ logger: false });

  // ======================================================================
  // Health
  // ======================================================================

  app.get('/health', async () => {
    const activeCount = await escrowIntentRepo.getActiveCount();
    return { status: 'ok', service: 'escrow-service', activeIntents: activeCount };
  });

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    reply.header('content-type', registry.contentType);
    return metrics;
  });

  // ======================================================================
  // POST /escrow/create — Create Execution Intent
  // ======================================================================

  app.post('/escrow/create', async (req, reply) => {
    const parsed = CreateIntentSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const data = parsed.data;

    // Validate intent
    const validation = await validateEscrowIntent({
      executionId: data.executionId,
      userAddress: data.userAddress,
      amountIn: data.amountIn,
      expectedAmountOut: data.expectedAmountOut,
      minAmountOut: data.minAmountOut,
      expiresAt: data.expiresAt,
      nonce: data.nonce,
    });

    if (!validation.valid) {
      reply.status(400);
      return { error: 'INTENT_VALIDATION_FAILED', message: validation.error };
    }

    // Create escrow record
    const row = await escrowIntentRepo.create({
      execution_id: data.executionId,
      user_address: data.userAddress,
      pair_id: data.pairId,
      input_asset: data.inputAsset,
      output_asset: data.outputAsset,
      amount_in: data.amountIn,
      expected_amount_out: data.expectedAmountOut,
      min_amount_out: data.minAmountOut,
      actual_amount_out: null,
      status: 'funds_locked',
      route_plan_hash: data.routePlanHash,
      execution_mode: data.executionMode,
      relayer_id: data.relayerId,
      nonce: data.nonce,
      escrow_tx_id: null,
      refund_tx_id: null,
      completion_tx_id: null,
      refund_amount: null,
      proof_data: null,
      failure_reason: null,
      expires_at: new Date(data.expiresAt),
      metadata: { signature: data.signature },
    });

    // Record initial transition
    await escrowTransitionRepo.record(
      data.executionId, null, 'funds_locked',
      data.userAddress, 'Escrow intent created',
    );

    // Emit event
    await escrowEventRepo.emit({
      event_type: 'ExecutionCreated',
      execution_id: data.executionId,
      user_address: data.userAddress,
      pair_id: data.pairId,
      amount_in: data.amountIn,
      amount_out: null,
      refund_amount: null,
      relayer_id: data.relayerId,
      proof_data: null,
      reason: null,
    });

    escrowIntentsCreated.inc({ pair_id: data.pairId, execution_mode: data.executionMode });

    logger.info('Escrow intent created', { executionId: data.executionId, pairId: data.pairId });

    reply.status(201);
    return { executionId: row.execution_id, status: row.status };
  });

  // ======================================================================
  // POST /escrow/lock-route — Lock Route
  // ======================================================================

  app.post('/escrow/lock-route', async (req, reply) => {
    const parsed = LockRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionId, routeHash } = parsed.data;

    // Verify route hash matches
    const current = await escrowIntentRepo.findById(executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND', message: `Escrow not found: ${executionId}` };
    }

    if (current.route_plan_hash !== routeHash) {
      reply.status(400);
      return { error: 'ROUTE_HASH_MISMATCH', message: 'Route hash does not match' };
    }

    const updated = await transitionEscrow(
      executionId, 'route_locked', 'settlement-service',
      undefined, 'Route locked',
    );

    return { executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/mark-local — Mark Local Leg Executed
  // ======================================================================

  app.post('/escrow/mark-local', async (req, reply) => {
    const parsed = MarkLocalSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionId, localAmountOut } = parsed.data;

    const updated = await transitionEscrow(
      executionId, 'local_leg_executed', 'settlement-service',
      { actual_amount_out: localAmountOut },
      'Local leg executed',
    );

    return { executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/mark-external-pending
  // ======================================================================

  app.post('/escrow/mark-external-pending', async (req, reply) => {
    const body = req.body as { executionId?: string };
    if (!body.executionId) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', message: 'executionId required' };
    }

    const updated = await transitionEscrow(
      body.executionId, 'external_leg_pending', 'settlement-service',
      undefined, 'External leg pending',
    );

    return { executionId: body.executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/confirm-external — Relayer Confirmation
  // ======================================================================

  app.post('/escrow/confirm-external', async (req, reply) => {
    const parsed = ConfirmExternalSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const data = parsed.data;

    // Verify escrow exists and relayer matches
    const current = await escrowIntentRepo.findById(data.executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    if (current.relayer_id && current.relayer_id !== data.relayerId) {
      reply.status(403);
      return { error: 'RELAYER_MISMATCH', message: 'Not the assigned relayer' };
    }

    // Validate minimum output
    const minOut = parseFloat(current.min_amount_out);
    const actualOut = parseFloat(data.actualAmountOut);
    if (actualOut < minOut) {
      reply.status(400);
      return { error: 'BELOW_MINIMUM', message: `Amount ${data.actualAmountOut} below minimum ${current.min_amount_out}` };
    }

    // Check not expired
    if (new Date() > current.expires_at) {
      reply.status(400);
      return { error: 'EXPIRED', message: 'Execution has expired' };
    }

    // Store relayer confirmation
    await relayerConfirmationRepo.create({
      execution_id: data.executionId,
      relayer_id: data.relayerId,
      actual_amount_out: data.actualAmountOut,
      tx_hash: data.txHash,
      chain: data.chain,
      proof_data: data.proofData,
      signature: data.signature,
    });

    // Transition state
    const updated = await transitionEscrow(
      data.executionId, 'external_leg_confirmed', data.relayerId,
      { actual_amount_out: data.actualAmountOut, proof_data: data.proofData },
      'External execution confirmed by relayer',
    );

    escrowRelayerConfirmations.inc({ relayer_id: data.relayerId, chain: data.chain });

    logger.info(
      'External execution confirmed',
      { executionId: data.executionId, relayerId: data.relayerId, actualAmountOut: data.actualAmountOut },
    );

    return { executionId: data.executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/mark-delivery-pending
  // ======================================================================

  app.post('/escrow/mark-delivery-pending', async (req, reply) => {
    const body = req.body as { executionId?: string };
    if (!body.executionId) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', message: 'executionId required' };
    }

    const updated = await transitionEscrow(
      body.executionId, 'delivery_pending', 'settlement-service',
      undefined, 'Delivery pending',
    );

    return { executionId: body.executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/complete — Complete Execution (final delivery)
  // ======================================================================

  app.post('/escrow/complete', async (req, reply) => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionId, outputAmount } = parsed.data;

    // Verify minimum output
    const current = await escrowIntentRepo.findById(executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const minOut = parseFloat(current.min_amount_out);
    const actualOut = parseFloat(outputAmount);
    if (actualOut < minOut) {
      reply.status(400);
      return { error: 'BELOW_MINIMUM', message: `Output ${outputAmount} below minimum ${current.min_amount_out}` };
    }

    const updated = await transitionEscrow(
      executionId, 'completed', 'settlement-service',
      { actual_amount_out: outputAmount, settled_at: new Date() },
      'Execution completed',
    );

    // Update metrics
    escrowIntentsCompleted.inc({
      pair_id: current.pair_id,
      execution_mode: current.execution_mode,
    });

    const settlementMs = Date.now() - current.created_at.getTime();
    escrowSettlementLatency.observe(
      { pair_id: current.pair_id, execution_mode: current.execution_mode },
      settlementMs,
    );

    logger.info(
      'Escrow execution completed',
      { executionId, outputAmount, settlementMs: String(settlementMs) },
    );

    return { executionId, status: updated?.status, outputAmount };
  });

  // ======================================================================
  // POST /escrow/partial-fill — Partial Fill
  // ======================================================================

  app.post('/escrow/partial-fill', async (req, reply) => {
    const parsed = PartialFillSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionId, partialAmountOut, proofData } = parsed.data;

    const current = await escrowIntentRepo.findById(executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    // Calculate proportional refund
    const amountIn = parseFloat(current.amount_in);
    const expectedOut = parseFloat(current.expected_amount_out);
    const partialOut = parseFloat(partialAmountOut);

    const filledPortion = (partialOut / expectedOut) * amountIn;
    const refundAmount = (amountIn - filledPortion).toFixed(8);

    const updated = await transitionEscrow(
      executionId, 'partially_completed', 'settlement-service',
      {
        actual_amount_out: partialAmountOut,
        refund_amount: refundAmount,
        proof_data: proofData,
      },
      'Partial fill received',
    );

    escrowPartialFills.inc({ pair_id: current.pair_id });

    logger.info(
      'Partial fill processed',
      { executionId, partialAmountOut, refundAmount },
    );

    return {
      executionId,
      status: updated?.status,
      partialAmountOut,
      refundAmount,
    };
  });

  // ======================================================================
  // POST /escrow/fail — Mark Execution Failed
  // ======================================================================

  app.post('/escrow/fail', async (req, reply) => {
    const parsed = FailSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.issues };
    }

    const { executionId, reason } = parsed.data;

    const current = await escrowIntentRepo.findById(executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const updated = await transitionEscrow(
      executionId, 'failed', 'settlement-service',
      { failure_reason: reason, refund_amount: current.amount_in },
      reason,
    );

    escrowIntentsFailed.inc({ pair_id: current.pair_id, failure_reason: reason });

    logger.info('Escrow execution failed', { executionId, reason });

    return { executionId, status: updated?.status };
  });

  // ======================================================================
  // POST /escrow/refund — Refund Execution
  // ======================================================================

  app.post('/escrow/refund', async (req, reply) => {
    const body = req.body as { executionId?: string };
    if (!body.executionId) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', message: 'executionId required' };
    }

    const current = await escrowIntentRepo.findById(body.executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    if (!isRefundableStatus(current.status as EscrowExecutionStatus)) {
      reply.status(400);
      return { error: 'NOT_REFUNDABLE', message: `Status ${current.status} is not refundable` };
    }

    const refundAmount = current.refund_amount ?? current.amount_in;

    const updated = await transitionEscrow(
      body.executionId, 'refunded', 'refund-processor',
      { settled_at: new Date() },
      'Refund processed',
    );

    escrowIntentsRefunded.inc({ pair_id: current.pair_id, refund_reason: current.status });
    escrowRefundVolume.inc({ asset: current.input_asset }, parseFloat(refundAmount));

    const settlementMs = Date.now() - current.created_at.getTime();
    escrowSettlementLatency.observe(
      { pair_id: current.pair_id, execution_mode: current.execution_mode },
      settlementMs,
    );

    logger.info(
      'Escrow refund processed',
      { executionId: body.executionId, refundAmount },
    );

    return { executionId: body.executionId, status: updated?.status, refundAmount };
  });

  // ======================================================================
  // POST /escrow/expire — Manual Expire (anyone can call after timeout)
  // ======================================================================

  app.post('/escrow/expire', async (req, reply) => {
    const body = req.body as { executionId?: string };
    if (!body.executionId) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', message: 'executionId required' };
    }

    const current = await escrowIntentRepo.findById(body.executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    if (new Date() <= current.expires_at) {
      reply.status(400);
      return { error: 'NOT_EXPIRED', message: 'Execution has not expired yet' };
    }

    const updated = await transitionEscrow(
      body.executionId, 'expired', 'manual-expire',
      { refund_amount: current.amount_in },
      'Execution expired (manual trigger)',
    );

    return { executionId: body.executionId, status: updated?.status };
  });

  // ======================================================================
  // GET /escrow/:executionId — Get Escrow Details
  // ======================================================================

  app.get('/escrow/:executionId', async (req, reply) => {
    const { executionId } = req.params as { executionId: string };

    const intent = await escrowIntentRepo.findById(executionId);
    if (!intent) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const transitions = await escrowTransitionRepo.findByExecution(executionId);
    const confirmations = await relayerConfirmationRepo.findByExecution(executionId);

    return {
      intent,
      transitions,
      confirmations,
    };
  });

  // ======================================================================
  // GET /escrow/:executionId/events — Get Escrow Events
  // ======================================================================

  app.get('/escrow/:executionId/events', async (req) => {
    const { executionId } = req.params as { executionId: string };
    const events = await escrowEventRepo.findByExecution(executionId);
    return { events };
  });

  // ======================================================================
  // GET /escrow/user/:userAddress/nonce — Get User Nonce
  // ======================================================================

  app.get('/escrow/user/:userAddress/nonce', async (req) => {
    const { userAddress } = req.params as { userAddress: string };
    const nonce = await escrowIntentRepo.getUserNonce(userAddress);
    return { userAddress, nonce };
  });

  // ======================================================================
  // GET /escrow/stats — Global Escrow Stats
  // ======================================================================

  app.get('/escrow/stats', async () => {
    const counts = await escrowIntentRepo.countByStatus();
    const activeCount = await escrowIntentRepo.getActiveCount();
    return { statusCounts: counts, activeIntents: activeCount };
  });

  // ======================================================================
  // GET /escrow/list — List Escrow Intents (filtered)
  // ======================================================================

  app.get('/escrow/list', async (req) => {
    const query = req.query as Record<string, string>;
    const intents = await escrowIntentRepo.findMany({
      status: query['status'],
      userAddress: query['userAddress'],
      pairId: query['pairId'],
      relayerId: query['relayerId'],
      executionMode: query['executionMode'],
      limit: query['limit'] ? parseInt(query['limit'], 10) : undefined,
      cursor: query['cursor'],
    });
    return { intents, count: intents.length };
  });

  // ======================================================================
  // POST /escrow/force-refund — Operator Force Refund
  // ======================================================================

  app.post('/escrow/force-refund', async (req, reply) => {
    const body = req.body as { executionId?: string };
    if (!body.executionId) {
      reply.status(400);
      return { error: 'VALIDATION_ERROR', message: 'executionId required' };
    }

    const current = await escrowIntentRepo.findById(body.executionId);
    if (!current) {
      reply.status(404);
      return { error: 'NOT_FOUND' };
    }

    const status = current.status as EscrowExecutionStatus;
    if (!isRefundableStatus(status)) {
      reply.status(400);
      return { error: 'NOT_REFUNDABLE', message: `Cannot force refund: status is ${status}` };
    }

    const refundAmount = current.refund_amount ?? current.amount_in;

    const updated = await transitionEscrow(
      body.executionId, 'refunded', 'operator-force-refund',
      { settled_at: new Date() },
      'Operator force refund',
    );

    escrowIntentsRefunded.inc({ pair_id: current.pair_id, refund_reason: 'force_refund' });
    escrowRefundVolume.inc({ asset: current.input_asset }, parseFloat(refundAmount));

    logger.info('Force refund processed', { executionId: body.executionId, refundAmount });

    return { executionId: body.executionId, status: updated?.status, refundAmount };
  });

  // ======================================================================
  // Start Server + Background Services
  // ======================================================================

  // Start timeout monitor (check every 10 seconds)
  startTimeoutMonitor(10_000, logger);

  // Start auto-refund processor (every 30 seconds)
  const autoRefundInterval = setInterval(async () => {
    try {
      const count = await processAutoRefunds(logger, async (executionId: string) => {
        const current = await escrowIntentRepo.findById(executionId);
        if (!current) return;
        if (!isRefundableStatus(current.status as EscrowExecutionStatus)) return;

        await transitionEscrow(
          executionId, 'refunded', 'auto-refund-processor',
          { settled_at: new Date() },
          'Auto-refund processor',
        );

        const refundAmount = current.refund_amount ?? current.amount_in;
        escrowIntentsRefunded.inc({ pair_id: current.pair_id, refund_reason: 'auto_refund' });
        escrowRefundVolume.inc({ asset: current.input_asset }, parseFloat(refundAmount));
      });

      if (count > 0) {
        logger.info('Auto-refunds processed', { durationMs: count });
      }
    } catch (err) {
      logger.error('Auto-refund processor error', { err: err instanceof Error ? err : undefined });
    }
  }, 30_000);

  // Update active intents gauge periodically
  const metricsInterval = setInterval(async () => {
    try {
      const activeCount = await escrowIntentRepo.getActiveCount();
      escrowActiveIntents.set(activeCount);
    } catch (err) {
      logger.error('Metrics update error', { err: err instanceof Error ? err : undefined });
    }
  }, 15_000);

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(`[escrow-service] Listening on port ${config.PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[escrow-service] Shutting down...');
    stopTimeoutMonitor();
    clearInterval(autoRefundInterval);
    clearInterval(metricsInterval);
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[escrow-service] Fatal error:', err);
  process.exit(1);
});
