import { describe, it, expect } from 'vitest';
import {
  discoverCandidates,
  scoreCandidates,
  applyRiskFilters,
  selectRoute,
  buildQuote,
  runRouter,
  type ScoringWeights,
} from '../src/router.js';
import type {
  Pair,
  QuoteRequest,
  VenueSnapshot,
  MarketRiskConfig,
  ProtocolRiskConfig,
} from '@dcc/types';

// ============================================================================
// Vertical Slice Tests — DCC → SOL End-to-End Route Pipeline
// ============================================================================

const NOW = 1700000000000;

// ── Fixtures: Market Pair ────────────────────────────────────────────────

function makeDccSolPair(overrides: Partial<Pair> = {}): Pair {
  return {
    pairId: 'DCC/SOL',
    baseAssetId: 'dcc',
    quoteAssetId: 'sol',
    baseSymbol: 'DCC',
    quoteSymbol: 'SOL',
    primaryMode: 'TELEPORT',
    supportedModes: ['TELEPORT'],
    status: 'ACTIVE',
    riskTier: 'TIER_2',
    localPoolId: 'pool-dcc-usdc',
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [
      { venueId: 'jupiter', venueType: 'JUPITER', chain: 'solana' },
      { venueId: 'raydium', venueType: 'RAYDIUM', chain: 'solana' },
    ],
    maxTradeSize: '10000',
    maxDailyVolume: '200000',
    createdAt: NOW - 86400000,
    updatedAt: NOW - 3600000,
    ...overrides,
  } as Pair;
}

