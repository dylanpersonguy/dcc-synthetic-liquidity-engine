import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';
import { MarketMode } from './market.js';

// ============================================================================
// Quote Domain
// ============================================================================

/**
 * QuoteMode — mirrors MarketMode but expressed in the context of a specific
 * quote request. A pair may support multiple modes; the quote engine selects
 * the best one.
 */
export const QuoteMode = z.enum([
  'LOCAL',       // local AMM/orderbook fill
  'SYNTHETIC',   // mint/fill via synthetic
  'TELEPORT',    // cross-chain via relayer
  'REDEEMABLE',  // fill synthetic with redeemable flag
]);
export type QuoteMode = z.infer<typeof QuoteMode>;

/**
 * QuoteLeg — one constituent leg of a quote.
 *
 * A simple local swap has one leg. A teleport route may have 2-3:
 *   leg 0: DCC/USDC (local AMM)
 *   leg 1: USDC/SOL (Jupiter)
 */
export const QuoteLeg = z.object({
  legIndex: z.number().int().min(0),
  venueId: z.string(),
  chain: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: DecimalString,
  amountOut: DecimalString,
  price: DecimalString,
  feeEstimate: DecimalString,
  slippageEstimate: DecimalString, // basis points
});
export type QuoteLeg = z.infer<typeof QuoteLeg>;

/**
 * Quote — a unified quote object returned by the quote engine.
 *
 * INVARIANTS:
 *  - `quoteId` is globally unique; used as nonce for execution.
 *  - `expiresAt` > now; expired quotes MUST be rejected.
 *  - `confidenceScore` in [0, 1]; 0 = stale/unreliable, 1 = highly fresh.
 *  - Sum of leg amountIn/Out must be consistent end-to-end.
 *  - If `mode` is TELEPORT, `legs.length` >= 2.
 */
export const Quote = z.object({
  quoteId: z.string(),
  pairId: z.string(),
  mode: QuoteMode,
  side: z.enum(['BUY', 'SELL']),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmount: DecimalString,
  outputAmount: DecimalString,
  effectivePrice: DecimalString,
  legs: z.array(QuoteLeg),

  // Fee breakdown
  totalFeeEstimate: DecimalString,
  protocolFee: DecimalString,
  venueFees: DecimalString,

  // Slippage & confidence
  estimatedSlippageBps: z.number().int(),
  confidenceScore: z.number().min(0).max(1),

  // Timing
  createdAt: TimestampMs,
  expiresAt: TimestampMs,
  estimatedSettlementMs: z.number().int().optional(),

  // Risk / transparency
  priceSources: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
});
export type Quote = z.infer<typeof Quote>;

/**
 * QuoteRequest — inbound request from a user/frontend.
 */
export const QuoteRequest = z.object({
  pairId: z.string(),
  side: z.enum(['BUY', 'SELL']),
  amount: DecimalString,
  /** If specified, quote engine limits results to this mode */
  preferredMode: QuoteMode.optional(),
  /** User's wallet address on DCC */
  userAddress: z.string().optional(),
  /** Max acceptable slippage in basis points */
  maxSlippageBps: z.number().int().min(0).max(5000).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;
