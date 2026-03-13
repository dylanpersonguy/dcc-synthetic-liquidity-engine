import type { VenueQuote } from '@dcc/types';
import { BaseVenueAdapter, type VenueAdapterConfig } from '../base-adapter.js';

// ============================================================================
// DccOrderbookAdapter — local DCC orderbook connector
// ============================================================================

const DEFAULT_DCC_BOOK_CONFIG: VenueAdapterConfig = {
  venueId: 'dcc-orderbook',
  venueType: 'DCC_ORDERBOOK',
  baseUrl: 'http://localhost:4000', // DCC node RPC
  timeoutMs: 3000,
  maxStalenessMs: 5000,
};

export class DccOrderbookAdapter extends BaseVenueAdapter {
  constructor(config?: Partial<VenueAdapterConfig>) {
    super({ ...DEFAULT_DCC_BOOK_CONFIG, ...config });
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
