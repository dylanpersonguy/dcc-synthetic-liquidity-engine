import type { IVenueAdapter, VenueQuote, VenueType } from '@dcc/types';

// ============================================================================
// BaseVenueAdapter — Abstract base for all venue connectors
// ============================================================================
//
// Every external liquidity connector extends this base. It provides:
//   - Config injection
//   - Staleness tracking
//   - Normalized error handling
//   - Common freshness computation
//
// Business logic MUST NOT live in adapters. They are pure data translators.
// ============================================================================

export interface VenueAdapterConfig {
  /** Unique venue identifier */
  venueId: string;
  /** Venue classification */
  venueType: VenueType;
  /** Base URL for the venue API */
  baseUrl: string;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max age (ms) before this adapter's data is considered stale */
  maxStalenessMs: number;
  /** Optional API key */
  apiKey?: string;
  /** Optional custom headers */
  headers?: Record<string, string>;
}

export abstract class BaseVenueAdapter implements IVenueAdapter {
  readonly venueId: string;
  readonly venueType: VenueType;
  protected config: VenueAdapterConfig;
  protected lastUpdateTimestamp = 0;

  constructor(config: VenueAdapterConfig) {
    this.venueId = config.venueId;
    this.venueType = config.venueType;
    this.config = config;
  }

  abstract getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueQuote | null>;

  abstract getRouteCandidates(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    maxRoutes?: number;
  }): Promise<VenueQuote[]>;

  abstract getDepthEstimate(params: {
    tokenIn: string;
    tokenOut: string;
    notional: string;
  }): Promise<{ availableSize: string; estimatedSlippageBps: number } | null>;

  abstract getMidPrice(params: {
    tokenIn: string;
    tokenOut: string;
  }): Promise<string | null>;

  abstract normalizeSymbol(venueSymbol: string): string;

  abstract buildExecutionPayload(quote: VenueQuote): Promise<unknown>;

  async getFreshness(): Promise<{ lastUpdateMs: number; isStale: boolean }> {
    const now = Date.now();
    const elapsed = now - this.lastUpdateTimestamp;
    return {
      lastUpdateMs: this.lastUpdateTimestamp,
      isStale: elapsed > this.config.maxStalenessMs,
    };
  }

  protected markFresh(): void {
    this.lastUpdateTimestamp = Date.now();
  }

  /** Build a normalized VenueQuote shell. Subclasses fill in the specifics. */
  protected buildBaseQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    price: string;
    feeEstimate: string;
    slippageEstimateBps: number;
    confidence: number;
    route?: string[];
    raw?: unknown;
  }): VenueQuote {
    const now = Date.now();
    return {
      venueId: this.venueId,
      venueType: this.venueType,
      chain: this.getChain(),
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: params.amountOut,
      price: params.price,
      feeEstimate: params.feeEstimate,
      slippageEstimateBps: params.slippageEstimateBps,
      route: params.route,
      fetchedAt: now,
      expiresAt: now + this.config.maxStalenessMs,
      confidence: params.confidence,
      raw: params.raw,
    };
  }

  protected abstract getChain(): string;
}