function makeDccUsdcPair(overrides: Partial<Pair> = {}): Pair {
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

// ── Fixtures: Venue Snapshots ────────────────────────────────────────────

function makeDccAmmSnapshot(overrides: Partial<VenueSnapshot> = {}): VenueSnapshot {
  return {
    venueId: 'dcc-amm',
    venueType: 'DCC_AMM',
    chain: 'dcc',
    midPrice: '0.85',
    bestBid: '0.849',
    bestAsk: '0.851',
    fetchedAt: NOW - 2000,
    isStale: false,
    freshness: 0.98,
    depthUsd: 500000,
    ...overrides,
  } as VenueSnapshot;
}

function makeJupiterSnapshot(overrides: Partial<VenueSnapshot> = {}): VenueSnapshot {
  return {
    venueId: 'jupiter',
    venueType: 'JUPITER',
    chain: 'solana',
    midPrice: '0.007380',
    bestBid: '0.007370',
    bestAsk: '0.007390',
    fetchedAt: NOW - 3000,
    isStale: false,
    freshness: 0.95,
    depthUsd: 2000000,
    ...overrides,
  } as VenueSnapshot;
}

function makeRaydiumSnapshot(overrides: Partial<VenueSnapshot> = {}): VenueSnapshot {
  return {
    venueId: 'raydium',
    venueType: 'RAYDIUM',
    chain: 'solana',
    midPrice: '0.007386',
    bestBid: '0.007376',
    bestAsk: '0.007396',
    fetchedAt: NOW - 5000,
    isStale: false,
    freshness: 0.90,
    depthUsd: 800000,
    ...overrides,
  } as VenueSnapshot;
}

// ── Fixtures: Risk Config ─────────────────────────────────────────────────

const DEFAULT_WEIGHTS: ScoringWeights = {
  output: 0.35,
  fee: 0.15,
  slippage: 0.20,
  freshness: 0.15,
  settlement: 0.15,
};

function makeMarketRisk(overrides: Partial<MarketRiskConfig> = {}): MarketRiskConfig {
  return {
    pairId: 'DCC/SOL',
    maxTradeSize: '10000',
    maxDailyVolume: '200000',
    maxOpenExecutions: 100,
    staleQuoteThresholdMs: 30000,
    maxSlippageBps: 200,
    circuitBreaker: 'NONE',
    ...overrides,
  } as MarketRiskConfig;
}

function makeProtocolRisk(overrides: Partial<ProtocolRiskConfig> = {}): ProtocolRiskConfig {
  return {
    maxTotalRelayerNotional: '5000000',
    maxTotalSyntheticNotional: '2000000',
    maxRedemptionBacklog: 100,
    globalStaleQuoteThresholdMs: 60000,
    emergencyPause: false,
    globalCircuitBreaker: 'NONE',
    allowedRelayers: ['protocol-relayer'],
    maxRelayerExposure: '1000000',
    defaultEscrowTimeoutMs: 300000,
    maxEscrowTimeoutMs: 600000,
    routeScoreWeights: DEFAULT_WEIGHTS,
    marketOverrides: {},
    updatedAt: NOW,
    ...overrides,
  } as ProtocolRiskConfig;
}

function makeRiskContext(overrides: Partial<{
  currentDailyVolume: string;
  currentOpenExecutions: number;
  relayerAvailableInventory: Record<string, string>;
  syntheticRemainingCap: Record<string, string>;
}> = {}) {
  return {
    currentDailyVolume: '50000',
    currentOpenExecutions: 5,
    relayerAvailableInventory: { sol: '200', usdc: '500000', eth: '50' },
    syntheticRemainingCap: {},
    ...overrides,
  };
}

// ============================================================================
// Step 1: discoverCandidates
// ============================================================================

describe('discoverCandidates — DCC/SOL Teleport', () => {
  it('discovers TELEPORT candidates via DCC AMM × Jupiter and Raydium', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot(), makeRaydiumSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);

    // Should find 2 TELEPORT candidates: AMM×Jupiter, AMM×Raydium
    const teleports = candidates.filter((c) => c.mode === 'TELEPORT');
    expect(teleports.length).toBe(2);

    // Each teleport has 2 legs
    for (const t of teleports) {
      expect(t.legs).toHaveLength(2);
      expect(t.legs[0]!.tokenIn).toBe('dcc');
      expect(t.legs[0]!.tokenOut).toBe('USDC');
      expect(t.legs[1]!.tokenIn).toBe('USDC');
      expect(t.legs[1]!.tokenOut).toBe('sol');
      expect(t.requiresRelayer).toBe(true);
      expect(t.requiresEscrow).toBe(true);
    }
  });

  it('discovers no candidates when venues are stale', () => {
    const pair = makeDccSolPair();
    const venues = [
      makeDccAmmSnapshot({ isStale: true }),
      makeJupiterSnapshot({ isStale: true }),
    ];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    expect(candidates).toHaveLength(0);
  });

  it('discovers no candidates when DCC AMM is stale but external is fresh', () => {
    const pair = makeDccSolPair();
    const venues = [
      makeDccAmmSnapshot({ isStale: true }),
      makeJupiterSnapshot(),
    ];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    expect(candidates).toHaveLength(0);
  });

  it('handles zero amount gracefully', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '0' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    expect(candidates).toHaveLength(0);
  });
});

describe('discoverCandidates — DCC/USDC Native', () => {
  it('discovers LOCAL candidates for NATIVE pair', () => {
    const pair = makeDccUsdcPair();
    const venues = [makeDccAmmSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/USDC', side: 'SELL', amount: '5000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);

    const locals = candidates.filter((c) => c.mode === 'LOCAL');
    expect(locals.length).toBeGreaterThanOrEqual(1);
    for (const l of locals) {
      expect(l.legs).toHaveLength(1);
      expect(l.requiresRelayer).toBe(false);
      expect(l.requiresEscrow).toBe(false);
    }
  });
});

// ============================================================================
// Step 2: scoreCandidates
// ============================================================================

