import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Redemption Domain
// ============================================================================

/**
 * RedemptionStatus — lifecycle of a redemption request.
 *
 * State machine:
 *   QUEUED -> PROCESSING -> COMPLETED
 *   QUEUED -> PROCESSING -> PARTIALLY_COMPLETED
 *   QUEUED -> PROCESSING -> FAILED
 *   QUEUED -> CANCELLED (user-initiated, if allowed)
 */
export const RedemptionStatus = z.enum([
  'QUEUED',
  'PROCESSING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type RedemptionStatus = z.infer<typeof RedemptionStatus>;

/**
 * RedemptionRequest — user's request to burn a redeemable synthetic and
 * receive the underlying asset.
 *
 * INVARIANTS:
 *  - syntheticAmount must be burned (or locked) before status moves to PROCESSING.
 *  - If COMPLETED, `deliveredAmount > 0` and `deliveryTxId` is set.
 *  - If FAILED after burn, protocol must re-mint or credit user.
 */
export const RedemptionRequest = z.object({
  redemptionId: z.string(),
  userAddress: z.string(),
  syntheticAssetId: z.string(),
  syntheticSymbol: z.string(),
  syntheticAmount: DecimalString,
  underlyingAssetId: z.string(),
  underlyingSymbol: z.string(),
  expectedUnderlyingAmount: DecimalString,
  deliveredAmount: DecimalString.nullable().default(null),
  destinationAddress: z.string(),
  destinationChain: z.string(),
  status: RedemptionStatus,
  burnTxId: z.string().nullable().default(null),
  deliveryTxId: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
  completedAt: TimestampMs.nullable().default(null),
});
export type RedemptionRequest = z.infer<typeof RedemptionRequest>;
