import type { VenueQuote } from '@dcc/types';
import { BaseVenueAdapter, type VenueAdapterConfig } from '../base-adapter.js';

// ============================================================================
// JupiterAdapter — Solana DEX aggregator connector
// ============================================================================
// Connects to Jupiter V6 API for Solana-side routing.
// In paper mode, returns deterministic simulated quotes for USDC/SOL, etc.
// In live mode, calls Jupiter V6 quote/swap APIs.
// ============================================================================

const DEFAULT_JUPITER_CONFIG: VenueAdapterConfig = {
  venueId: 'jupiter',
  venueType: 'JUPITER',
  baseUrl: 'https://quote-api.jup.ag/v6',
  timeoutMs: 5000,
  maxStalenessMs: 10000,
};

/** Jupiter-specific symbol mapping (mint address <-> canonical symbol) */
const JUPITER_TOKEN_MAP: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: 'WIF',
};

/** Reference prices for paper mode (in USD terms) */
const REFERENCE_PRICES: Record<string, number> = {
  'USDC/SOL': 1 / 135.50,   // SOL ~$135.50
  'SOL/USDC': 135.50,
  'USDC/BONK': 1 / 0.000025,
  'BONK/USDC': 0.000025,
  'USDC/WIF': 1 / 1.85,
  'WIF/USDC': 1.85,
  'USDC/ETH': 1 / 2650,
  'ETH/USDC': 2650,
};

/** Simulated depth in USD */
const SIMULATED_DEPTH_USD = 2_000_000;
const FEE_BPS = 8;

export class JupiterAdapter extends BaseVenueAdapter {
  private paperMode: boolean;

  constructor(config?: Partial<VenueAdapterConfig> & { paperMode?: boolean }) {
    super({ ...DEFAULT_JUPITER_CONFIG, ...config });
    this.paperMode = config?.paperMode ?? true;
  }

  protected getChain(): string {
    return 'solana';
  }

  normalizeSymbol(venueSymbol: string): string {
    return JUPITER_TOKEN_MAP[venueSymbol] ?? venueSymbol;
  }

  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueQuote | null> {
    if (this.paperMode) {
      return this.simulateQuote(params.tokenIn, params.tokenOut, params.amountIn);
    }
    return this.fetchLiveQuote(params.tokenIn, params.tokenOut, params.amountIn);
  }

  private async fetchLiveQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
  ): Promise<VenueQuote | null> {
    try {
      const url = new URL('/quote', this.config.baseUrl);
      url.searchParams.set('inputMint', tokenIn);
      url.searchParams.set('outputMint', tokenOut);
      url.searchParams.set('amount', amountIn);
      url.searchParams.set('slippageBps', '50');

      const res = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: this.config.headers,
      });
      if (!res.ok) return null;

      const data = await res.json() as {
        outAmount?: string;
        priceImpactPct?: string;
        routePlan?: unknown[];
      };
      if (!data.outAmount) return null;

      const amountInNum = parseFloat(amountIn);
      const amountOutNum = parseFloat(data.outAmount);
      const price = amountInNum > 0 ? amountOutNum / amountInNum : 0;
      const priceImpactBps = data.priceImpactPct
        ? Math.round(parseFloat(data.priceImpactPct) * 100)
        : 0;

      this.markFresh();
      return this.buildBaseQuote({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: data.outAmount,
        price: price.toFixed(8),
        feeEstimate: (amountInNum * (FEE_BPS / 10000)).toFixed(6),
        slippageEstimateBps: priceImpactBps,
        confidence: 0.95,
        route: ['jupiter-v6', `${tokenIn}->${tokenOut}`],
        raw: data,
      });
    } catch {
      return null;
    }
  }

  async getRouteCandidates(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    maxRoutes?: number;
  }): Promise<VenueQuote[]> {
    const quote = await this.getQuote(params);
    return quote ? [quote] : [];
  }

  async getDepthEstimate(params: {
    tokenIn: string;
    tokenOut: string;
    notional: string;
  }): Promise<{ availableSize: string; estimatedSlippageBps: number } | null> {
    const pairKey = `${params.tokenIn}/${params.tokenOut}`;
    if (!REFERENCE_PRICES[pairKey]) return null;

    const notionalNum = parseFloat(params.notional);
    const slippageBps = Math.round((notionalNum / SIMULATED_DEPTH_USD) * 50);
    return {
      availableSize: String(SIMULATED_DEPTH_USD),
      estimatedSlippageBps: Math.min(slippageBps, 300),
    };
  }

  async getMidPrice(params: {
    tokenIn: string;
    tokenOut: string;
  }): Promise<string | null> {
    const pairKey = `${params.tokenIn}/${params.tokenOut}`;
    const price = REFERENCE_PRICES[pairKey];
    return price !== undefined ? String(price) : null;
  }

  async buildExecutionPayload(quote: VenueQuote): Promise<unknown> {
    return {
      type: 'jupiter_v6_swap',
      inputMint: quote.tokenIn,
      outputMint: quote.tokenOut,
      amount: quote.amountIn,
      slippageBps: 50,
      quoteResponse: quote.raw,
    };
  }

  private simulateQuote(tokenIn: string, tokenOut: string, amountIn: string): VenueQuote | null {
    const pairKey = `${tokenIn}/${tokenOut}`;
    const refPrice = REFERENCE_PRICES[pairKey];
    if (refPrice === undefined) return null;

    const amountInNum = parseFloat(amountIn);
    if (isNaN(amountInNum) || amountInNum <= 0) return null;

    const priceImpactBps = Math.round((amountInNum / SIMULATED_DEPTH_USD) * 50);
    const slippageMultiplier = 1 - priceImpactBps / 10000;
    const effectivePrice = refPrice * slippageMultiplier;
    const fee = amountInNum * (FEE_BPS / 10000);
    const amountOut = (amountInNum - fee) * effectivePrice;

    this.markFresh();
    return this.buildBaseQuote({
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: amountOut.toFixed(6),
      price: effectivePrice.toFixed(8),
      feeEstimate: fee.toFixed(6),
      slippageEstimateBps: priceImpactBps,
      confidence: 0.92,
      route: ['jupiter-v6', `${tokenIn}->${tokenOut}`],
      raw: { paperMode: true, refPrice, priceImpactBps, routePlan: [] },
    });
  }
}
