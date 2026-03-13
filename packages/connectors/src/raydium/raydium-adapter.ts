import type { VenueQuote } from '@dcc/types';
import { BaseVenueAdapter, type VenueAdapterConfig } from '../base-adapter.js';

// ============================================================================
// RaydiumAdapter — Solana AMM connector (paper mode + live mode)
// ============================================================================

const DEFAULT_RAYDIUM_CONFIG: VenueAdapterConfig = {
  venueId: 'raydium',
  venueType: 'RAYDIUM',
  baseUrl: 'https://api-v3.raydium.io',
  timeoutMs: 5000,
  maxStalenessMs: 10000,
};

const REFERENCE_PRICES: Record<string, number> = {
  'USDC/SOL': 1 / 135.40,
  'SOL/USDC': 135.40,
};

const SIMULATED_DEPTH_USD = 800_000;
const FEE_BPS = 25;

export class RaydiumAdapter extends BaseVenueAdapter {
  private paperMode: boolean;

  constructor(config?: Partial<VenueAdapterConfig> & { paperMode?: boolean }) {
    super({ ...DEFAULT_RAYDIUM_CONFIG, ...config });
    this.paperMode = config?.paperMode ?? true;
  }

  protected getChain(): string {
    return 'solana';
  }

  normalizeSymbol(venueSymbol: string): string {
    return venueSymbol;
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
      const url = new URL('/compute/swap-base-in', this.config.baseUrl);
      url.searchParams.set('inputMint', tokenIn);
      url.searchParams.set('outputMint', tokenOut);
      url.searchParams.set('amount', amountIn);
      url.searchParams.set('slippage', '0.5');

      const res = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: this.config.headers,
      });
      if (!res.ok) return null;

      const data = await res.json() as {
        success?: boolean;
        data?: {
          outputAmount?: string;
          priceImpact?: string;
          routePlan?: unknown[];
        };
      };
      if (!data.success || !data.data?.outputAmount) return null;

      const amountInNum = parseFloat(amountIn);
      const amountOutNum = parseFloat(data.data.outputAmount);
      const price = amountInNum > 0 ? amountOutNum / amountInNum : 0;
      const priceImpactBps = data.data.priceImpact
        ? Math.round(parseFloat(data.data.priceImpact) * 100)
        : 0;

      this.markFresh();
      return this.buildBaseQuote({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: data.data.outputAmount,
        price: price.toFixed(8),
        feeEstimate: (amountInNum * (FEE_BPS / 10000)).toFixed(6),
        slippageEstimateBps: priceImpactBps,
        confidence: 0.90,
        route: ['raydium-clmm', `${tokenIn}->${tokenOut}`],
        raw: data.data,
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
    const slippageBps = Math.round((notionalNum / SIMULATED_DEPTH_USD) * 80);
    return {
      availableSize: String(SIMULATED_DEPTH_USD),
      estimatedSlippageBps: Math.min(slippageBps, 400),
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
      type: 'raydium_swap',
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      minAmountOut: quote.amountOut,
    };
  }

  private simulateQuote(tokenIn: string, tokenOut: string, amountIn: string): VenueQuote | null {
    const pairKey = `${tokenIn}/${tokenOut}`;
    const refPrice = REFERENCE_PRICES[pairKey];
    if (refPrice === undefined) return null;

    const amountInNum = parseFloat(amountIn);
    if (isNaN(amountInNum) || amountInNum <= 0) return null;

    const priceImpactBps = Math.round((amountInNum / SIMULATED_DEPTH_USD) * 80);
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
      confidence: 0.88,
      route: ['raydium-clmm', `${tokenIn}->${tokenOut}`],
      raw: { paperMode: true, refPrice, priceImpactBps },
    });
  }
}
