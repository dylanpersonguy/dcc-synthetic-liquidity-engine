import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';
import { QuoteMode, QuoteLeg } from './quote.js';

// ============================================================================
// Route Domain
// ============================================================================

/**
 * SettlementMode — how the final delivery happens.
 */
export const SettlementMode = z.enum([
  'LOCAL_SWAP',            // settled entirely on DCC
  'SYNTHETIC_MINT',        // settled by minting synthetic on DCC
  'RELAYER_CROSS_CHAIN',   // settled by relayer delivering on external chain
  'RELAYER_TO_DCC',        // relayer brings external asset to DCC
]);
export type SettlementMode = z.infer<typeof SettlementMode>;

/**
 * RouteLeg — one step in a route plan. Extends QuoteLeg with execution details.
 */
export const RouteLeg = z.object({
  legIndex: z.number().int().min(0),
  venueId: z.string(),
  chain: z.string(),
  settlementMode: SettlementMode,
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: DecimalString,
  expectedAmountOut: DecimalString,
  minAmountOut: DecimalString,
  feeEstimate: DecimalString,
  requiresRelayer: z.boolean(),
});
export type RouteLeg = z.infer<typeof RouteLeg>;

/**
 * RouteScore — deterministic score object for a route.
 *
 * Given the same VenueSnapshot + RiskConfig snapshot, the same RouteScore
 * MUST be produced. This is a hard invariant for reproducibility.
 */
export const RouteScore = z.object({
  outputScore: z.number(),        // normalized output amount (higher = better)
  feeScore: z.number(),           // normalized fee cost (higher = cheaper)
  slippageScore: z.number(),      // normalized slippage (higher = less)
  freshnessScore: z.number(),     // quote freshness (higher = fresher)
  settlementScore: z.number(),    // settlement certainty (higher = safer)
  compositeScore: z.number(),     // weighted aggregate
});
export type RouteScore = z.infer<typeof RouteScore>;

/**
 * RoutePlan — the chosen execution plan for a trade.
 *
 * INVARIANTS:
 *  - `routeId` is globally unique.
 *  - `legs` are ordered; leg[0] executes first.
 *  - Sum of legs must produce `expectedOutputAmount` from `inputAmount`.
 *  - If any leg `requiresRelayer`, an escrow deposit is needed before execution.
 *  - The plan is only valid while `expiresAt > now`.
 */
export const RoutePlan = z.object({
  routeId: z.string(),
  quoteId: z.string(),
  pairId: z.string(),
  mode: QuoteMode,
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmount: DecimalString,
  expectedOutputAmount: DecimalString,
  minOutputAmount: DecimalString,
  legs: z.array(RouteLeg),
  score: RouteScore,
  requiresEscrow: z.boolean(),
  estimatedSettlementMs: z.number().int(),
  createdAt: TimestampMs,
  expiresAt: TimestampMs,
});
export type RoutePlan = z.infer<typeof RoutePlan>;
