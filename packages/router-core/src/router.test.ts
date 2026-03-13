import { describe, it, expect } from 'vitest';
import {
  selectRoute,
  buildQuote,
  type RouteCandidate,
  type ScoredRoute,
  type ScoringWeights,
} from '../src/router.js';
import type { Pair, QuoteRequest, VenueQuote } from '@dcc/types';

// ── Test Fixtures ──────────────────────────────────────────────────────

const NOW = 1700000000000;
const QUOTE_TTL = 30000;

function makeVenueQuote(overrides: Partial<VenueQuote> = {}): VenueQuote {
  return {
    venueId: 'dcc-amm',
    venueType: 'DCC_AMM',
    chain: 'dcc',
    tokenIn: 'DCC',
    tokenOut: 'USDC',
    amountIn: '1000',
    amountOut: '50',
    price: '0.05',
    feeEstimate: '0.25',
    slippageEstimateBps: 10,
    fetchedAt: NOW - 2000,
    expiresAt: NOW + 28000,
    confidence: 0.95,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    mode: 'LOCAL',
    legs: [makeVenueQuote()],
    totalOutputAmount: '50',
    totalFees: '0.25',
    worstSlippageBps: 10,
    worstFreshness: 0.95,
    requiresRelayer: false,
    requiresEscrow: false,
    ...overrides,
  };
}

function makeScoredRoute(
  candidateOverrides: Partial<RouteCandidate> = {},
  scoreOverrides: Partial<ScoredRoute['scores']> = {},
): ScoredRoute {
  return {
    candidate: makeCandidate(candidateOverrides),
    scores: {
      outputScore: 0.9,
      feeScore: 0.85,
      slippageScore: 0.95,
      freshnessScore: 0.95,
      settlementScore: 1.0,
      compositeScore: 0.92,
      ...scoreOverrides,
    },
  };
}

function makePair(overrides: Partial<Pair> = {}): Pair {
  return {
    pairId: 'DCC/USDC',
    baseAssetId: 'dcc',
    quoteAssetId: 'usdc',
    baseSymbol: 'DCC',
    quoteSymbol: 'USDC',
    primaryMode: 'NATIVE',
    supportedModes: ['NATIVE'],
    status: 'ACTIVE',
    riskTier: 'TIER_1',
    localPoolId: 'pool-dcc-usdc',
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [],
    maxTradeSize: '50000',
    maxDailyVolume: '1000000',
    createdAt: NOW - 86400000,
    updatedAt: NOW - 3600000,
    ...overrides,
  } as Pair;
}

function makeQuoteRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    pairId: 'DCC/USDC',
    side: 'SELL',
    amount: '1000',
    ...overrides,
  } as QuoteRequest;
}

// ── selectRoute Tests ──────────────────────────────────────────────────

describe('selectRoute', () => {
  it('returns null for empty input', () => {
    expect(selectRoute([], 0.5)).toBeNull();
  });

  it('returns the highest-scored route', () => {
    const routes = [
      makeScoredRoute({}, { compositeScore: 0.80 }),
      makeScoredRoute({}, { compositeScore: 0.92 }),
      makeScoredRoute({}, { compositeScore: 0.85 }),
    ];
    const result = selectRoute(routes, 0);
    expect(result).not.toBeNull();
    expect(result!.scores.compositeScore).toBe(0.92);
  });

  it('prefers LOCAL over TELEPORT when within safety threshold', () => {
    const teleport = makeScoredRoute(
      { mode: 'TELEPORT', requiresRelayer: true, requiresEscrow: true },
      { compositeScore: 0.90, settlementScore: 0.5 },
    );
    const local = makeScoredRoute(
      { mode: 'LOCAL' },
      { compositeScore: 0.87, settlementScore: 1.0 },
    );

    // safetyPreference=0.5 → threshold = 0.5 * 0.1 = 0.05
    // scoreDiff = 0.90 - 0.87 = 0.03 < 0.05 → prefer LOCAL
    const result = selectRoute([teleport, local], 0.5);
    expect(result).not.toBeNull();
    expect(result!.candidate.mode).toBe('LOCAL');
  });

  it('allows TELEPORT when significantly better than LOCAL', () => {
    const teleport = makeScoredRoute(
      { mode: 'TELEPORT', requiresRelayer: true, requiresEscrow: true },
      { compositeScore: 0.95, settlementScore: 0.5 },
    );
    const local = makeScoredRoute(
      { mode: 'LOCAL' },
      { compositeScore: 0.80, settlementScore: 1.0 },
    );

    // safetyPreference=0.5 → threshold = 0.05
    // scoreDiff = 0.95 - 0.80 = 0.15 > 0.05 → allow TELEPORT
    const result = selectRoute([teleport, local], 0.5);
    expect(result).not.toBeNull();
    expect(result!.candidate.mode).toBe('TELEPORT');
  });

  it('ignores safety preference when set to 0', () => {
    const teleport = makeScoredRoute(
      { mode: 'TELEPORT', requiresRelayer: true },
      { compositeScore: 0.91 },
    );
    const local = makeScoredRoute(
      { mode: 'LOCAL' },
      { compositeScore: 0.90 },
    );

    // safetyPreference=0 → pure score wins → TELEPORT
    const result = selectRoute([teleport, local], 0);
    expect(result!.candidate.mode).toBe('TELEPORT');
  });

  it('returns single route when only one candidate', () => {
    const route = makeScoredRoute({}, { compositeScore: 0.75 });
    const result = selectRoute([route], 1.0);
    expect(result).not.toBeNull();
    expect(result!.scores.compositeScore).toBe(0.75);
  });
});

