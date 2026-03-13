// ============================================================================
// Integration Tests — Full Routing Pipeline
// ============================================================================
// Tests the end-to-end flow: venue adapters → venue snapshots → router core
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import {
  JupiterAdapter,
  RaydiumAdapter,
  DccAmmAdapter,
  VenueRegistry,
} from '@dcc/connectors';
import type {
  Pair,
  QuoteRequest,
  VenueSnapshot,
  MarketRiskConfig,
  ProtocolRiskConfig,
  VenueQuote,
  IVenueAdapter,
} from '@dcc/types';
import {
  discoverCandidates,
  scoreCandidates,
  applyRiskFilters,
  selectRoute,
  buildQuote,
  runRouter,
} from './router.js';

// ── Test helpers ─────────────────────────────────────────────────────────

function makeDccSolPair(): Pair {
  return {
    pairId: 'DCC/SOL',
    baseAssetId: 'DCC',
    quoteAssetId: 'SOL',
    baseSymbol: 'DCC',
    quoteSymbol: 'SOL',
    primaryMode: 'TELEPORT',
    status: 'ACTIVE',
    riskTier: 'TIER_1',
    supportedModes: ['NATIVE', 'TELEPORT', 'SYNTHETIC'],
    syntheticAssetId: 'sSOL',
    localPoolId: null,
    localBookId: null,
    externalSources: [],
    maxTradeSize: '100000',
    maxDailyVolume: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeRequest(overrides?: Partial<QuoteRequest>): QuoteRequest {
  return {
    pairId: 'DCC/SOL',
    side: 'SELL',
    amount: '1000',
    ...overrides,
  };
}

function makeGlobalRisk(overrides?: Partial<ProtocolRiskConfig>): ProtocolRiskConfig {
  return {
    maxTotalRelayerNotional: '10000000',
    maxTotalSyntheticNotional: '5000000',
    maxRedemptionBacklog: 100,
    globalStaleQuoteThresholdMs: 30000,
    emergencyPause: false,
    globalCircuitBreaker: 'NONE',
    allowedRelayers: ['relayer-1'],
    maxRelayerExposure: '1000000',
    defaultEscrowTimeoutMs: 300000,
    maxEscrowTimeoutMs: 600000,
    routeScoreWeights: {
      output: 0.35,
      fee: 0.20,
      slippage: 0.15,
      freshness: 0.15,
      settlement: 0.15,
    },
    marketOverrides: {},
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMarketRisk(overrides?: Partial<MarketRiskConfig>): MarketRiskConfig {
  return {
    pairId: 'DCC/SOL',
    maxTradeSize: '100000',
    maxDailyVolume: '10000000',
    maxOpenExecutions: 50,
    staleQuoteThresholdMs: 30000,
    maxSlippageBps: 300,
    circuitBreaker: 'NONE',
    ...overrides,
  };
}

function makeContext() {
  return {
    currentDailyVolume: '50000',
    currentOpenExecutions: 5,
    relayerAvailableInventory: { SOL: '10000', USDC: '5000000' } as Record<string, string>,
    syntheticRemainingCap: { sSOL: '100000' } as Record<string, string>,
  };
}

async function buildSnapshotFromAdapter(
  adapter: IVenueAdapter,
  pairId: string,
  tokenIn: string,
  tokenOut: string,
): Promise<VenueSnapshot | null> {
  const midPrice = await adapter.getMidPrice({ tokenIn, tokenOut });
  if (!midPrice) return null;

  const freshness = await adapter.getFreshness();
  const now = Date.now();

  return {
    venueId: adapter.venueId,
    venueType: adapter.venueType,
    pairId,
    midPrice,
    bestBid: null,
    bestAsk: null,
    bidDepth: null,
    askDepth: null,
    spread: null,
    lastTradePrice: null,
    volume24h: null,
    freshness: freshness.isStale ? 0 : 0.95,
    isStale: freshness.isStale,
    fetchedAt: now,
  };
}

// ── Step 1: Venue adapters produce quotes ────────────────────────────────

describe('Step 1: Venue Adapters', () => {
  it('DCC AMM produces a DCC/USDC quote', async () => {
    const adapter = new DccAmmAdapter({ paperMode: true });
    const quote = await adapter.getQuote({
      tokenIn: 'DCC',
      tokenOut: 'USDC',
      amountIn: '1000',
    });
    expect(quote).not.toBeNull();
    expect(quote!.venueId).toBe('dcc-amm');
    expect(quote!.venueType).toBe('DCC_AMM');
    expect(parseFloat(quote!.amountOut)).toBeGreaterThan(0);
    expect(quote!.confidence).toBe(0.95);
  });

  it('Jupiter produces a USDC/SOL quote', async () => {
    const adapter = new JupiterAdapter({ paperMode: true });
    const quote = await adapter.getQuote({
      tokenIn: 'USDC',
      tokenOut: 'SOL',
      amountIn: '850',
    });
    expect(quote).not.toBeNull();
    expect(quote!.venueId).toBe('jupiter');
    expect(quote!.venueType).toBe('JUPITER');
    expect(parseFloat(quote!.amountOut)).toBeGreaterThan(0);
  });

  it('Raydium produces a USDC/SOL quote', async () => {
    const adapter = new RaydiumAdapter({ paperMode: true });
    const quote = await adapter.getQuote({
      tokenIn: 'USDC',
      tokenOut: 'SOL',
      amountIn: '850',
    });
    expect(quote).not.toBeNull();
    expect(quote!.venueId).toBe('raydium');
    expect(parseFloat(quote!.amountOut)).toBeGreaterThan(0);
  });

  it('returns null for unsupported pairs', async () => {
    const adapter = new JupiterAdapter({ paperMode: true });
    const quote = await adapter.getQuote({
      tokenIn: 'DCC',
      tokenOut: 'SOL',
      amountIn: '1000',
    });
    expect(quote).toBeNull();
  });
});

// ── Step 2: VenueRegistry aggregation ────────────────────────────────────

describe('Step 2: VenueRegistry', () => {
  it('registers and retrieves adapters', () => {
    const registry = new VenueRegistry();
    const jupiter = new JupiterAdapter({ paperMode: true });
    const raydium = new RaydiumAdapter({ paperMode: true });
    const dccAmm = new DccAmmAdapter({ paperMode: true });

    registry.register(jupiter);
    registry.register(raydium);
    registry.register(dccAmm);

    expect(registry.getAll()).toHaveLength(3);
    expect(registry.get('jupiter')).toBe(jupiter);
    expect(registry.getByType('DCC_AMM')).toHaveLength(1);
    expect(registry.has('raydium')).toBe(true);
  });
});

// ── Step 3: Build VenueSnapshots from adapters ───────────────────────────

describe('Step 3: Build VenueSnapshots', () => {
  let dccAmm: DccAmmAdapter;
  let jupiter: JupiterAdapter;

  beforeAll(async () => {
    dccAmm = new DccAmmAdapter({ paperMode: true });
    jupiter = new JupiterAdapter({ paperMode: true });
    // Warm up adapters so they have fresh timestamps
    await dccAmm.getQuote({ tokenIn: 'DCC', tokenOut: 'USDC', amountIn: '100' });
    await jupiter.getQuote({ tokenIn: 'USDC', tokenOut: 'SOL', amountIn: '100' });
  });

  it('builds snapshot from DCC AMM adapter', async () => {
    const snapshot = await buildSnapshotFromAdapter(dccAmm, 'DCC/USDC', 'DCC', 'USDC');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.venueType).toBe('DCC_AMM');
    expect(snapshot!.midPrice).not.toBeNull();
    expect(parseFloat(snapshot!.midPrice!)).toBeCloseTo(0.85, 1);
    expect(snapshot!.isStale).toBe(false);
  });

  it('builds snapshot from Jupiter adapter', async () => {
    const snapshot = await buildSnapshotFromAdapter(jupiter, 'USDC/SOL', 'USDC', 'SOL');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.venueType).toBe('JUPITER');
    expect(snapshot!.midPrice).not.toBeNull();
    expect(snapshot!.isStale).toBe(false);
  });

  it('returns null for unsupported pairs', async () => {
    const snapshot = await buildSnapshotFromAdapter(jupiter, 'DCC/SOL', 'DCC', 'SOL');
    expect(snapshot).toBeNull();
  });
});

// ── Step 4: Full router pipeline ─────────────────────────────────────────

describe('Step 4: Router Pipeline', () => {
  let snapshots: VenueSnapshot[];

  beforeAll(async () => {
    const dccAmm = new DccAmmAdapter({ paperMode: true });
    const jupiter = new JupiterAdapter({ paperMode: true });
    const raydium = new RaydiumAdapter({ paperMode: true });

    // Warm adapters
    await dccAmm.getQuote({ tokenIn: 'DCC', tokenOut: 'USDC', amountIn: '100' });
    await jupiter.getQuote({ tokenIn: 'USDC', tokenOut: 'SOL', amountIn: '100' });
    await raydium.getQuote({ tokenIn: 'USDC', tokenOut: 'SOL', amountIn: '100' });

    const now = Date.now();
    snapshots = [
      // DCC AMM snapshot for DCC/USDC
      {
        venueId: 'dcc-amm',
        venueType: 'DCC_AMM',
        pairId: 'DCC/SOL',
        midPrice: '0.85',
        bestBid: null,
        bestAsk: null,
        bidDepth: null,
        askDepth: null,
        spread: null,
        lastTradePrice: null,
        volume24h: null,
        freshness: 0.95,
        isStale: false,
        fetchedAt: now,
      },
      // Jupiter snapshot for USDC/SOL
      {
        venueId: 'jupiter',
        venueType: 'JUPITER',
        pairId: 'DCC/SOL',
        midPrice: String(1 / 135.5),
        bestBid: null,
        bestAsk: null,
        bidDepth: null,
        askDepth: null,
        spread: null,
        lastTradePrice: null,
        volume24h: null,
        freshness: 0.92,
        isStale: false,
        fetchedAt: now,
      },
      // Raydium snapshot for USDC/SOL
      {
        venueId: 'raydium',
        venueType: 'RAYDIUM',
        pairId: 'DCC/SOL',
        midPrice: String(1 / 135.4),
        bestBid: null,
        bestAsk: null,
        bidDepth: null,
        askDepth: null,
        spread: null,
        lastTradePrice: null,
        volume24h: null,
        freshness: 0.88,
        isStale: false,
        fetchedAt: now,
      },
    ];
  });

  it('discovers candidates from venue snapshots', () => {
    const pair = makeDccSolPair();
    const request = makeRequest();
    const candidates = discoverCandidates(pair, snapshots, request);
    expect(candidates.length).toBeGreaterThan(0);

    // Should find LOCAL (DCC AMM), TELEPORT (DCC AMM→Jupiter, DCC AMM→Raydium), SYNTHETIC
    const modes = candidates.map((c) => c.mode);
    expect(modes).toContain('LOCAL');
    expect(modes).toContain('TELEPORT');
    expect(modes).toContain('SYNTHETIC');
  });

  it('scores candidates deterministically', () => {
    const pair = makeDccSolPair();
    const request = makeRequest();
    const candidates = discoverCandidates(pair, snapshots, request);
    const globalRisk = makeGlobalRisk();
    const marketRisk = makeMarketRisk();
    const scored = scoreCandidates(candidates, globalRisk.routeScoreWeights, marketRisk);

    expect(scored.length).toBeGreaterThan(0);

    // All scores should be numeric
    for (const s of scored) {
      expect(s.scores.compositeScore).toBeGreaterThan(0);
      expect(s.scores.outputScore).toBeGreaterThanOrEqual(0);
      expect(s.scores.outputScore).toBeLessThanOrEqual(1);
    }

    // Should be sorted by compositeScore descending
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1]!.scores.compositeScore).toBeGreaterThanOrEqual(
        scored[i]!.scores.compositeScore,
      );
    }
  });

  it('applies risk filters and selects route', () => {
    const pair = makeDccSolPair();
    const request = makeRequest();
    const candidates = discoverCandidates(pair, snapshots, request);
    const globalRisk = makeGlobalRisk();
    const marketRisk = makeMarketRisk();
    const scored = scoreCandidates(candidates, globalRisk.routeScoreWeights, marketRisk);
    const filtered = applyRiskFilters(scored, globalRisk, marketRisk, makeContext());

    expect(filtered.length).toBeGreaterThan(0);

    const selected = selectRoute(filtered, 0.5);
    expect(selected).not.toBeNull();
    expect(selected!.scores.compositeScore).toBeGreaterThan(0);
  });

  it('builds a quote from selected route', () => {
    const pair = makeDccSolPair();
    const request = makeRequest();
    const candidates = discoverCandidates(pair, snapshots, request);
    const globalRisk = makeGlobalRisk();
    const marketRisk = makeMarketRisk();
    const scored = scoreCandidates(candidates, globalRisk.routeScoreWeights, marketRisk);
    const filtered = applyRiskFilters(scored, globalRisk, marketRisk, makeContext());
    const selected = selectRoute(filtered, 0.5)!;

    const quote = buildQuote(selected, request, pair, 'test-quote-1', Date.now(), 30000);
    expect(quote.quoteId).toBe('test-quote-1');
    expect(quote.pairId).toBe('DCC/SOL');
    expect(quote.legs.length).toBeGreaterThan(0);
    expect(parseFloat(quote.outputAmount)).toBeGreaterThan(0);
    expect(parseFloat(quote.totalFeeEstimate)).toBeGreaterThan(0);
    expect(quote.expiresAt).toBeGreaterThan(quote.createdAt);
  });

  it('runRouter one-call pipeline produces a valid quote', () => {
    const result = runRouter({
      pair: makeDccSolPair(),
      request: makeRequest(),
      venueSnapshots: snapshots,
      globalRisk: makeGlobalRisk(),
      marketRisk: makeMarketRisk(),
      context: makeContext(),
      quoteId: 'pipeline-quote-1',
      now: Date.now(),
      quoteTtlMs: 30000,
      safetyPreference: 0.5,
    });

    expect(result.rejectionReason).toBeNull();
    expect(result.quote).not.toBeNull();
    expect(result.allCandidates.length).toBeGreaterThan(0);
    expect(result.allScored.length).toBeGreaterThan(0);
    expect(result.filtered.length).toBeGreaterThan(0);
    expect(result.selected).not.toBeNull();
    expect(result.quote!.quoteId).toBe('pipeline-quote-1');
  });
});

