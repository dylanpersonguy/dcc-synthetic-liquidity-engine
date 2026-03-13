// ============================================================================
// quote-engine — Aggregated Quote Generation Service
// ============================================================================
//
// Queries venue adapters via market-data-service, runs the router-core
// pipeline, and returns structured quotes with route legs and scoring.
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, QuoteEngineConfig } from '@dcc/config';
import { randomUUID } from 'node:crypto';
import type { VenueSnapshot, Pair, MarketRiskConfig, ProtocolRiskConfig, QuoteRequest } from '@dcc/types';
import { runRouter, type RouterInput, type RouterOutput } from '@dcc/router-core';

// ── Configuration ───────────────────────────────────────────────────────

const MARKET_DATA_URL = process.env['MARKET_DATA_URL'] ?? 'http://localhost:3210';
const QUOTE_TTL_MS = 30_000;
const SAFETY_PREFERENCE = 0.5;

// ── Pair Registry (in-memory for vertical slice) ────────────────────────

const PAIRS: Record<string, Pair> = {
  'DCC/SOL': {
    pairId: 'DCC/SOL',
    baseAssetId: 'DCC',
    quoteAssetId: 'SOL',
    baseSymbol: 'DCC',
    quoteSymbol: 'SOL',
    primaryMode: 'TELEPORT',
    supportedModes: ['TELEPORT'],
    status: 'ACTIVE',
    riskTier: 'TIER_2',
    localPoolId: null,
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [
      { venueId: 'jupiter', venuePairId: 'USDC/SOL', enabled: true },
      { venueId: 'raydium', venuePairId: 'USDC/SOL', enabled: true },
    ],
    maxTradeSize: '50000',
    maxDailyVolume: '500000',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  'DCC/USDC': {
    pairId: 'DCC/USDC',
    baseAssetId: 'DCC',
    quoteAssetId: 'USDC',
    baseSymbol: 'DCC',
    quoteSymbol: 'USDC',
    primaryMode: 'NATIVE',
    supportedModes: ['NATIVE', 'LOCAL' as any],
    status: 'ACTIVE',
    riskTier: 'TIER_1',
    localPoolId: 'dcc-usdc-pool',
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [],
    maxTradeSize: '100000',
    maxDailyVolume: '1000000',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  'DCC/ETH': {
    pairId: 'DCC/ETH',
    baseAssetId: 'DCC',
    quoteAssetId: 'ETH',
    baseSymbol: 'DCC',
    quoteSymbol: 'ETH',
    primaryMode: 'TELEPORT',
    supportedModes: ['TELEPORT'],
    status: 'ACTIVE',
    riskTier: 'TIER_2',
    localPoolId: null,
    localBookId: null,
    syntheticAssetId: null,
    externalSources: [{ venueId: 'uniswap', venuePairId: 'USDC/ETH', enabled: true }],
    maxTradeSize: '50000',
    maxDailyVolume: '500000',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
};

const DEFAULT_MARKET_RISK: MarketRiskConfig = {
  pairId: '',
  maxTradeSize: '100000',
  maxDailyVolume: '1000000',
  maxOpenExecutions: 50,
  staleQuoteThresholdMs: 30000,
  maxSlippageBps: 500,
  circuitBreaker: 'NONE',
};

const DEFAULT_PROTOCOL_RISK: ProtocolRiskConfig = {
  maxTotalRelayerNotional: '5000000',
  maxTotalSyntheticNotional: '2000000',
  maxRedemptionBacklog: 100,
  globalStaleQuoteThresholdMs: 60000,
  emergencyPause: false,
  globalCircuitBreaker: 'NONE',
  allowedRelayers: ['relayer-primary'],
  maxRelayerExposure: '1000000',
  defaultEscrowTimeoutMs: 600000,
  maxEscrowTimeoutMs: 1800000,
  routeScoreWeights: {
    output: 0.35,
    fee: 0.15,
    slippage: 0.20,
    freshness: 0.15,
    settlement: 0.15,
  },
  marketOverrides: {},
  updatedAt: Date.now(),
};

// ── Fetch Market Data ───────────────────────────────────────────────────

async function fetchSnapshots(pairId: string): Promise<VenueSnapshot[]> {
  try {
    const resp = await fetch(`${MARKET_DATA_URL}/markets/${encodeURIComponent(pairId)}`);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { snapshots: VenueSnapshot[] };
    return data.snapshots ?? [];
  } catch {
    return [];
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(QuoteEngineConfig);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // POST /quote — generate a quote for a trade
  app.post<{ Body: QuoteRequest }>('/quote', async (req, reply) => {
    const { pairId, side, amount, preferredMode, maxSlippageBps } = req.body;

    if (!pairId || !side || !amount) {
      return reply.status(400).send({ error: 'Missing required fields: pairId, side, amount' });
    }

    const pair = PAIRS[pairId];
    if (!pair) {
      return reply.status(404).send({ error: `Unknown pair: ${pairId}` });
    }

    if (pair.status !== 'ACTIVE') {
      return reply.status(400).send({ error: `Pair ${pairId} is ${pair.status}` });
    }

    // Fetch fresh venue data
    const snapshots = await fetchSnapshots(pairId);

    // If no snapshots from market-data-service, build synthetic snapshots from pair config
    const venueSnapshots: VenueSnapshot[] = snapshots.length > 0 ? snapshots : buildDefaultSnapshots(pair);

    const now = Date.now();
    const quoteId = `quote-${randomUUID()}`;

    const marketRisk: MarketRiskConfig = {
      ...DEFAULT_MARKET_RISK,
      pairId,
      maxSlippageBps: maxSlippageBps ?? 500,
    };

    const input: RouterInput = {
      pair,
      request: { pairId, side, amount, preferredMode, maxSlippageBps },
      venueSnapshots,
      globalRisk: DEFAULT_PROTOCOL_RISK,
      marketRisk,
      context: {
        currentDailyVolume: '0',
        currentOpenExecutions: 0,
        relayerAvailableInventory: { SOL: '10000', ETH: '500', USDC: '1000000' },
        syntheticRemainingCap: {},
      },
      quoteId,
      now,
      quoteTtlMs: QUOTE_TTL_MS,
      safetyPreference: SAFETY_PREFERENCE,
    };

    const result: RouterOutput = runRouter(input);

    if (!result.quote) {
      return reply.status(400).send({
        error: 'No viable route found',
        reason: result.rejectionReason,
        candidatesEvaluated: result.allCandidates.length,
      });
    }

    return {
      quote: result.quote,
      alternativeRoutes: result.allScored.slice(1, 4).map((sr) => ({
        mode: sr.candidate.mode,
        outputAmount: sr.candidate.totalOutputAmount,
        fees: sr.candidate.totalFees,
        score: sr.scores.compositeScore,
      })),
      routingInfo: {
        candidatesDiscovered: result.allCandidates.length,
        candidatesScored: result.allScored.length,
        candidatesFiltered: result.filtered.length,
        selectedMode: result.selected?.candidate.mode,
        compositeScore: result.selected?.scores.compositeScore,
      },
    };
  });

  // GET /quote — convenience GET endpoint
  app.get<{ Querystring: { pairId: string; side?: string; amount: string } }>(
    '/quote',
    async (req, reply) => {
      const body = {
        pairId: req.query.pairId,
        side: (req.query.side ?? 'SELL') as 'BUY' | 'SELL',
        amount: req.query.amount,
      };
      req.body = body;
      return app.inject({ method: 'POST', url: '/quote', payload: body }).then((r) => {
        reply.status(r.statusCode).send(JSON.parse(r.body));
      });
    },
  );

  // GET /pairs — list available pairs
  app.get('/pairs', async () => ({
    pairs: Object.values(PAIRS).map((p) => ({
      pairId: p.pairId,
      baseSymbol: p.baseSymbol,
      quoteSymbol: p.quoteSymbol,
      primaryMode: p.primaryMode,
      status: p.status,
      riskTier: p.riskTier,
    })),
  }));

  // GET /health
  app.get('/health', async () => ({
    status: 'ok',
    pairsAvailable: Object.keys(PAIRS).length,
    marketDataUrl: MARKET_DATA_URL,
  }));

  const shutdown = async () => {
    await app.close();
    console.log('[quote-engine] Shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[quote-engine] Running on :${config.PORT}`);
}

function buildDefaultSnapshots(pair: Pair): VenueSnapshot[] {
  const now = Date.now();
  const snapshots: VenueSnapshot[] = [];

  // Always include a DCC AMM snapshot for the local leg
  snapshots.push({
    venueId: 'dcc-amm',
    venueType: 'DCC_AMM',
    pairId: pair.pairId,
    midPrice: '0.85', // DCC/USDC reference
    bestBid: '0.849',
    bestAsk: '0.851',
    bidDepth: '250000',
    askDepth: '250000',
    spread: '0.002',
    lastTradePrice: '0.85',
    volume24h: '150000',
    freshness: 0.95,
    isStale: false,
    fetchedAt: now,
  });

  for (const src of pair.externalSources) {
    if (!src.enabled) continue;

    const prices: Record<string, string> = {
      'USDC/SOL': '0.007380', // 1/135.5
      'USDC/ETH': '0.000377', // 1/2650
    };

    const midPrice = prices[src.venuePairId] ?? '1.0';
    snapshots.push({
      venueId: src.venueId,
      venueType: src.venueId === 'jupiter' ? 'JUPITER' : src.venueId === 'raydium' ? 'RAYDIUM' : 'UNISWAP',
      pairId: pair.pairId,
      midPrice,
      bestBid: midPrice,
      bestAsk: midPrice,
      bidDepth: '1000000',
      askDepth: '1000000',
      spread: '0.0001',
      lastTradePrice: midPrice,
      volume24h: '5000000',
      freshness: 0.92,
      isStale: false,
      fetchedAt: now,
    });
  }

  return snapshots;
}

main().catch((err) => {
  console.error('[quote-engine] Fatal error:', err);
  process.exit(1);
});
