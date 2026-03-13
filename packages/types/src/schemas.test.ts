import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Import schemas directly from source files
import { DecimalString, ChainId, TimestampMs, PaginationParams, ApiError } from '../src/common.js';
import { MarketMode, MarketStatus, RiskTier, Pair, Asset } from '../src/market.js';
import { QuoteMode, QuoteLeg, Quote, QuoteRequest } from '../src/quote.js';
import { VenueType, VenueQuote, VenueSnapshot } from '../src/venue.js';
import { CircuitBreakerLevel, MarketRiskConfig, ProtocolRiskConfig } from '../src/risk.js';

// ── Common Primitives ──────────────────────────────────────────────────

describe('DecimalString', () => {
  it('accepts valid decimal strings', () => {
    expect(DecimalString.parse('0')).toBe('0');
    expect(DecimalString.parse('100')).toBe('100');
    expect(DecimalString.parse('100.50')).toBe('100.50');
    expect(DecimalString.parse('0.001')).toBe('0.001');
  });

  it('rejects invalid strings', () => {
    expect(() => DecimalString.parse('')).toThrow();
    expect(() => DecimalString.parse('-100')).toThrow();
    expect(() => DecimalString.parse('abc')).toThrow();
    expect(() => DecimalString.parse('1.2.3')).toThrow();
    expect(() => DecimalString.parse(' 100')).toThrow();
  });
});

describe('ChainId', () => {
  it('accepts valid chains', () => {
    expect(ChainId.parse('dcc')).toBe('dcc');
    expect(ChainId.parse('solana')).toBe('solana');
    expect(ChainId.parse('ethereum')).toBe('ethereum');
    expect(ChainId.parse('arbitrum')).toBe('arbitrum');
    expect(ChainId.parse('base')).toBe('base');
  });

  it('rejects unknown chains', () => {
    expect(() => ChainId.parse('bitcoin')).toThrow();
    expect(() => ChainId.parse('')).toThrow();
  });
});

describe('TimestampMs', () => {
  it('accepts positive integers', () => {
    expect(TimestampMs.parse(1700000000000)).toBe(1700000000000);
  });

  it('rejects non-positive and non-integer', () => {
    expect(() => TimestampMs.parse(0)).toThrow();
    expect(() => TimestampMs.parse(-1)).toThrow();
    expect(() => TimestampMs.parse(1.5)).toThrow();
  });
});

describe('PaginationParams', () => {
  it('accepts valid pagination', () => {
    const result = PaginationParams.parse({ limit: 50 });
    expect(result.limit).toBe(50);
    expect(result.cursor).toBeUndefined();
  });

  it('uses default limit', () => {
    const result = PaginationParams.parse({});
    expect(result.limit).toBe(20);
  });

  it('rejects out-of-range limit', () => {
    expect(() => PaginationParams.parse({ limit: 0 })).toThrow();
    expect(() => PaginationParams.parse({ limit: 101 })).toThrow();
  });
});

// ── Market Enums ───────────────────────────────────────────────────────

describe('MarketMode', () => {
  it('accepts all 4 modes', () => {
    for (const mode of ['NATIVE', 'SYNTHETIC', 'TELEPORT', 'REDEEMABLE']) {
      expect(MarketMode.parse(mode)).toBe(mode);
    }
  });

  it('rejects unknown modes', () => {
    expect(() => MarketMode.parse('INVALID')).toThrow();
  });
});

describe('MarketStatus', () => {
  it('accepts all statuses', () => {
    for (const s of ['ACTIVE', 'QUOTE_ONLY', 'PAUSED', 'DISABLED']) {
      expect(MarketStatus.parse(s)).toBe(s);
    }
  });
});

describe('RiskTier', () => {
  it('accepts all tiers', () => {
    for (const t of ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4']) {
      expect(RiskTier.parse(t)).toBe(t);
    }
  });
});

// ── Pair Schema ────────────────────────────────────────────────────────