// ── Step 5: Risk filter edge cases ───────────────────────────────────────

describe('Step 5: Risk Filters', () => {
  const now = Date.now();
  const snapshots: VenueSnapshot[] = [
    {
      venueId: 'dcc-amm',
      venueType: 'DCC_AMM',
      pairId: 'DCC/SOL',
      midPrice: '0.85',
      bestBid: null, bestAsk: null, bidDepth: null, askDepth: null,
      spread: null, lastTradePrice: null, volume24h: null,
      freshness: 0.95, isStale: false, fetchedAt: now,
    },
  ];

  it('rejects all routes on emergency pause', () => {
    const result = runRouter({
      pair: makeDccSolPair(),
      request: makeRequest(),
      venueSnapshots: snapshots,
      globalRisk: makeGlobalRisk({ emergencyPause: true }),
      marketRisk: makeMarketRisk(),
      context: makeContext(),
      quoteId: 'paused-test',
      now,
      quoteTtlMs: 30000,
      safetyPreference: 0,
    });

    expect(result.quote).toBeNull();
    expect(result.rejectionReason).toBe('All candidates rejected by risk filters');
  });

  it('rejects oversized trades', () => {
    const result = runRouter({
      pair: makeDccSolPair(),
      request: makeRequest({ amount: '999999' }),
      venueSnapshots: snapshots,
      globalRisk: makeGlobalRisk(),
      marketRisk: makeMarketRisk({ maxTradeSize: '1000' }),
      context: makeContext(),
      quoteId: 'oversize-test',
      now,
      quoteTtlMs: 30000,
      safetyPreference: 0,
    });

    expect(result.quote).toBeNull();
  });
});

