// ============================================================================
// RedemptionRouter — On-Chain Contract Interface
// ============================================================================
//
// Accepts redemption requests for redeemable synthetic assets.
// Burns the synthetic token and creates a redemption record for the off-chain
// redemption-service to fulfill.
//
// PHASE: 3+ (Synthetic Assets with redeemability)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// redemption:{redemptionId}:user          -> address
// redemption:{redemptionId}:synthId       -> SyntheticAssetId
// redemption:{redemptionId}:synthAmount   -> u128
// redemption:{redemptionId}:underlying    -> AssetId
// redemption:{redemptionId}:destAddr      -> string (external chain address)
// redemption:{redemptionId}:destChain     -> ChainId
// redemption:{redemptionId}:status        -> RedemptionStatus
// redemption:{redemptionId}:createdAt     -> u64
//
// redemptions:count                       -> u32
// redemptions:queue:{index}               -> RedemptionId
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// PUBLIC:
//   - requestRedemption (burns user's synth tokens)
//   - getRedemption (reads)
//
// REDEMPTION_SERVICE_ROLE:
//   - markProcessing, markCompleted, markFailed
//
// ============================================================================
// EVENTS
// ============================================================================
//
// RedemptionRequested(redemptionId, user, synthId, amount, destChain)
// RedemptionProcessing(redemptionId)
// RedemptionCompleted(redemptionId, deliveredAmount, txHash)
// RedemptionFailed(redemptionId, reason)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. Synthetic tokens are burned atomically with redemption creation.
//    If burn fails, redemption is not created.
// 2. If redemption FAILS after burn, the protocol MUST re-mint the burned
//    tokens back to the user (or credit an equivalent claim).
// 3. Redemption requests are processed FIFO within each synthetic asset.
// 4. Only assets with `isRedeemable == true` can be redeemed.
//
// ============================================================================

import type { RedemptionRequest, RedemptionStatus } from '@dcc/types';

export interface IRedemptionRouter {
  // ── Public Methods ─────────────────────────────────────────────────────

  /**
   * Request redemption: burns synthetic tokens and creates redemption entry.
   * @access PUBLIC (token holder)
   */
  requestRedemption(params: {
    syntheticAssetId: string;
    amount: string;
    destinationAddress: string;
    destinationChain: string;
  }): Promise<{ redemptionId: string; txId: string }>;

  // ── Service Methods ────────────────────────────────────────────────────

  /** @access REDEMPTION_SERVICE_ROLE */
  markProcessing(redemptionId: string): Promise<{ txId: string }>;

  /** @access REDEMPTION_SERVICE_ROLE */
  markCompleted(redemptionId: string, deliveredAmount: string, deliveryTxHash: string): Promise<{ txId: string }>;

  /**
   * Mark a redemption as failed. This triggers a re-mint of the burned
   * synthetic tokens to the original user.
   * @access REDEMPTION_SERVICE_ROLE
   */
  markFailed(redemptionId: string, reason: string): Promise<{ txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  getRedemption(redemptionId: string): Promise<RedemptionRequest | null>;
  getRedemptionsByUser(userAddress: string): Promise<RedemptionRequest[]>;
  getRedemptionQueue(syntheticAssetId: string): Promise<RedemptionRequest[]>;
  getQueueLength(syntheticAssetId: string): Promise<number>;
}
