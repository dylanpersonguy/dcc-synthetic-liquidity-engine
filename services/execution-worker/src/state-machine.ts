// ============================================================================
// Execution Worker — State Machine
// ============================================================================
//
// This module implements the 17-state execution state machine for relayer jobs.
// Every transition is validated against the allowed transition map, recorded
// with a timestamp in the audit log, and emits structured log events.
//
// INVARIANTS:
//   - Only transitions in VALID_TRANSITIONS are allowed.
//   - Every transition is persisted in relayer_job_transitions.
//   - Status updates are conditional on current status (optimistic locking).
//   - Terminal states (reconciled, rejected) are irreversible.
// ============================================================================

import type { RelayerJobStatus, RelayerJobPayload, RelayerJobResult } from '@dcc/queue';
import { VALID_TRANSITIONS, TERMINAL_STATES, FAILURE_STATES } from '@dcc/queue';
import { relayerJobRepo } from '@dcc/database';
import type { Logger } from '@dcc/metrics';

export interface TransitionResult {
  success: boolean;
  previousStatus: RelayerJobStatus;
  newStatus: RelayerJobStatus;
  reason?: string;
}

/**
 * Validate and execute a state transition for a relayer job.
 *
 * @throws Never — returns { success: false } on invalid transitions.
 */
export async function transitionJob(
  jobId: string,
  currentStatus: RelayerJobStatus,
  targetStatus: RelayerJobStatus,
  log: Logger,
  reason?: string,
  extras?: { lastError?: string; result?: unknown; reservationId?: string; completedAt?: Date },
): Promise<TransitionResult> {
  // Validate transition is allowed
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(targetStatus)) {
    log.warn('Invalid state transition attempted', {
      jobId,
      currentStatus,
      targetStatus,
      allowedTransitions: allowed,
    });
    return { success: false, previousStatus: currentStatus, newStatus: currentStatus, reason: `Invalid transition: ${currentStatus} → ${targetStatus}` };
  }

  // Persist transition atomically (conditional on current status)
  const updated = await relayerJobRepo.updateStatus(jobId, currentStatus, targetStatus, extras);
  if (!updated) {
    log.warn('State transition failed — status changed concurrently', {
      jobId,
      currentStatus,
      targetStatus,
    });
    return { success: false, previousStatus: currentStatus, newStatus: currentStatus, reason: 'Concurrent modification' };
  }

  // Record audit log
  await relayerJobRepo.recordTransition(jobId, currentStatus, targetStatus, reason);

  log.info('Job state transition', {
    jobId,
    event: 'state_transition',
    from: currentStatus,
    to: targetStatus,
    reason,
  });

  return { success: true, previousStatus: currentStatus, newStatus: targetStatus, reason };
}

/**
 * Risk gate checks performed before execution.
 * Returns null if all checks pass, or a rejection reason string.
 */
export function validateJobForExecution(payload: RelayerJobPayload): string | null {
  const now = Date.now();

  // 1. Intent freshness — reject expired intents
  if (payload.expiresAt <= now) {
    return `Intent expired at ${payload.expiresAt}, current time ${now}`;
  }

  // 2. Intent not too far in the future (replay protection)
  const maxFutureMs = 600_000; // 10 minutes
  if (payload.expiresAt > now + maxFutureMs + 300_000) {
    return `Intent expiry too far in future: ${payload.expiresAt}`;
  }

  // 3. Must have at least one leg
  if (payload.legs.length === 0) {
    return 'Route plan has no legs';
  }

  // 4. Amount must be positive
  if (parseFloat(payload.amountIn) <= 0) {
    return `Invalid amountIn: ${payload.amountIn}`;
  }

  // 5. Max slippage bounds (reject absurd values)
  if (payload.maxSlippageBps > 1000) {
    return `Max slippage too high: ${payload.maxSlippageBps} bps (limit: 1000)`;
  }

  // 6. Must have a destination
  if (!payload.destinationAddress || !payload.destinationChain) {
    return 'Missing destination address or chain';
  }

  // 7. Nonce must be non-negative
  if (payload.nonce < 0) {
    return `Invalid nonce: ${payload.nonce}`;
  }

  return null;
}

