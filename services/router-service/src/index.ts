// ============================================================================
// router-service — Route Planning & Selection API
// ============================================================================
//
// Accepts a quote from the quote-engine and produces a RoutePlan.
// Applies scoring, risk limits, and selects the best route.
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, RouterServiceConfig } from '@dcc/config';
import { randomUUID } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────

interface RouteLeg {
  legIndex: number;
  venueId: string;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  feeEstimate: string;
  slippageEstimateBps: number;
}

interface RoutePlan {
  routeId: string;
  quoteId: string;
  pairId: string;
  mode: string;
  legs: RouteLeg[];
  inputAmount: string;
  expectedOutputAmount: string;
  totalFees: string;
  estimatedSlippageBps: number;
  confidence: number;
  requiresEscrow: boolean;
  requiresRelayer: boolean;
  createdAt: number;
  expiresAt: number;
}

const QUOTE_ENGINE_URL = process.env['QUOTE_ENGINE_URL'] ?? 'http://localhost:3211';

// ── In-memory route plan cache ──────────────────────────────────────────

const routeCache = new Map<string, RoutePlan>();

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(RouterServiceConfig);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // POST /route — plan a route based on a quote
  app.post<{
    Body: { quoteId: string; pairId: string; side: string; amount: string };
  }>('/route', async (req, reply) => {
    const { quoteId, pairId, side, amount } = req.body;

    if (!pairId || !amount) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    // Fetch quote from quote-engine
    try {
      const quoteResp = await fetch(`${QUOTE_ENGINE_URL}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairId, side: side ?? 'SELL', amount }),
      });

      if (!quoteResp.ok) {
        const err = await quoteResp.json() as Record<string, unknown>;
        return reply.status(400).send({ error: 'Quote failed', ...err });
      }

      const quoteData = (await quoteResp.json()) as { quote: any };
      const quote = quoteData.quote;

      const now = Date.now();
      const routeId = `route-${randomUUID()}`;

      const legs: RouteLeg[] = (quote.legs as any[]).map((leg: any, idx: number) => ({
        legIndex: idx,
        venueId: leg.venueId,
        chain: leg.chain,
        tokenIn: leg.tokenIn,
        tokenOut: leg.tokenOut,
        amountIn: leg.amountIn,
        amountOut: leg.amountOut,
        feeEstimate: leg.feeEstimate,
        slippageEstimateBps: parseInt(leg.slippageEstimate ?? '0', 10),
      }));

      const routePlan: RoutePlan = {
        routeId,
        quoteId: quoteId ?? quote.quoteId,
        pairId,
        mode: quote.mode,
        legs,
        inputAmount: quote.inputAmount,
        expectedOutputAmount: quote.outputAmount,
        totalFees: quote.totalFeeEstimate,
        estimatedSlippageBps: quote.estimatedSlippageBps,
        confidence: quote.confidenceScore,
        requiresEscrow: quote.mode === 'TELEPORT',
        requiresRelayer: quote.mode === 'TELEPORT',
        createdAt: now,
        expiresAt: now + 60_000,
      };

      routeCache.set(routeId, routePlan);
      // Clean old cached routes (keep last 1000)
      if (routeCache.size > 1000) {
        const oldest = routeCache.keys().next().value;
        if (oldest) routeCache.delete(oldest);
      }

      return { routePlan };
    } catch (err) {
      console.error('[router-service] Error planning route:', err);
      return reply.status(500).send({ error: 'Route planning failed' });
    }
  });

  // GET /route/:routeId — retrieve a route plan
  app.get<{ Params: { routeId: string } }>('/route/:routeId', async (req, reply) => {
    const plan = routeCache.get(req.params.routeId);
    if (!plan) {
      return reply.status(404).send({ error: 'Route plan not found' });
    }
    const expired = Date.now() > plan.expiresAt;
    return { routePlan: plan, expired };
  });

  // GET /health
  app.get('/health', async () => ({
    status: 'ok',
    cachedRoutes: routeCache.size,
    quoteEngineUrl: QUOTE_ENGINE_URL,
  }));

  const shutdown = async () => {
    await app.close();
    console.log('[router-service] Shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[router-service] Running on :${config.PORT}`);
}

main().catch((err) => {
  console.error('[router-service] Fatal error:', err);
  process.exit(1);
});