describe('scoreCandidates', () => {
  it('correctly scores and ranks TELEPORT candidates', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot(), makeRaydiumSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    const scored = scoreCandidates(candidates, DEFAULT_WEIGHTS, makeMarketRisk());

    // All candidates should have composite scores
    for (const s of scored) {
      expect(s.scores.compositeScore).toBeGreaterThan(0);
      expect(s.scores.compositeScore).toBeLessThanOrEqual(1);
      expect(s.scores.outputScore).toBeGreaterThanOrEqual(0);
      expect(s.scores.feeScore).toBeGreaterThanOrEqual(0);
      expect(s.scores.slippageScore).toBeGreaterThanOrEqual(0);
    }

    // Should be sorted descending by composite score
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1]!.scores.compositeScore).toBeGreaterThanOrEqual(scored[i]!.scores.compositeScore);
    }
  });

  it('returns empty array for empty input', () => {
    const scored = scoreCandidates([], DEFAULT_WEIGHTS, makeMarketRisk());
    expect(scored).toHaveLength(0);
  });

  it('filters out candidates with excessive slippage', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot()];
    // Large amount causes higher slippage calculation
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '5000000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    const scored = scoreCandidates(candidates, DEFAULT_WEIGHTS, makeMarketRisk());

    // Candidates with slippage > 500bps should be filtered
    for (const s of scored) {
      expect(s.candidate.worstSlippageBps).toBeLessThanOrEqual(500);
    }
  });
});

// ============================================================================
// Step 3: applyRiskFilters
// ============================================================================

describe('applyRiskFilters', () => {
  function getScoredRoutes() {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot(), makeRaydiumSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;
    const candidates = discoverCandidates(pair, venues, request);
    return scoreCandidates(candidates, DEFAULT_WEIGHTS, makeMarketRisk());
  }

  it('passes routes when no risk limits are breached', () => {
    const scored = getScoredRoutes();
    const filtered = applyRiskFilters(scored, makeProtocolRisk(), makeMarketRisk(), makeRiskContext());
    expect(filtered.length).toBe(scored.length);
  });

  it('filters all routes when emergency pause is active', () => {
    const scored = getScoredRoutes();
    const filtered = applyRiskFilters(scored, makeProtocolRisk({ emergencyPause: true }), makeMarketRisk(), makeRiskContext());
    expect(filtered).toHaveLength(0);
  });

  it('filters routes when trade exceeds max trade size', () => {
    const scored = getScoredRoutes();
    const filtered = applyRiskFilters(scored, makeProtocolRisk(), makeMarketRisk({ maxTradeSize: '500' }), makeRiskContext());
    expect(filtered).toHaveLength(0);
  });

  it('filters routes when daily volume limit is exceeded', () => {
    const scored = getScoredRoutes();
    const filtered = applyRiskFilters(scored, makeProtocolRisk(), makeMarketRisk({ maxDailyVolume: '100' }), makeRiskContext({
      currentDailyVolume: '99',
    }));
    expect(filtered).toHaveLength(0);
  });

  it('filters routes when max open executions is breached', () => {
    const scored = getScoredRoutes();
    const filtered = applyRiskFilters(scored, makeProtocolRisk(), makeMarketRisk({ maxOpenExecutions: 5 }), makeRiskContext({
      currentOpenExecutions: 5,
    }));
    expect(filtered).toHaveLength(0);
  });
});

// ============================================================================
// Step 4: selectRoute
// ============================================================================

describe('selectRoute — TELEPORT selection', () => {
  it('selects best scored TELEPORT route', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot(), makeRaydiumSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    const scored = scoreCandidates(candidates, DEFAULT_WEIGHTS, makeMarketRisk());
    const selected = selectRoute(scored, 0.3);

    expect(selected).not.toBeNull();
    expect(selected!.candidate.mode).toBe('TELEPORT');
    expect(selected!.candidate.legs).toHaveLength(2);
  });
});

// ============================================================================
// Step 5: Full Pipeline (runRouter)
// ============================================================================

