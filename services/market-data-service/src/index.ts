// ============================================================================
// market-data-service — Market Data Ingestion, Normalization & Serve
// ============================================================================
//
// Polls all venue adapters, normalizes into VenueSnapshot objects, caches
// in-memory (Redis in production), and serves REST endpoints.
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, MarketDataServiceConfig } from '@dcc/config';
import {
  VenueRegistry,
  JupiterAdapter,
  RaydiumAdapter,
  UniswapAdapter,
  DccAmmAdapter,
  DccOrderbookAdapter,
} from '@dcc/connectors';
import type { VenueQuote } from '@dcc/types';

// ── Types ────────────────────────────────────────────────────────────────

interface CachedSnapshot {
  venueId: string;
  venueType: string;
  pairId: string;
  midPrice: string | null;
  bestBid: string | null;
  bestAsk: string | null;
  bidDepth: string | null;
  askDepth: string | null;
  spread: string | null;
  lastTradePrice: string | null;
  volume24h: string | null;
  freshness: number;
  isStale: boolean;
  fetchedAt: number;
}

interface PairDefinition {
  pairId: string;
  baseSymbol: string;
  quoteSymbol: string;
  venues: string[];
}

// ── Pair Configuration ──────────────────────────────────────────────────

const MONITORED_PAIRS: PairDefinition[] = [
  { pairId: 'DCC/USDC', baseSymbol: 'DCC', quoteSymbol: 'USDC', venues: ['dcc-amm'] },
  { pairId: 'USDC/SOL', baseSymbol: 'USDC', quoteSymbol: 'SOL', venues: ['jupiter', 'raydium'] },
  { pairId: 'DCC/SOL', baseSymbol: 'DCC', quoteSymbol: 'SOL', venues: ['dcc-amm', 'jupiter', 'raydium'] },
  { pairId: 'USDC/ETH', baseSymbol: 'USDC', quoteSymbol: 'ETH', venues: ['uniswap'] },
  { pairId: 'DCC/ETH', baseSymbol: 'DCC', quoteSymbol: 'ETH', venues: ['dcc-amm', 'uniswap'] },
];

// ── In-Memory Cache ─────────────────────────────────────────────────────

const snapshotCache = new Map<string, CachedSnapshot[]>();
const quoteCache = new Map<string, VenueQuote[]>();

function cacheKey(pairId: string): string {
  return pairId;
}

// ── Polling Logic ───────────────────────────────────────────────────────

async function pollVenueForPair(
  registry: VenueRegistry,
  pair: PairDefinition,
): Promise<void> {
  const snapshots: CachedSnapshot[] = [];
  const quotes: VenueQuote[] = [];

  for (const venueId of pair.venues) {
    const adapter = registry.get(venueId);
    if (!adapter) continue;

    try {
      const [midPrice, freshness, quote] = await Promise.all([
        adapter.getMidPrice({ tokenIn: pair.baseSymbol, tokenOut: pair.quoteSymbol }),
        adapter.getFreshness(),
        adapter.getQuote({ tokenIn: pair.baseSymbol, tokenOut: pair.quoteSymbol, amountIn: '1000' }),
      ]);

      const depthEstimate = await adapter.getDepthEstimate({
        tokenIn: pair.baseSymbol,
        tokenOut: pair.quoteSymbol,
        notional: '10000',
      });

      snapshots.push({
        venueId: adapter.venueId,
        venueType: adapter.venueType,
        pairId: pair.pairId,
        midPrice,
        bestBid: midPrice ? String(parseFloat(midPrice) * 0.999) : null,
        bestAsk: midPrice ? String(parseFloat(midPrice) * 1.001) : null,
        bidDepth: depthEstimate?.availableSize ?? null,
        askDepth: depthEstimate?.availableSize ?? null,
        spread: midPrice ? String(parseFloat(midPrice) * 0.002) : null,
        lastTradePrice: midPrice,
        volume24h: null,
        freshness: freshness.isStale ? 0.1 : 0.95,
        isStale: freshness.isStale,
        fetchedAt: Date.now(),
      });

      if (quote) {
        quotes.push(quote);
      }
    } catch (err) {
      console.error(`[market-data] Failed to poll ${venueId} for ${pair.pairId}:`, err);
    }
  }

  snapshotCache.set(cacheKey(pair.pairId), snapshots);
  if (quotes.length > 0) {
    quoteCache.set(cacheKey(pair.pairId), quotes);
  }
}

