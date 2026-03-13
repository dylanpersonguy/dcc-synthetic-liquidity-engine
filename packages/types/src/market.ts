import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Market / Pair Domain
// ============================================================================

/**
 * MarketMode — how a given pair is served to users.
 *
 * NATIVE     — both assets exist natively on DCC; swaps settle locally.
 * SYNTHETIC  — one side is a DCC-issued synthetic (sSOL, sETH, …).
 * TELEPORT   — user requests delivery of a real asset on another chain;
 *              the protocol routes through a DCC hub + external venue.
 * REDEEMABLE — synthetic that can later be burned and redeemed for the
 *              underlying asset via the redemption flow.
 */
export const MarketMode = z.enum([
  'NATIVE',
  'SYNTHETIC',
  'TELEPORT',
  'REDEEMABLE',
]);
export type MarketMode = z.infer<typeof MarketMode>;

/**
 * MarketStatus — lifecycle state of a pair in the PairRegistry.
 */
export const MarketStatus = z.enum([
  'ACTIVE',      // open for quotes + execution
  'QUOTE_ONLY',  // can be quoted but not executed (Phase 1 state)
  'PAUSED',      // temporarily halted by risk / admin
  'DISABLED',    // permanently removed or not yet enabled
]);
export type MarketStatus = z.infer<typeof MarketStatus>;

/**
 * RiskTier — risk classification per pair. Drives cap/limit/circuit-breaker
 * profiles.
 *
 * TIER_1 — blue-chip, deep liquidity (e.g. DCC/USDC).
 * TIER_2 — major cross-chain (e.g. DCC/SOL, DCC/ETH).
 * TIER_3 — synthetic or lower-liquidity (e.g. sBONK).
 * TIER_4 — long-tail, exotic, or newly listed.
 */
export const RiskTier = z.enum(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4']);
export type RiskTier = z.infer<typeof RiskTier>;

/**
 * Asset — a single asset's metadata, as registered on DCC.
 *
 * For synthetic assets, `syntheticAssetId` links to the SyntheticAsset record.
 * `chain` is the *native* chain of the underlying (e.g. 'solana' for SOL).
 */
export const Asset = z.object({
  id: z.string(),
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  decimals: z.number().int().min(0).max(18),
  chain: z.string(), // ChainId of native chain
  contractAddress: z.string().optional(), // address on native chain (if applicable)
  dccTokenId: z.string().optional(), // DCC-local token identifier
  isSynthetic: z.boolean().default(false),
  syntheticAssetId: z.string().optional(),
});
export type Asset = z.infer<typeof Asset>;

/**
 * Pair — canonical market identity. This is the central entity that all
 * services resolve against.
 *
 * INVARIANTS:
 *  - `pairId` is deterministic: `${baseAssetId}/${quoteAssetId}`.
 *  - A pair has exactly one `primaryMode`. Additional modes may be
 *    supported if `supportedModes` includes them.
 *  - If mode is NATIVE, `localPoolId` or `localBookId` MUST be set.
 *  - If mode is SYNTHETIC, `syntheticAssetId` MUST be set.
 *  - If mode is TELEPORT, at least one external source MUST be linked.
 */
export const Pair = z.object({
  pairId: z.string(),
  baseAssetId: z.string(),
  quoteAssetId: z.string(),
  baseSymbol: z.string(),
  quoteSymbol: z.string(),
  primaryMode: MarketMode,
  supportedModes: z.array(MarketMode),
  status: MarketStatus,
  riskTier: RiskTier,

  // Local venue links (nullable)
  localPoolId: z.string().nullable().default(null),
  localBookId: z.string().nullable().default(null),

  // Synthetic link (nullable)
  syntheticAssetId: z.string().nullable().default(null),

  // External source identifiers (venue-level pair/route ids)
  externalSources: z.array(
    z.object({
      venueId: z.string(),
      venuePairId: z.string(),
      enabled: z.boolean(),
    }),
  ).default([]),

  // Caps (decimal strings denominated in quote asset)
  maxTradeSize: DecimalString.nullable().default(null),
  maxDailyVolume: DecimalString.nullable().default(null),

  createdAt: TimestampMs,
  updatedAt: TimestampMs,
});
export type Pair = z.infer<typeof Pair>;

/**
 * DepthLevel — a single price/size entry in a depth snapshot.
 */
export const DepthLevel = z.object({
  price: DecimalString,
  size: DecimalString,
});
export type DepthLevel = z.infer<typeof DepthLevel>;

/**
 * MarketDepth — aggregated depth for a pair from all venues.
 */
export const MarketDepth = z.object({
  pairId: z.string(),
  bids: z.array(DepthLevel),
  asks: z.array(DepthLevel),
  timestamp: TimestampMs,
  sources: z.array(z.string()),
});
export type MarketDepth = z.infer<typeof MarketDepth>;