describe('Pair', () => {
  const validPair = {
    pairId: 'DCC/USDC',
    baseAssetId: 'dcc',
    quoteAssetId: 'usdc',
    baseSymbol: 'DCC',
    quoteSymbol: 'USDC',
    primaryMode: 'NATIVE',
    supportedModes: ['NATIVE'],
    status: 'ACTIVE',
    riskTier: 'TIER_1',
    localPoolId: 'pool-1',
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [],
    maxTradeSize: '50000',
    maxDailyVolume: '1000000',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('accepts a valid pair', () => {
    const result = Pair.parse(validPair);
    expect(result.pairId).toBe('DCC/USDC');
    expect(result.primaryMode).toBe('NATIVE');
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      pairId: 'A/B',
      baseAssetId: 'a',
      quoteAssetId: 'b',
      baseSymbol: 'A',
      quoteSymbol: 'B',
      primaryMode: 'NATIVE',
      supportedModes: ['NATIVE'],
      status: 'ACTIVE',
      riskTier: 'TIER_1',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    const result = Pair.parse(minimal);
    expect(result.localPoolId).toBeNull();
    expect(result.externalSources).toEqual([]);
    expect(result.maxTradeSize).toBeNull();
  });

  it('rejects invalid mode', () => {
    expect(() => Pair.parse({ ...validPair, primaryMode: 'INVALID' })).toThrow();
  });
});

// ── QuoteRequest Schema ────────────────────────────────────────────────

describe('QuoteRequest', () => {
  it('accepts a valid request', () => {
    const result = QuoteRequest.parse({
      pairId: 'DCC/USDC',
      side: 'SELL',
      amount: '1000',
    });
    expect(result.pairId).toBe('DCC/USDC');
    expect(result.side).toBe('SELL');
  });

  it('accepts optional fields', () => {
    const result = QuoteRequest.parse({
      pairId: 'DCC/SOL',
      side: 'BUY',
      amount: '500',
      preferredMode: 'TELEPORT',
      maxSlippageBps: 100,
    });
    expect(result.preferredMode).toBe('TELEPORT');
    expect(result.maxSlippageBps).toBe(100);
  });

  it('rejects invalid side', () => {
    expect(() =>
      QuoteRequest.parse({ pairId: 'A/B', side: 'HOLD', amount: '1' }),
    ).toThrow();
  });

  it('rejects invalid amount', () => {
    expect(() =>
      QuoteRequest.parse({ pairId: 'A/B', side: 'BUY', amount: '-100' }),
    ).toThrow();
  });

  it('rejects excessive slippage', () => {
    expect(() =>
      QuoteRequest.parse({
        pairId: 'A/B',
        side: 'BUY',
        amount: '100',
        maxSlippageBps: 6000,
      }),
    ).toThrow();
  });
});

// ── VenueQuote Schema ──────────────────────────────────────────────────

describe('VenueQuote', () => {
  const validVenueQuote = {
    venueId: 'jupiter',
    venueType: 'JUPITER',
    chain: 'solana',
    tokenIn: 'USDC',
    tokenOut: 'SOL',
    amountIn: '100',
    amountOut: '0.66',
    price: '151.51',
    feeEstimate: '0.10',
    slippageEstimateBps: 5,
    fetchedAt: 1700000000000,
    expiresAt: 1700000030000,
    confidence: 0.95,
  };

  it('accepts a valid venue quote', () => {
    const result = VenueQuote.parse(validVenueQuote);
    expect(result.venueType).toBe('JUPITER');
  });

  it('rejects unknown venue type', () => {
    expect(() =>
      VenueQuote.parse({ ...validVenueQuote, venueType: 'BINANCE' }),
    ).toThrow();
  });

  it('rejects confidence out of range', () => {
    expect(() =>
      VenueQuote.parse({ ...validVenueQuote, confidence: 1.5 }),
    ).toThrow();
    expect(() =>
      VenueQuote.parse({ ...validVenueQuote, confidence: -0.1 }),
    ).toThrow();
  });
});

// ── CircuitBreaker + Risk ──────────────────────────────────────────────

describe('CircuitBreakerLevel', () => {
  it('accepts all levels', () => {
    for (const lvl of ['NONE', 'SOFT_PAUSE', 'HARD_PAUSE']) {
      expect(CircuitBreakerLevel.parse(lvl)).toBe(lvl);
    }
  });
});

describe('MarketRiskConfig', () => {
  it('accepts valid config', () => {
    const result = MarketRiskConfig.parse({
      pairId: 'DCC/USDC',
      maxTradeSize: '50000',
      maxDailyVolume: '1000000',
      maxOpenExecutions: 100,
      staleQuoteThresholdMs: 30000,
      maxSlippageBps: 500,
      circuitBreaker: 'NONE',
    });
    expect(result.pairId).toBe('DCC/USDC');
    expect(result.circuitBreaker).toBe('NONE');
  });
});
