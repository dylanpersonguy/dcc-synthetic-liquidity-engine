// ============================================================================
// Escrow State Machine — Deterministic state transition engine
// ============================================================================
//
// Enforces strict state transitions matching the on-chain Ride contract.
// Every transition is validated, logged, and emits events.
//
// INVARIANTS:
//   - No state can be skipped
//   - Terminal states cannot be exited
//   - All transitions logged to escrow_transitions table
//   - All transitions emit structured events
// ============================================================================

import type { EscrowExecutionStatus } from '@dcc/types';
import {
  ESCROW_VALID_TRANSITIONS,
  ESCROW_TERMINAL_STATES,
  ESCROW_REFUNDABLE_STATES,
} from '@dcc/contracts';
import {
  escrowIntentRepo,
  escrowTransitionRepo,
  escrowEventRepo,
} from '@dcc/database';
import type { EscrowIntentRow } from '@dcc/database';

// ============================================================================
// State Machine Functions
// ============================================================================

/**
 * Validate a state transition. Returns true if transition is allowed.
 */
export function isValidTransition(
  from: EscrowExecutionStatus,
  to: EscrowExecutionStatus,
): boolean {
  const allowed = ESCROW_VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Check if a status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: EscrowExecutionStatus): boolean {
  return ESCROW_TERMINAL_STATES.has(status);
}

/**
 * Check if a status is eligible for refund.
 */
export function isRefundableStatus(status: EscrowExecutionStatus): boolean {
  return ESCROW_REFUNDABLE_STATES.has(status);
}

/**
 * Map escrow status to the event type that should be emitted.
 */
function statusToEventType(status: EscrowExecutionStatus): string {
  const map: Record<EscrowExecutionStatus, string> = {
    created:                  'ExecutionCreated',
    funds_locked:             'ExecutionCreated',
    route_locked:             'ExecutionRouteLocked',
    local_leg_executed:       'ExecutionLocalLegExecuted',
    external_leg_pending:     'ExecutionExternalPending',
    external_leg_confirmed:   'ExecutionExternalConfirmed',
    delivery_pending:         'ExecutionDeliveryPending',
    completed:                'ExecutionCompleted',
    partially_completed:      'ExecutionPartialFill',
    failed:                   'ExecutionFailed',
    refunded:                 'ExecutionRefunded',
    expired:                  'ExecutionExpired',
  };
  return map[status];
}

/**
 * Execute a state transition with full validation, persistence, and event emission.
 *
 * @param executionId - The execution to transition
 * @param toStatus - Target status
 * @param triggeredBy - Who/what triggered this transition (user address, service name, etc.)
 * @param extras - Additional fields to update on the escrow record
 * @param reason - Optional reason for the transition
 * @returns Updated escrow record, or null if transition failed
 */
export async function transitionEscrow(
  executionId: string,
  toStatus: EscrowExecutionStatus,
  triggeredBy: string,
  extras?: Parameters<typeof escrowIntentRepo.updateStatus>[3],
  reason?: string,
): Promise<EscrowIntentRow | null> {
  // 1. Load current record
  const current = await escrowIntentRepo.findById(executionId);
  if (!current) {
    throw new Error(`Escrow not found: ${executionId}`);
  }

  const fromStatus = current.status as EscrowExecutionStatus;

  // 2. Validate not terminal
  if (isTerminalStatus(fromStatus)) {
    throw new Error(
      `Cannot transition from terminal state: ${fromStatus} (execution: ${executionId})`,
    );
  }

  // 3. Validate transition is allowed
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(
      `Invalid transition: ${fromStatus} → ${toStatus} (execution: ${executionId})`,
    );
  }

  // 4. Atomically update status (WHERE clause prevents race conditions)
  const updated = await escrowIntentRepo.updateStatus(
    executionId,
    fromStatus,
    toStatus,
    extras,
  );

  if (!updated) {
    // Race condition: status changed between read and write
    throw new Error(
      `Concurrent modification detected for ${executionId} (expected ${fromStatus})`,
    );
  }

  // 5. Record transition in audit log
  await escrowTransitionRepo.record(
    executionId,
    fromStatus,
    toStatus,
    triggeredBy,
    reason,
    extras ? { ...extras } : undefined,
  );

  // 6. Emit structured event
  const eventType = statusToEventType(toStatus);
  await escrowEventRepo.emit({
    event_type: eventType,
    execution_id: executionId,
    user_address: current.user_address,
    pair_id: current.pair_id,
    amount_in: current.amount_in,
    amount_out: extras?.actual_amount_out ?? current.actual_amount_out,
    refund_amount: extras?.refund_amount ?? current.refund_amount,
    relayer_id: current.relayer_id,
    proof_data: extras?.proof_data ?? current.proof_data,
    reason: reason ?? extras?.failure_reason ?? null,
  });

  return updated;
}

/**
 * Validate an escrow intent before creation.
 * Checks: nonce, expiry, amounts, execution mode.
 */
export async function validateEscrowIntent(params: {
  executionId: string;
  userAddress: string;
  amountIn: string;
  expectedAmountOut: string;
  minAmountOut: string;
  expiresAt: number;
  nonce: number;
}): Promise<{ valid: boolean; error?: string }> {
  // Check execution doesn't already exist
  const existing = await escrowIntentRepo.findById(params.executionId);
  if (existing) {
    return { valid: false, error: `Execution already exists: ${params.executionId}` };
  }

  // Validate nonce
  const currentNonce = await escrowIntentRepo.getUserNonce(params.userAddress);
  if (params.nonce !== currentNonce + 1) {
    return { valid: false, error: `Invalid nonce: expected ${currentNonce + 1}, got ${params.nonce}` };
  }

  // Validate amounts
  const amountIn = parseFloat(params.amountIn);
  const expectedOut = parseFloat(params.expectedAmountOut);
  const minOut = parseFloat(params.minAmountOut);

  if (amountIn <= 0) {
    return { valid: false, error: 'Amount in must be positive' };
  }
  if (expectedOut <= 0 || minOut <= 0) {
    return { valid: false, error: 'Expected/min amount out must be positive' };
  }
  if (minOut > expectedOut) {
    return { valid: false, error: 'minAmountOut cannot exceed expectedAmountOut' };
  }

  // Validate expiry
  if (params.expiresAt <= Date.now()) {
    return { valid: false, error: 'Expiry must be in the future' };
  }

  return { valid: true };
}
