// ============================================================================
// PairRegistry — On-Chain Contract Interface
// ============================================================================
//
// The canonical registry of all tradeable pairs on DCC.
// Every market resolution — quote, route, execution — begins by looking up
// pair metadata from this contract.
//
// PHASE: 0 (Foundation)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// pair:{pairId}:base           -> AssetId
// pair:{pairId}:quote          -> AssetId
// pair:{pairId}:mode           -> MarketMode (NATIVE | SYNTHETIC | TELEPORT | REDEEMABLE)
// pair:{pairId}:status         -> MarketStatus (ACTIVE | QUOTE_ONLY | PAUSED | DISABLED)
// pair:{pairId}:riskTier       -> RiskTier (TIER_1..TIER_4)
// pair:{pairId}:localPoolId    -> PoolId | null
// pair:{pairId}:localBookId    -> OrderbookId | null
// pair:{pairId}:synthAssetId   -> SyntheticAssetId | null
// pair:{pairId}:maxTradeSize   -> u128 (quote asset decimals)
// pair:{pairId}:maxDailyVolume -> u128
// pair:{pairId}:createdAt      -> u64 (timestamp ms)
// pair:{pairId}:updatedAt      -> u64
//
// pairs:count                  -> u32
// pairs:list:{index}           -> PairId
//
// externalSources:{pairId}:{venueId} -> { venuePairId, enabled }
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// ADMIN_ROLE:
//   - registerPair, updatePairConfig, setPairStatus, linkExternalSource
//   - Held by protocol governance multisig
//
// OPERATOR_ROLE:
//   - setPairStatus (pause only), emergency operations
//   - Held by protocol operations key (hot key with limited scope)
//
// PUBLIC:
//   - All read methods
//
// ============================================================================
// EVENTS
// ============================================================================
//
// PairRegistered(pairId, baseAsset, quoteAsset, mode, riskTier)
// PairConfigUpdated(pairId, field, oldValue, newValue)
// PairStatusChanged(pairId, oldStatus, newStatus, reason)
// ExternalSourceLinked(pairId, venueId, venuePairId)
// ExternalSourceToggled(pairId, venueId, enabled)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. PairId is deterministic: keccak256(baseAssetId, quoteAssetId).
//    No two pairs may exist for the same base/quote combination.
// 2. If mode == NATIVE, localPoolId or localBookId MUST be non-null.
// 3. If mode == SYNTHETIC, synthAssetId MUST be non-null.
// 4. If status == DISABLED, no downstream contract may reference this pair
//    for new operations.
// 5. maxTradeSize > 0 always (use protocol default if not overridden).
//
// ============================================================================
// PAUSE BEHAVIOR
// ============================================================================
//
// When a pair is PAUSED:
//   - Quote engine MUST NOT serve quotes for this pair.
//   - Execution engine MUST NOT accept new execution intents for this pair.
//   - Existing in-flight executions continue to their natural conclusion
//     (fill, fail, or timeout).
//   - Read methods remain accessible.
//
// ============================================================================

import type { MarketMode, MarketStatus, RiskTier, Pair } from '@dcc/types';

/**
 * IPairRegistry — callable interface for the PairRegistry contract.
 */
export interface IPairRegistry {
  // ── Admin Methods ──────────────────────────────────────────────────────

  /**
   * Register a new pair. Reverts if pair already exists.
   * @access ADMIN_ROLE
   */
  registerPair(params: {
    baseAssetId: string;
    quoteAssetId: string;
    mode: MarketMode;
    riskTier: RiskTier;
    localPoolId?: string;
    localBookId?: string;
    syntheticAssetId?: string;
    maxTradeSize: string;
    maxDailyVolume: string;
  }): Promise<{ pairId: string; txId: string }>;

  /**
   * Update pair configuration. Only modifiable fields.
   * @access ADMIN_ROLE
   */
  updatePairConfig(params: {
    pairId: string;
    mode?: MarketMode;
    riskTier?: RiskTier;
    localPoolId?: string | null;
    localBookId?: string | null;
    syntheticAssetId?: string | null;
    maxTradeSize?: string;
    maxDailyVolume?: string;
  }): Promise<{ txId: string }>;

  /**
   * Change pair status.
   * @access ADMIN_ROLE (any transition) or OPERATOR_ROLE (to PAUSED only)
   */
  setPairStatus(params: {
    pairId: string;
    status: MarketStatus;
    reason: string;
  }): Promise<{ txId: string }>;

  /**
   * Link an external venue as a liquidity source for this pair.
   * @access ADMIN_ROLE
   */
  linkExternalSource(params: {
    pairId: string;
    venueId: string;
    venuePairId: string;
  }): Promise<{ txId: string }>;

  /**
   * Enable or disable a linked external source.
   * @access ADMIN_ROLE
   */
  toggleExternalSource(params: {
    pairId: string;
    venueId: string;
    enabled: boolean;
  }): Promise<{ txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  /** Get pair by ID. Returns null if not found. */
  getPair(pairId: string): Promise<Pair | null>;

  /** Get pair by base/quote asset IDs. */
  getPairByAssets(baseAssetId: string, quoteAssetId: string): Promise<Pair | null>;

  /** List all registered pairs, optionally filtered. */
  listPairs(filters?: {
    mode?: MarketMode;
    status?: MarketStatus;
    riskTier?: RiskTier;
  }): Promise<Pair[]>;

  /** Get total number of registered pairs. */
  getPairCount(): Promise<number>;
}
