import type { VenueQuote } from '@dcc/types';
import { BaseVenueAdapter, type VenueAdapterConfig } from '../base-adapter.js';

// ============================================================================
// DccAmmAdapter — local DCC AMM connector
// ============================================================================
// Provides simulated quotes for DCC-native pairs (DCC/USDC, DCC/sSOL, etc.).
// In paper mode, returns deterministic quotes based on reference prices.
// In live mode, reads from the DCC AMM contract via RPC.
// ============================================================================

const DEFAULT_DCC_AMM_CONFIG: VenueAdapterConfig = {
  venueId: 'dcc-amm',
  venueType: 'DCC_AMM',
  baseUrl: 'http://localhost:4000',
  timeoutMs: 3000,
  maxStalenessMs: 5000,
};

/** Reference prices for DCC-native pairs (paper mode) */
const REFERENCE_PRICES: Record<string, number> = {
  'DCC/USDC': 0.85,
  'USDC/DCC': 1 / 0.85,
};

/** Simulated pool depth in USD */
const SIMULATED_DEPTH_USD = 500_000;

/** Fee rate in bps */
const FEE_BPS = 30;

export class DccAmmAdapter extends BaseVenueAdapter {
  private paperMode: boolean;

  constructor(config?: Partial<VenueAdapterConfig> & { paperMode?: boolean }) {
    super({ ...DEFAULT_DCC_AMM_CONFIG, ...config });
    this.paperMode = config?.paperMode ?? true;
  }

  protected getChain(): string {
    return 'dcc';
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
      const url = new URL('/amm/quote', this.config.baseUrl);
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify({ tokenIn, tokenOut, amountIn }),
      });
      if (!res.ok) return null;

      const data = await res.json() as {
        amountOut?: string;
        price?: string;
        fee?: string;
        slippageBps?: number;
        poolId?: string;
      };
      if (!data.amountOut) return null;

      const amountInNum = parseFloat(amountIn);
      const price = data.price ?? (amountInNum > 0 ? String(parseFloat(data.amountOut) / amountInNum) : '0');

      this.markFresh();
      return this.buildBaseQuote({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: data.amountOut,
        price,
        feeEstimate: data.fee ?? (amountInNum * (FEE_BPS / 10000)).toFixed(6),
        slippageEstimateBps: data.slippageBps ?? 0,
        confidence: 0.97,
        route: ['dcc-amm-pool'],
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
    const slippageBps = Math.round((notionalNum / SIMULATED_DEPTH_USD) * 100);
    return {
      availableSize: String(SIMULATED_DEPTH_USD),
      estimatedSlippageBps: Math.min(slippageBps, 500),
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
      type: 'dcc_amm_swap',
      poolId: 'dcc-usdc-pool',
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

    // Simulate AMM slippage: price impact proportional to trade size vs pool depth
    const priceImpactBps = Math.round((amountInNum / SIMULATED_DEPTH_USD) * 100);
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
      confidence: 0.95,
      route: ['dcc-amm-pool'],
      raw: { paperMode: true, refPrice, priceImpactBps },
    });
  }
}
