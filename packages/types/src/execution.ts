import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Execution Domain
// ============================================================================

/**
 * ExecutionStatus — lifecycle of a trade execution.
 *
 * State machine:
 *   PENDING -> ACCEPTED -> PARTIALLY_FILLED -> FILLED
 *   PENDING -> ACCEPTED -> FAILED -> REFUNDED
 *   PENDING -> EXPIRED -> REFUNDED
 *   PENDING -> REJECTED
 *
 * INVARIANTS:
 *  - Terminal states: FILLED, REFUNDED, REJECTED.
 *  - REFUNDED can only be reached from FAILED or EXPIRED.
 *  - PARTIALLY_FILLED can transition to FILLED or FAILED.
 */
export const ExecutionStatus = z.enum([
  'PENDING',
  'ACCEPTED',
  'PARTIALLY_FILLED',
  'FILLED',
  'FAILED',
  'REFUNDED',
  'EXPIRED',
  'REJECTED',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/**
 * ExecutionIntent — user's signed intent to execute a route.
 * Submitted to execution-service, which creates an on-chain escrow entry.
 */
export const ExecutionIntent = z.object({
  executionId: z.string(),
  routeId: z.string(),
  quoteId: z.string(),
  pairId: z.string(),
  userAddress: z.string(),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmount: DecimalString,
  minOutputAmount: DecimalString,
  /** Destination address for cross-chain delivery; DCC address for local */
  destinationAddress: z.string(),
  destinationChain: z.string(),
  /** User's signature over this intent (DCC-native sig) */
  signature: z.string(),
  /** Absolute expiry; after this, auto-refund */
  expiresAt: TimestampMs,
  createdAt: TimestampMs,
});
export type ExecutionIntent = z.infer<typeof ExecutionIntent>;

/**
 * ExecutionRecord — durable record of an execution's lifecycle.
 *
 * INVARIANTS:
 *  - `filledOutputAmount <= expectedOutputAmount` always.
 *  - If `status == FILLED`, `filledOutputAmount >= minOutputAmount`.
 *  - If `status == REFUNDED`, `refundAmount == inputAmount - consumed`.
 *  - `nonce` is unique per user; prevents replay.
 */
export const ExecutionRecord = z.object({
  executionId: z.string(),
  routeId: z.string(),
  quoteId: z.string(),
  pairId: z.string(),
  userAddress: z.string(),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmount: DecimalString,
  expectedOutputAmount: DecimalString,
  minOutputAmount: DecimalString,
  filledOutputAmount: DecimalString.nullable().default(null),
  status: ExecutionStatus,
  nonce: z.number().int(),
  destinationAddress: z.string(),
  destinationChain: z.string(),
  relayerId: z.string().nullable().default(null),
  escrowTxId: z.string().nullable().default(null),
  fillTxId: z.string().nullable().default(null),
  refundTxId: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
  expiresAt: TimestampMs,
  settledAt: TimestampMs.nullable().default(null),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecord>;
