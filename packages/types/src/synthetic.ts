import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Synthetic Asset Domain
// ============================================================================

/**
 * SyntheticBackingModel — how the synthetic is backed.
 *
 * INVENTORY_BACKED — protocol holds real underlying inventory (or equivalent
 *   value in hub asset). First production design for v1.
 * OVERCOLLATERALIZED — users lock collateral > 100% to mint. (v2+)
 * ALGORITHMIC — algorithmic peg via mint/burn fees. (research only)
 *
 * V1 RECOMMENDATION: Use INVENTORY_BACKED. The protocol relayer holds hub
 * asset (DUSD) reserves that conceptually back synthetic exposure. This is
 * the simplest, most honest model: the protocol's real balance sheet is
 * visible, and caps are limited to actual reserves.
 */
export const SyntheticBackingModel = z.enum([
  'INVENTORY_BACKED',
  'OVERCOLLATERALIZED',
  'ALGORITHMIC',
]);
export type SyntheticBackingModel = z.infer<typeof SyntheticBackingModel>;

/**
 * SyntheticAssetStatus — lifecycle state.
 */
export const SyntheticAssetStatus = z.enum([
  'ACTIVE',
  'PAUSED',
  'WIND_DOWN', // no new mints; only burns/redemptions
  'DISABLED',
]);
export type SyntheticAssetStatus = z.infer<typeof SyntheticAssetStatus>;

/**
 * SyntheticAsset — metadata + configuration for a synthetic asset.
 *
 * INVARIANTS:
 *  - `totalSupply <= supplyCap` at all times.
 *  - If `isRedeemable`, the RedemptionRouter must be enabled for this asset.
 *  - `oracleSources` must have >= 1 active source for pricing to be valid.
 *  - `backingModel` determines how `backingRatio` is interpreted.
 *  - Price can NEVER be served if all oracle sources are stale.
 */
export const SyntheticAsset = z.object({
  syntheticAssetId: z.string(),
  symbol: z.string(),           // e.g. 'sSOL'
  name: z.string(),             // e.g. 'Synthetic SOL'
  underlyingAssetId: z.string(), // the real asset this tracks
  underlyingSymbol: z.string(),
  dccTokenId: z.string(),       // on-chain token ID of the synthetic on DCC
  decimals: z.number().int().min(0).max(18),

  // Backing / collateral
  backingModel: SyntheticBackingModel,
  backingAssetId: z.string(),    // what backs it (e.g. DUSD)
  targetBackingRatio: DecimalString, // e.g. '1.0' for 100%

  // Supply
  totalSupply: DecimalString,
  supplyCap: DecimalString,

  // Redeemability
  isRedeemable: z.boolean(),
  redemptionDelay: z.number().int().optional(), // ms, 0 = instant if inventory available

  // Oracle
  oracleSources: z.array(
    z.object({
      sourceId: z.string(),
      venueId: z.string(),
      weight: z.number().min(0).max(1),
      maxStalenessMs: z.number().int(),
    }),
  ),

  // Risk
  riskTier: z.string(),
  settlementMode: z.string(),
  status: SyntheticAssetStatus,

  createdAt: TimestampMs,
  updatedAt: TimestampMs,
});
export type SyntheticAsset = z.infer<typeof SyntheticAsset>;

/**
 * SyntheticVaultState — global accounting snapshot for the synthetic vault.
 *
 * INVARIANTS:
 *  - `totalBackingValue >= totalLiabilityValue * targetBackingRatio`
 *    (enforced as a soft constraint; if breached, circuit breakers trip).
 *  - `netExposure = totalLongExposure - totalShortExposure` (signed).
 */
export const SyntheticVaultState = z.object({
  totalBackingValue: DecimalString,      // hub-asset denominated
  totalLiabilityValue: DecimalString,    // all outstanding synth at mark
  netExposure: DecimalString,            // signed net position
  perAssetExposure: z.record(z.string(), z.object({
    supply: DecimalString,
    markPrice: DecimalString,
    liabilityValue: DecimalString,
    backingAllocated: DecimalString,
  })),
  backingRatio: DecimalString,           // actual ratio
  lastUpdated: TimestampMs,
});
export type SyntheticVaultState = z.infer<typeof SyntheticVaultState>;