/**
 * The main execution pipeline. Called by the BullMQ worker for each job.
 *
 * This function orchestrates the full lifecycle:
 *   received → validated → inventory_reserved → quote_refreshed →
 *   ready_to_execute → submitting → submitted → awaiting_confirmation →
 *   filled → delivery_pending → completed → inventory_released
 */
export async function executeJob(
  payload: RelayerJobPayload,
  log: Logger,
  deps: {
    reserveInventory: (jobId: string, asset: string, chain: string, amount: string) => Promise<{ reservationId: string } | null>;
    releaseInventory: (reservationId: string, reason: string) => Promise<void>;
    consumeInventory: (reservationId: string) => Promise<void>;
    refreshQuote: (venueId: string, tokenIn: string, tokenOut: string, amountIn: string) => Promise<{ amountOut: string; price: string; slippageBps: number } | null>;
    submitVenueExecution: (leg: RelayerJobPayload['legs'][number], quote: { amountOut: string; price: string }, walletAddress: string, deadline: number, recipientAddress: string) => Promise<{ success: boolean; txHash: string | null; amountOut: string | null; executedPrice: string | null; slippageBps: number | null; feesPaid: string | null; error: string | null }>;
    waitForConfirmation: (txHash: string, chain: string, timeoutMs: number) => Promise<{ confirmed: boolean; blockNumber: number | null }>;
    recordHedge: (jobId: string, executionId: string, asset: string, chain: string, exposureAmount: string, hedgedAmount: string) => Promise<void>;
    reportToUpstream: (executionId: string, result: RelayerJobResult) => Promise<void>;
    isEmergencyPaused: () => Promise<boolean>;
    checkRiskLimits: (pairId: string, amount: string, venueId: string) => Promise<{ allowed: boolean; reason?: string }>;
    getWalletAddress: (chain: string) => string;
  },
): Promise<RelayerJobResult> {
  const { jobId, executionId } = payload;
  let currentStatus: RelayerJobStatus = 'received';
  let reservationId: string | null = null;
  const startTime = Date.now();

  const fail = async (reason: string): Promise<RelayerJobResult> => {
    log.error('Job execution failed', { jobId, executionId, reason, currentStatus });

    if (!FAILURE_STATES.has(currentStatus) && !TERMINAL_STATES.has(currentStatus)) {
      await transitionJob(jobId, currentStatus, 'failed', log, reason, { lastError: reason });
      currentStatus = 'failed';
    }

    // Release inventory if reserved
    if (reservationId && currentStatus === 'failed') {
      await deps.releaseInventory(reservationId, reason);
      await transitionJob(jobId, 'failed', 'inventory_released', log, 'Released after failure');
      currentStatus = 'inventory_released';
    }

    const result: RelayerJobResult = {
      success: false,
      jobId,
      executionId,
      amountIn: payload.amountIn,
      amountOut: null,
      txHash: null,
      executedPrice: null,
      slippageBps: null,
      feesPaid: null,
      filledLegs: 0,
      totalLegs: payload.legs.length,
      failureReason: reason,
      completedAt: Date.now(),
    };

    await deps.reportToUpstream(executionId, result);
    return result;
  };

  try {
    // ── Step 1: Validate ──────────────────────────────────────────────
    const validationError = validateJobForExecution(payload);
    if (validationError) {
      await transitionJob(jobId, 'received', 'rejected', log, validationError, { lastError: validationError });
      return { success: false, jobId, executionId, amountIn: payload.amountIn, amountOut: null, txHash: null, executedPrice: null, slippageBps: null, feesPaid: null, filledLegs: 0, totalLegs: payload.legs.length, failureReason: validationError, completedAt: Date.now() };
    }

    // Check emergency pause
    if (await deps.isEmergencyPaused()) {
      await transitionJob(jobId, 'received', 'rejected', log, 'Protocol emergency pause active');
      return { success: false, jobId, executionId, amountIn: payload.amountIn, amountOut: null, txHash: null, executedPrice: null, slippageBps: null, feesPaid: null, filledLegs: 0, totalLegs: payload.legs.length, failureReason: 'Emergency pause', completedAt: Date.now() };
    }

    const tr1 = await transitionJob(jobId, 'received', 'validated', log, 'Passed validation');
    if (!tr1.success) return fail('Failed to transition to validated');
    currentStatus = 'validated';

    // ── Step 2: Risk limits check ─────────────────────────────────────
    const externalLeg = payload.legs.find(l => l.requiresRelayer);
    if (!externalLeg) {
      return fail('No external leg found in route plan');
    }

    const riskCheck = await deps.checkRiskLimits(payload.pairId, payload.amountIn, externalLeg.venueId);
    if (!riskCheck.allowed) {
      await transitionJob(jobId, 'validated', 'rejected', log, `Risk limit exceeded: ${riskCheck.reason}`);
      return { success: false, jobId, executionId, amountIn: payload.amountIn, amountOut: null, txHash: null, executedPrice: null, slippageBps: null, feesPaid: null, filledLegs: 0, totalLegs: payload.legs.length, failureReason: `Risk limit: ${riskCheck.reason}`, completedAt: Date.now() };
    }

    // ── Step 3: Reserve inventory ─────────────────────────────────────
    const reservation = await deps.reserveInventory(
      jobId,
      externalLeg.tokenIn,
      externalLeg.chain,
      externalLeg.amountIn,
    );

    if (!reservation) {
      await transitionJob(jobId, 'validated', 'rejected', log, 'Insufficient inventory');
      return { success: false, jobId, executionId, amountIn: payload.amountIn, amountOut: null, txHash: null, executedPrice: null, slippageBps: null, feesPaid: null, filledLegs: 0, totalLegs: payload.legs.length, failureReason: 'Insufficient inventory', completedAt: Date.now() };
    }

    reservationId = reservation.reservationId;
    const tr3 = await transitionJob(jobId, 'validated', 'inventory_reserved', log, 'Inventory reserved', { reservationId });
    if (!tr3.success) return fail('Failed to transition to inventory_reserved');
    currentStatus = 'inventory_reserved';

    // ── Step 4: Refresh quote ─────────────────────────────────────────
    const freshQuote = await deps.refreshQuote(
      externalLeg.venueId,
      externalLeg.tokenIn,
      externalLeg.tokenOut,
      externalLeg.amountIn,
    );

    if (!freshQuote) {
      return fail('Quote refresh failed — venue unavailable or no liquidity');
    }

    // Validate refreshed quote against slippage tolerance
    const originalAmountOut = parseFloat(externalLeg.expectedAmountOut);
    const refreshedAmountOut = parseFloat(freshQuote.amountOut);
    if (originalAmountOut > 0) {
      const slippageFromOriginal = Math.round(((originalAmountOut - refreshedAmountOut) / originalAmountOut) * 10000);
      if (slippageFromOriginal > payload.maxSlippageBps) {
        return fail(`Refreshed quote slippage ${slippageFromOriginal}bps exceeds max ${payload.maxSlippageBps}bps`);
      }
    }

    // Validate against minAmountOut
    const minOut = parseFloat(externalLeg.minAmountOut);
    if (refreshedAmountOut < minOut) {
      return fail(`Refreshed amountOut ${refreshedAmountOut} below minimum ${minOut}`);
    }

    const tr4 = await transitionJob(jobId, 'inventory_reserved', 'quote_refreshed', log, 'Quote refreshed and validated');
    if (!tr4.success) return fail('Failed to transition to quote_refreshed');
    currentStatus = 'quote_refreshed';

    // ── Step 5: Ready to execute ──────────────────────────────────────
    const tr5 = await transitionJob(jobId, 'quote_refreshed', 'ready_to_execute', log, 'Pre-flight checks passed');
    if (!tr5.success) return fail('Failed to transition to ready_to_execute');
    currentStatus = 'ready_to_execute';

    // ── Step 6: Submit to venue ───────────────────────────────────────
    const tr6 = await transitionJob(jobId, 'ready_to_execute', 'submitting', log, 'Submitting to venue');
    if (!tr6.success) return fail('Failed to transition to submitting');
    currentStatus = 'submitting';

    const walletAddress = deps.getWalletAddress(externalLeg.chain);
    const deadline = Math.min(payload.expiresAt, Date.now() + 120_000); // 2 min max

    const venueResult = await deps.submitVenueExecution(
      externalLeg,
      freshQuote,
      walletAddress,
      deadline,
      payload.destinationAddress,
    );

    if (!venueResult.success || !venueResult.txHash) {
      return fail(`Venue submission failed: ${venueResult.error ?? 'Unknown error'}`);
    }

    const tr6b = await transitionJob(jobId, 'submitting', 'submitted', log, `Submitted: ${venueResult.txHash}`);
    if (!tr6b.success) return fail('Failed to transition to submitted');
    currentStatus = 'submitted';

    // ── Step 7: Await confirmation ────────────────────────────────────
    const tr7 = await transitionJob(jobId, 'submitted', 'awaiting_confirmation', log, 'Waiting for on-chain confirmation');
    if (!tr7.success) return fail('Failed to transition to awaiting_confirmation');
    currentStatus = 'awaiting_confirmation';

    const confirmationTimeoutMs = 90_000; // 90 seconds
    const confirmation = await deps.waitForConfirmation(venueResult.txHash, externalLeg.chain, confirmationTimeoutMs);

    if (!confirmation.confirmed) {
      await transitionJob(jobId, 'awaiting_confirmation', 'timed_out', log, 'Confirmation timeout');
      currentStatus = 'timed_out';
      await deps.releaseInventory(reservationId, 'Confirmation timeout');
      await transitionJob(jobId, 'timed_out', 'inventory_released', log, 'Released after timeout');
      return { success: false, jobId, executionId, amountIn: payload.amountIn, amountOut: null, txHash: venueResult.txHash, executedPrice: null, slippageBps: null, feesPaid: null, filledLegs: 0, totalLegs: payload.legs.length, failureReason: 'Confirmation timeout', completedAt: Date.now() };
    }

    // ── Step 8: Filled ────────────────────────────────────────────────
    const tr8 = await transitionJob(jobId, 'awaiting_confirmation', 'filled', log, 'Fill confirmed on-chain');
    if (!tr8.success) return fail('Failed to transition to filled');
    currentStatus = 'filled';

    // ── Step 9: Delivery pending ──────────────────────────────────────
    const tr9 = await transitionJob(jobId, 'filled', 'delivery_pending', log, 'Processing delivery');
    if (!tr9.success) return fail('Failed to transition to delivery_pending');
    currentStatus = 'delivery_pending';

    // Record hedge — in v1, the external execution IS the hedge
    await deps.recordHedge(
      jobId,
      executionId,
      externalLeg.tokenOut,
      externalLeg.chain,
      externalLeg.amountIn,       // exposure = input amount
      venueResult.amountOut ?? '0', // hedged = output received
    );

    // ── Step 10: Complete ─────────────────────────────────────────────
    const tr10 = await transitionJob(jobId, 'delivery_pending', 'completed', log, 'Execution completed', { completedAt: new Date() });
    if (!tr10.success) return fail('Failed to transition to completed');
    currentStatus = 'completed';

    // Consume reserved inventory (marks it as used)
    await deps.consumeInventory(reservationId);

    // ── Step 11: Release inventory accounting ─────────────────────────
    const tr11 = await transitionJob(jobId, 'completed', 'inventory_released', log, 'Inventory accounting updated');
    if (!tr11.success) return fail('Failed to transition to inventory_released');
    currentStatus = 'inventory_released';

    const elapsed = Date.now() - startTime;
    const result: RelayerJobResult = {
      success: true,
      jobId,
      executionId,
      amountIn: payload.amountIn,
      amountOut: venueResult.amountOut,
      txHash: venueResult.txHash,
      executedPrice: venueResult.executedPrice,
      slippageBps: venueResult.slippageBps,
      feesPaid: venueResult.feesPaid,
      filledLegs: 1,
      totalLegs: payload.legs.length,
      failureReason: null,
      completedAt: Date.now(),
    };

    log.info('Job execution completed', { jobId, executionId, elapsed, txHash: venueResult.txHash });
    await deps.reportToUpstream(executionId, result);
    return result;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return fail(`Unexpected error: ${errorMsg}`);
  }
}