describe('runRouter — Full DCC/SOL Pipeline', () => {
  it('produces a valid quote for DCC/SOL TELEPORT', () => {
    const input = {
      pair: makeDccSolPair(),
      venueSnapshots: [makeDccAmmSnapshot(), makeJupiterSnapshot(), makeRaydiumSnapshot()],
      request: { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest,
      globalRisk: makeProtocolRisk(),
      marketRisk: makeMarketRisk(),
      context: makeRiskContext(),
      safetyPreference: 0.3,
      quoteId: 'test-quote-1',
      now: NOW,
      quoteTtlMs: 30000,
    };

    const result = runRouter(input);

    expect(result.quote).not.toBeNull();
    expect(result.quote!.quoteId).toBe('test-quote-1');
    expect(result.quote!.pairId).toBe('DCC/SOL');
    expect(result.quote!.mode).toBe('TELEPORT');
    expect(result.quote!.legs.length).toBeGreaterThanOrEqual(2);
    expect(parseFloat(result.quote!.outputAmount)).toBeGreaterThan(0);
    expect(result.quote!.createdAt).toBe(NOW);
    expect(result.quote!.expiresAt).toBe(NOW + 30000);
  });

  it('produces a valid quote for DCC/USDC NATIVE', () => {
    const input = {
      pair: makeDccUsdcPair(),
      venueSnapshots: [makeDccAmmSnapshot()],
      request: { pairId: 'DCC/USDC', side: 'SELL', amount: '5000' } as QuoteRequest,
      globalRisk: makeProtocolRisk(),
      marketRisk: makeMarketRisk({ pairId: 'DCC/USDC', maxTradeSize: '50000' }),
      context: makeRiskContext(),
      safetyPreference: 0.5,
      quoteId: 'test-quote-2',
      now: NOW,
      quoteTtlMs: 30000,
    };

    const result = runRouter(input);

    expect(result.quote).not.toBeNull();
    expect(result.quote!.mode).toBe('LOCAL');
    expect(result.quote!.legs).toHaveLength(1);
    expect(result.quote!.legs[0]!.venueId).toBe('dcc-amm');
  });

  it('returns null quote when all venues are stale', () => {
    const input = {
      pair: makeDccSolPair(),
      venueSnapshots: [
        makeDccAmmSnapshot({ isStale: true }),
        makeJupiterSnapshot({ isStale: true }),
      ],
      request: { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest,
      globalRisk: makeProtocolRisk(),
      marketRisk: makeMarketRisk(),
      context: makeRiskContext(),
      safetyPreference: 0.3,
      quoteId: 'test-quote-stale',
      now: NOW,
      quoteTtlMs: 30000,
    };

    const result = runRouter(input);
    expect(result.quote).toBeNull();
  });

  it('returns null quote when emergency pause is active', () => {
    const input = {
      pair: makeDccSolPair(),
      venueSnapshots: [makeDccAmmSnapshot(), makeJupiterSnapshot()],
      request: { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest,
      globalRisk: makeProtocolRisk({ emergencyPause: true }),
      marketRisk: makeMarketRisk(),
      context: makeRiskContext(),
      safetyPreference: 0.3,
      quoteId: 'test-quote-paused',
      now: NOW,
      quoteTtlMs: 30000,
    };

    const result = runRouter(input);
    expect(result.quote).toBeNull();
  });

  it('is deterministic — same input always produces same output', () => {
    const input = {
      pair: makeDccSolPair(),
      venueSnapshots: [makeDccAmmSnapshot(), makeJupiterSnapshot()],
      request: { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest,
      globalRisk: makeProtocolRisk(),
      marketRisk: makeMarketRisk(),
      context: makeRiskContext(),
      safetyPreference: 0.3,
      quoteId: 'test-determinism',
      now: NOW,
      quoteTtlMs: 30000,
    };

    const r1 = runRouter(input);
    const r2 = runRouter(input);
    expect(r1).toEqual(r2);
  });
});

// ============================================================================
// Edge Cases & Security
// ============================================================================

describe('security & edge cases', () => {
  it('rejects negative amounts', () => {
    const pair = makeDccSolPair();
    const venues = [makeDccAmmSnapshot(), makeJupiterSnapshot()];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '-100' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    // Negative amounts should produce no valid candidates
    expect(candidates).toHaveLength(0);
  });

  it('handles missing midPrice gracefully', () => {
    const pair = makeDccSolPair();
    const venues = [
      makeDccAmmSnapshot({ midPrice: undefined as any }),
      makeJupiterSnapshot({ midPrice: null as any }),
    ];
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, venues, request);
    expect(candidates).toHaveLength(0);
  });

  it('handles empty venues array', () => {
    const pair = makeDccSolPair();
    const request: QuoteRequest = { pairId: 'DCC/SOL', side: 'SELL', amount: '1000' } as QuoteRequest;

    const candidates = discoverCandidates(pair, [], request);
    expect(candidates).toHaveLength(0);
  });
});