async function runPollingCycle(registry: VenueRegistry): Promise<void> {
  await Promise.all(MONITORED_PAIRS.map((pair) => pollVenueForPair(registry, pair)));
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(MarketDataServiceConfig);

  const registry = new VenueRegistry();
  registry.register(new DccAmmAdapter({ baseUrl: config.DCC_NODE_URL, paperMode: true } as any));
  registry.register(new DccOrderbookAdapter({ baseUrl: config.DCC_NODE_URL }));
  registry.register(new JupiterAdapter({
    baseUrl: config.JUPITER_API_URL,
    timeoutMs: config.JUPITER_TIMEOUT_MS,
    maxStalenessMs: config.JUPITER_MAX_STALENESS_MS,
    paperMode: true,
  } as any));
  registry.register(new RaydiumAdapter({
    baseUrl: config.RAYDIUM_API_URL,
    timeoutMs: config.RAYDIUM_TIMEOUT_MS,
    maxStalenessMs: config.RAYDIUM_MAX_STALENESS_MS,
    paperMode: true,
  } as any));
  registry.register(new UniswapAdapter({
    baseUrl: config.UNISWAP_API_URL,
    timeoutMs: config.UNISWAP_TIMEOUT_MS,
    maxStalenessMs: config.UNISWAP_MAX_STALENESS_MS,
    apiKey: config.UNISWAP_API_KEY,
  }));

  console.log(`[market-data-service] Registered ${registry.getAll().length} venue adapters`);

  // Initial poll
  await runPollingCycle(registry);
  console.log(`[market-data-service] Initial data loaded for ${MONITORED_PAIRS.length} pairs`);

  // Background polling every 5 seconds
  const pollInterval = setInterval(() => {
    runPollingCycle(registry).catch((err) => {
      console.error('[market-data-service] Polling error:', err);
    });
  }, 5000);

  // ── HTTP Server ─────────────────────────────────────────────────────

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // GET /markets — list all monitored pairs with latest snapshots
  app.get('/markets', async () => {
    const markets = MONITORED_PAIRS.map((pair) => {
      const snapshots = snapshotCache.get(cacheKey(pair.pairId)) ?? [];
      const bestSnapshot = snapshots.reduce<CachedSnapshot | null>((best, s) => {
        if (!best || s.freshness > best.freshness) return s;
        return best;
      }, null);

      return {
        pairId: pair.pairId,
        baseSymbol: pair.baseSymbol,
        quoteSymbol: pair.quoteSymbol,
        venues: pair.venues,
        midPrice: bestSnapshot?.midPrice ?? null,
        spread: bestSnapshot?.spread ?? null,
        freshness: bestSnapshot?.freshness ?? 0,
        isStale: bestSnapshot?.isStale ?? true,
        fetchedAt: bestSnapshot?.fetchedAt ?? 0,
        snapshotCount: snapshots.length,
      };
    });
    return { markets };
  });

  // GET /markets/:pair — detailed snapshots for a pair
  app.get<{ Params: { pair: string } }>('/markets/:pair', async (req, reply) => {
    const pairId = decodeURIComponent(req.params.pair);
    const snapshots = snapshotCache.get(cacheKey(pairId));
    if (!snapshots) {
      return reply.status(404).send({ error: `No data for pair: ${pairId}` });
    }
    const quotes = quoteCache.get(cacheKey(pairId)) ?? [];
    return { pairId, snapshots, quotes };
  });

  // GET /markets/:pair/depth — depth estimate for a pair
  app.get<{ Params: { pair: string }; Querystring: { notional?: string } }>(
    '/markets/:pair/depth',
    async (req, reply) => {
      const pairId = decodeURIComponent(req.params.pair);
      const notional = req.query.notional ?? '10000';
      const pair = MONITORED_PAIRS.find((p) => p.pairId === pairId);
      if (!pair) {
        return reply.status(404).send({ error: `Pair not found: ${pairId}` });
      }

      const depthResults = await Promise.all(
        pair.venues.map(async (venueId) => {
          const adapter = registry.get(venueId);
          if (!adapter) return null;
          const est = await adapter.getDepthEstimate({
            tokenIn: pair.baseSymbol,
            tokenOut: pair.quoteSymbol,
            notional,
          });
          return est ? { venueId, ...est } : null;
        }),
      );

      return {
        pairId,
        notional,
        depth: depthResults.filter(Boolean),
      };
    },
  );

  // GET /quotes/:pair — get cached quotes for a pair
  app.get<{ Params: { pair: string }; Querystring: { amountIn?: string } }>(
    '/quotes/:pair',
    async (req, reply) => {
      const pairId = decodeURIComponent(req.params.pair);
      const amountIn = req.query.amountIn ?? '1000';
      const pair = MONITORED_PAIRS.find((p) => p.pairId === pairId);
      if (!pair) {
        return reply.status(404).send({ error: `Pair not found: ${pairId}` });
      }

      const freshQuotes = await Promise.all(
        pair.venues.map(async (venueId) => {
          const adapter = registry.get(venueId);
          if (!adapter) return null;
          return adapter.getQuote({
            tokenIn: pair.baseSymbol,
            tokenOut: pair.quoteSymbol,
            amountIn,
          });
        }),
      );

      return {
        pairId,
        amountIn,
        quotes: freshQuotes.filter(Boolean),
      };
    },
  );

  // GET /health — service health
  app.get('/health', async () => ({
    status: 'ok',
    adapterCount: registry.getAll().length,
    pairsMonitored: MONITORED_PAIRS.length,
    cachedPairs: snapshotCache.size,
  }));

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    console.log('[market-data-service] Shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[market-data-service] Running on :${config.PORT}`);
}

main().catch((err) => {
  console.error('[market-data-service] Fatal error:', err);
  process.exit(1);
});
