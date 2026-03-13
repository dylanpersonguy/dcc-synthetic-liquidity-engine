import type { VenueQuote } from '@dcc/types';
import { BaseVenueAdapter, type VenueAdapterConfig } from '../base-adapter.js';

// ============================================================================
// UniswapAdapter — Ethereum DEX connector
// ============================================================================
//
// Connects to Uniswap's official routing API for ETH-side quotes.
// Supports Ethereum mainnet and optionally Arbitrum/Base for gas efficiency.
//
// Phase 1: Implement core quote methods via Uniswap API.
// Phase 2+: Support direct on-chain QuoterV2 calls for L2s.
// ============================================================================

const DEFAULT_UNISWAP_CONFIG: VenueAdapterConfig = {
  venueId: 'uniswap',
  venueType: 'UNISWAP',
  baseUrl: 'https://api.uniswap.org/v2',
  timeoutMs: 8000,
  maxStalenessMs: 15000,
};

const UNISWAP_TOKEN_MAP: Record<string, string> = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
};

export class UniswapAdapter extends BaseVenueAdapter {
  constructor(config?: Partial<VenueAdapterConfig>) {
    super({ ...DEFAULT_UNISWAP_CONFIG, ...config });
  }

  protected getChain(): string {
    return 'ethereum';
  }

  normalizeSymbol(venueSymbol: string): string {
    return UNISWAP_TOKEN_MAP[venueSymbol] ?? venueSymbol;
  }

  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueQuote | null> {
    // Phase 1: Implement Uniswap /quote API call
    // POST {baseUrl}/quote
    // Body: { tokenIn, tokenOut, amount, type: 'EXACT_INPUT', ... }
    void params;
    return null;
  }

  async getRouteCandidates(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    maxRoutes?: number;
  }): Promise<VenueQuote[]> {
    void params;
    return [];
  }

  async getDepthEstimate(params: {
    tokenIn: string;
    tokenOut: string;
    notional: string;
  }): Promise<{ availableSize: string; estimatedSlippageBps: number } | null> {
    void params;
    return null;
  }

  async getMidPrice(params: {
    tokenIn: string;
    tokenOut: string;
  }): Promise<string | null> {
    void params;
    return null;
  }

  async buildExecutionPayload(quote: VenueQuote): Promise<unknown> {
    void quote;
    return null;
  }
}