// ── buildQuote Tests ───────────────────────────────────────────────────

describe('buildQuote', () => {
  it('builds a valid quote from a scored route', () => {
    const selected = makeScoredRoute();
    const request = makeQuoteRequest();
    const pair = makePair();

    const quote = buildQuote(selected, request, pair, 'q-1', NOW, QUOTE_TTL);

    expect(quote.quoteId).toBe('q-1');
    expect(quote.pairId).toBe('DCC/USDC');
    expect(quote.mode).toBe('LOCAL');
    expect(quote.side).toBe('SELL');
    expect(quote.inputAsset).toBe('dcc');
    expect(quote.outputAsset).toBe('usdc');
    expect(quote.inputAmount).toBe('1000');
    expect(quote.outputAmount).toBe('50');
    expect(quote.createdAt).toBe(NOW);
    expect(quote.expiresAt).toBe(NOW + QUOTE_TTL);
    expect(quote.legs).toHaveLength(1);
    expect(quote.confidenceScore).toBe(0.95);
  });

  it('sets correct assets for BUY side', () => {
    const selected = makeScoredRoute();
    const request = makeQuoteRequest({ side: 'BUY' });
    const pair = makePair();

    const quote = buildQuote(selected, request, pair, 'q-2', NOW, QUOTE_TTL);

    // BUY: input = quote asset, output = base asset
    expect(quote.inputAsset).toBe('usdc');
    expect(quote.outputAsset).toBe('dcc');
  });

  it('maps multiple legs correctly for teleport route', () => {
    const leg0 = makeVenueQuote({
      venueId: 'dcc-amm',
      tokenIn: 'DCC',
      tokenOut: 'USDC',
      amountIn: '1000',
      amountOut: '50',
    });
    const leg1 = makeVenueQuote({
      venueId: 'jupiter',
      venueType: 'JUPITER',
      chain: 'solana',
      tokenIn: 'USDC',
      tokenOut: 'SOL',
      amountIn: '50',
      amountOut: '0.33',
      price: '151.51',
    });

    const selected = makeScoredRoute({
      mode: 'TELEPORT',
      legs: [leg0, leg1],
      totalOutputAmount: '0.33',
      totalFees: '0.50',
      requiresRelayer: true,
      requiresEscrow: true,
    });

    const pair = makePair({
      pairId: 'DCC/SOL',
      primaryMode: 'TELEPORT',
      supportedModes: ['TELEPORT'],
    });
    const request = makeQuoteRequest({ pairId: 'DCC/SOL' });

    const quote = buildQuote(selected, request, pair, 'q-3', NOW, QUOTE_TTL);

    expect(quote.legs).toHaveLength(2);
    expect(quote.legs[0]!.venueId).toBe('dcc-amm');
    expect(quote.legs[1]!.venueId).toBe('jupiter');
    expect(quote.outputAmount).toBe('0.33');
    expect(quote.mode).toBe('TELEPORT');
    expect(quote.priceSources).toEqual(['dcc-amm', 'jupiter']);
  });

  it('includes freshness score as confidence', () => {
    const selected = makeScoredRoute({}, { freshnessScore: 0.42 });
    const request = makeQuoteRequest();
    const pair = makePair();

    const quote = buildQuote(selected, request, pair, 'q-4', NOW, QUOTE_TTL);
    expect(quote.confidenceScore).toBe(0.42);
  });
});

// ── Determinism Tests ──────────────────────────────────────────────────

describe('determinism', () => {
  it('selectRoute produces identical output for identical input', () => {
    const routes = [
      makeScoredRoute({ mode: 'TELEPORT' }, { compositeScore: 0.88 }),
      makeScoredRoute({ mode: 'LOCAL' }, { compositeScore: 0.85 }),
      makeScoredRoute({ mode: 'SYNTHETIC' }, { compositeScore: 0.82 }),
    ];

    const result1 = selectRoute(routes, 0.5);
    const result2 = selectRoute(routes, 0.5);

    expect(result1).toEqual(result2);
  });

  it('buildQuote produces identical output for identical input', () => {
    const selected = makeScoredRoute();
    const request = makeQuoteRequest();
    const pair = makePair();

    const q1 = buildQuote(selected, request, pair, 'q-det', NOW, QUOTE_TTL);
    const q2 = buildQuote(selected, request, pair, 'q-det', NOW, QUOTE_TTL);

    expect(q1).toEqual(q2);
  });
});
