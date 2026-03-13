import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Escrow Domain — Settlement Safety Layer Types
// ============================================================================

/**
 * EscrowExecutionStatus — 12-state lifecycle of an escrow execution.
 *
 * State machine:
 *   created → funds_locked → route_locked → local_leg_executed
 *   route_locked → external_leg_pending → external_leg_confirmed
 *   external_leg_confirmed → delivery_pending → completed
 *   external_leg_pending → partially_completed → refunded
 *   Any non-terminal → failed → refunded
 *   Any non-terminal → expired → refunded
 *
 * TERMINAL STATES: completed, refunded
 * REFUNDABLE STATES: failed, expired, partially_completed
 */
export const EscrowExecutionStatus = z.enum([
  'created',
  'funds_locked',
  'route_locked',
  'local_leg_executed',
  'external_leg_pending',
  'external_leg_confirmed',
  'delivery_pending',
  'completed',
  'partially_completed',
  'failed',
  'refunded',
  'expired',
]);
export type EscrowExecutionStatus = z.infer<typeof EscrowExecutionStatus>;

/**
 * ExecutionMode — how the escrow execution will be settled.
 */
export const ExecutionMode = z.enum([
  'LOCAL',        // DCC-only swap with no relayer
  'TELEPORT',     // DCC local + relayer external leg
  'SYNTHETIC',    // Mint synthetic on DCC
  'REDEEMABLE',   // Mint redeemable synthetic
]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

/**
 * EscrowIntent — user's intent to execute a routed swap through escrow.
 * This is submitted to the escrow service for on-chain deposit.
 */
export const EscrowIntent = z.object({
  executionId: z.string(),
  userAddress: z.string(),
  pairId: z.string(),
  inputAsset: z.string(),
  outputAsset: z.string(),
  amountIn: DecimalString,
  expectedAmountOut: DecimalString,
  minAmountOut: DecimalString,
  routePlanHash: z.string(),
  executionMode: ExecutionMode,
  relayerId: z.string().nullable(),
  expiresAt: TimestampMs,
  nonce: z.number().int(),
  signature: z.string(),
});
export type EscrowIntent = z.infer<typeof EscrowIntent>;

/**
 * EscrowRecord — durable record of an escrow execution lifecycle.
 *
 * INVARIANTS:
 *  - `actualAmountOut <= expectedAmountOut` always.
 *  - If status == completed, `actualAmountOut >= minAmountOut`.
 *  - If status == refunded, `refundAmount > 0`.
 *  - If status == partially_completed, both `actualAmountOut > 0` and `refundAmount > 0`.
 *  - Mutual exclusion: settled via completeExecution XOR refundExecution.
 */
export const EscrowRecord = z.object({
  executionId: z.string(),
  userAddress: z.string(),
  pairId: z.string(),
  inputAsset: z.string(),
  outputAsset: z.string(),
  amountIn: DecimalString,
  expectedAmountOut: DecimalString,
  minAmountOut: DecimalString,
  actualAmountOut: DecimalString.nullable().default(null),
  status: EscrowExecutionStatus,
  routePlanHash: z.string(),
  executionMode: ExecutionMode,
  relayerId: z.string().nullable().default(null),
  nonce: z.number().int(),
  escrowTxId: z.string().nullable().default(null),
  refundTxId: z.string().nullable().default(null),
  completionTxId: z.string().nullable().default(null),
  refundAmount: DecimalString.nullable().default(null),
  proofData: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
  expiresAt: TimestampMs,
  settledAt: TimestampMs.nullable().default(null),
});
export type EscrowRecord = z.infer<typeof EscrowRecord>;

/**
 * EscrowTransitionEvent — audit log entry for state transitions.
 */
export const EscrowTransitionEvent = z.object({
  executionId: z.string(),
  fromStatus: EscrowExecutionStatus.nullable(),
  toStatus: EscrowExecutionStatus,
  triggeredBy: z.string(),
  reason: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  timestamp: TimestampMs,
});
export type EscrowTransitionEvent = z.infer<typeof EscrowTransitionEvent>;

/**
 * EscrowEventType — all events emitted by the escrow system.
 */
export const EscrowEventType = z.enum([
  'ExecutionCreated',
  'ExecutionRouteLocked',
  'ExecutionLocalLegExecuted',
  'ExecutionExternalPending',
  'ExecutionExternalConfirmed',
  'ExecutionDeliveryPending',
  'ExecutionCompleted',
  'ExecutionPartialFill',
  'ExecutionFailed',
  'ExecutionRefunded',
  'ExecutionExpired',
]);
export type EscrowEventType = z.infer<typeof EscrowEventType>;

/**
 * EscrowEvent — structured event for logging and monitoring.
 */
export const EscrowEvent = z.object({
  eventType: EscrowEventType,
  executionId: z.string(),
  userAddress: z.string(),
  pairId: z.string(),
  amountIn: DecimalString,
  amountOut: DecimalString.nullable().default(null),
  refundAmount: DecimalString.nullable().default(null),
  relayerId: z.string().nullable().default(null),
  proofData: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  timestamp: TimestampMs,
});
export type EscrowEvent = z.infer<typeof EscrowEvent>;

/**
 * RelayerConfirmation — proof submitted by relayer for external execution.
 */
export const RelayerConfirmation = z.object({
  executionId: z.string(),
  relayerId: z.string(),
  actualAmountOut: DecimalString,
  txHash: z.string(),
  chain: z.string(),
  proofData: z.string(),
  signature: z.string(),
  timestamp: TimestampMs,
});
export type RelayerConfirmation = z.infer<typeof RelayerConfirmation>;

/**
 * PartialFillReport — report of a partial fill from venue execution.
 */
export const PartialFillReport = z.object({
  executionId: z.string(),
  partialAmountOut: DecimalString,
  totalExpectedOut: DecimalString,
  fillPercentage: z.number().min(0).max(100),
  refundableInputAmount: DecimalString,
  proofData: z.string(),
  timestamp: TimestampMs,
});
export type PartialFillReport = z.infer<typeof PartialFillReport>;