// ── Step 6: DCC/USDC LOCAL mode ──────────────────────────────────────────

describe('Step 6: DCC/USDC LOCAL mode', () => {
  it('produces a LOCAL quote for DCC/USDC', () => {
    const now = Date.now();
    const pair: Pair = {
      pairId: 'DCC/USDC',
      baseAssetId: 'DCC',
      quoteAssetId: 'USDC',
      baseSymbol: 'DCC',
      quoteSymbol: 'USDC',
      primaryMode: 'NATIVE',
      status: 'ACTIVE',
      riskTier: 'TIER_1',
      supportedModes: ['NATIVE'],
      syntheticAssetId: null,
      localPoolId: 'dcc-usdc-pool',
      localBookId: null,
      externalSources: [],
      maxTradeSize: '100000',
      maxDailyVolume: null,
      createdAt: now,
      updatedAt: now,
    };

    const snapshots: VenueSnapshot[] = [
      {
        venueId: 'dcc-amm',
        venueType: 'DCC_AMM',
        pairId: 'DCC/USDC',
        midPrice: '0.85',
        bestBid: null, bestAsk: null, bidDepth: null, askDepth: null,
        spread: null, lastTradePrice: null, volume24h: null,
        freshness: 0.95, isStale: false, fetchedAt: now,
      },
    ];

    const result = runRouter({
      pair,
      request: { pairId: 'DCC/USDC', side: 'SELL', amount: '500' },
      venueSnapshots: snapshots,
      globalRisk: makeGlobalRisk(),
      marketRisk: makeMarketRisk({ pairId: 'DCC/USDC' }),
      context: makeContext(),
      quoteId: 'local-dcc-usdc',
      now,
      quoteTtlMs: 30000,
      safetyPreference: 1.0,
    });

    expect(result.quote).not.toBeNull();
    expect(result.selected!.candidate.mode).toBe('LOCAL');
    expect(result.quote!.mode).toBe('LOCAL');
    expect(parseFloat(result.quote!.outputAmount)).toBeGreaterThan(0);
  });
});
