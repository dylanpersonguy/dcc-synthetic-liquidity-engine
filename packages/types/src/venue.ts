import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Venue / External Connector Domain
// ============================================================================

/**
 * VenueType — classification of liquidity source.
 */
export const VenueType = z.enum([
  'DCC_AMM',
  'DCC_ORDERBOOK',
  'JUPITER',
  'RAYDIUM',
  'UNISWAP',
]);
export type VenueType = z.infer<typeof VenueType>;

/**
 * VenueQuote — a normalized quote from a single venue.
 *
 * All venue adapters MUST produce this shape. Business logic never touches
 * venue-native types directly.
 */
export const VenueQuote = z.object({
  venueId: z.string(),
  venueType: VenueType,
  chain: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: DecimalString,
  amountOut: DecimalString,
  price: DecimalString,
  feeEstimate: DecimalString,
  slippageEstimateBps: z.number().int(),
  route: z.array(z.string()).optional(), // venue-specific route hops
  fetchedAt: TimestampMs,
  expiresAt: TimestampMs,
  confidence: z.number().min(0).max(1),
  raw: z.unknown().optional(), // original venue response (for debugging)
});
export type VenueQuote = z.infer<typeof VenueQuote>;

/**
 * VenueSnapshot — point-in-time summary of a venue's state for a pair.
 */
export const VenueSnapshot = z.object({
  venueId: z.string(),
  venueType: VenueType,
  pairId: z.string(),
  midPrice: DecimalString.nullable(),
  bestBid: DecimalString.nullable(),
  bestAsk: DecimalString.nullable(),
  bidDepth: DecimalString.nullable(), // total notional on bid side
  askDepth: DecimalString.nullable(),
  spread: DecimalString.nullable(),
  lastTradePrice: DecimalString.nullable(),
  volume24h: DecimalString.nullable(),
  freshness: z.number().min(0).max(1),
  isStale: z.boolean(),
  fetchedAt: TimestampMs,
});
export type VenueSnapshot = z.infer<typeof VenueSnapshot>;

/**
 * VenueAdapter — the interface that every external connector must implement.
 * This is NOT a Zod schema — it's a TypeScript interface contract.
 */
export interface IVenueAdapter {
  readonly venueId: string;
  readonly venueType: VenueType;

  getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueQuote | null>;

  getRouteCandidates(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    maxRoutes?: number;
  }): Promise<VenueQuote[]>;

  getDepthEstimate(params: {
    tokenIn: string;
    tokenOut: string;
    notional: string;
  }): Promise<{ availableSize: string; estimatedSlippageBps: number } | null>;

  getMidPrice(params: {
    tokenIn: string;
    tokenOut: string;
  }): Promise<string | null>;

  getFreshness(): Promise<{ lastUpdateMs: number; isStale: boolean }>;

  normalizeSymbol(venueSymbol: string): string;

  buildExecutionPayload(quote: VenueQuote): Promise<unknown>;
}

// ============================================================================
// Venue Executor — execution-specific interface for relayer engine
// ============================================================================

/**
 * VenueExecutionRequest — parameters for submitting a trade to a venue.
 */
export const VenueExecutionRequest = z.object({
  venueId: z.string(),
  chain: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: DecimalString,
  minAmountOut: DecimalString,
  maxSlippageBps: z.number().int(),
  deadline: TimestampMs,
  recipientAddress: z.string(),
  walletAddress: z.string(),
  quote: VenueQuote,
});
export type VenueExecutionRequest = z.infer<typeof VenueExecutionRequest>;

/**
 * VenueExecutionResult — structured result from venue execution.
 */
export const VenueExecutionResult = z.object({
  success: z.boolean(),
  txHash: z.string().nullable(),
  amountIn: DecimalString,
  amountOut: DecimalString.nullable(),
  executedPrice: DecimalString.nullable(),
  feesPaid: DecimalString.nullable(),
  slippageBps: z.number().int().nullable(),
  gasUsed: DecimalString.nullable(),
  confirmedAt: TimestampMs.nullable(),
  blockNumber: z.number().int().nullable(),
  error: z.string().nullable(),
  raw: z.unknown().optional(),
});
export type VenueExecutionResult = z.infer<typeof VenueExecutionResult>;

/**
 * IVenueExecutor — execution interface that every venue executor must implement.
 *
 * Separate from IVenueAdapter to keep read-only operations (quoting) separate
 * from write operations (execution). A venue executor MAY also implement
 * IVenueAdapter, but that's not required.
 */
export interface IVenueExecutor {
  readonly venueId: string;
  readonly venueType: VenueType;

  /** Validate whether this venue can execute the given route */
  validateRoute(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ valid: boolean; reason?: string }>;

  /** Get a fresh quote from the venue */
  refreshQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueQuote | null>;

  /** Submit an execution to the venue (sign + send transaction) */
  submitExecution(request: VenueExecutionRequest): Promise<VenueExecutionResult>;

  /** Check the status of a submitted transaction */
  getExecutionStatus(txHash: string): Promise<{
    confirmed: boolean;
    success: boolean;
    blockNumber: number | null;
  }>;

  /** Estimate fees for an execution */
  estimateFee(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ fee: string; gasEstimate: string }>;
}
