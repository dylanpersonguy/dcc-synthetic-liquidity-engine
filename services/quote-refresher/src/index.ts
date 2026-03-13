// ============================================================================
// quote-refresher — Pre-Execution Quote Refresh & Validation
// ============================================================================
//
// Before the execution-worker submits a trade to a venue, it calls the
// quote-refresher to get a fresh quote and validate that conditions haven't
// degraded since the original quote was created.
//
// Validates:
//   - Quote freshness (max age configurable, default 30s)
//   - Slippage vs original quote (reject if worse by >50bps beyond tolerance)
//   - Minimum amount out still meets user's minAmountOut
//   - Venue is still available / responding
//
// Port: 3205
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, QuoteRefresherConfig } from '@dcc/config';
import {
  createLogger,
  registry,
  staleQuoteRejections,
} from '@dcc/metrics';
import {
  VenueRegistry,
  JupiterAdapter,
  UniswapAdapter,
  RaydiumAdapter,
} from '@dcc/connectors';

const log = createLogger('quote-refresher');

const MAX_QUOTE_AGE_MS = 30_000; // 30 seconds
const MAX_SLIPPAGE_DEGRADATION_BPS = 50; // reject if fresh quote is >50bps worse

async function main() {
  const config = parseConfig(QuoteRefresherConfig);

  // ── Venue registry ──────────────────────────────────────────────────
  const venueRegistry = new VenueRegistry();
  venueRegistry.register(
    new JupiterAdapter({ baseUrl: config.JUPITER_API_URL }),
  );
  venueRegistry.register(
    new UniswapAdapter({ baseUrl: config.UNISWAP_API_URL }),
  );
  venueRegistry.register(
    new RaydiumAdapter({ baseUrl: config.RAYDIUM_API_URL }),
  );

  const app = Fastify();

  // ── POST /quote/refresh — get fresh quote from venue ────────────────
  const RefreshSchema = z.object({
    venueId: z.string(),
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    originalQuote: z.object({
      price: z.string(),
      amountOut: z.string(),
      quotedAt: z.number(),
    }).optional(),
  });

  app.post('/quote/refresh', async (req, reply) => {
    const body = RefreshSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const { venueId, tokenIn, tokenOut, amountIn, originalQuote } = body.data;

    const adapter = venueRegistry.get(venueId);
    if (!adapter) {
      void reply.status(404);
      return { error: `Venue ${venueId} not found in registry` };
    }

    try {
      const quote = await adapter.getQuote({ tokenIn, tokenOut, amountIn });
      if (!quote) {
        staleQuoteRejections.inc({ venue_id: venueId });
        void reply.status(502);
        return { error: 'Venue returned no quote', venueId };
      }

      // Check freshness if original quote provided
      if (originalQuote) {
        const ageMs = Date.now() - originalQuote.quotedAt;
        if (ageMs > MAX_QUOTE_AGE_MS) {
          log.warn('Original quote is stale', { venueId, ageMs });
        }
      }

      return {
        venueId,
        tokenIn,
        tokenOut,
        amountIn,
        freshQuote: {
          price: quote.price,
          amountOut: quote.amountOut,
          quotedAt: Date.now(),
          slippageBps: quote.slippageEstimateBps,
          confidence: quote.confidence,
        },
        originalQuote: originalQuote ?? null,
      };
    } catch (err) {
      staleQuoteRejections.inc({ venue_id: venueId });
      log.error('Quote refresh failed', {
        venueId,
        error: err instanceof Error ? err.message : String(err),
      });
      void reply.status(502);
      return { error: 'Quote refresh failed', venueId };
    }
  });

  // ── POST /quote/validate — validate fresh quote vs original ─────────
  const ValidateSchema = z.object({
    venueId: z.string(),
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    minAmountOut: z.string(),
    maxSlippageBps: z.number(),
    originalQuote: z.object({
      price: z.string(),
      amountOut: z.string(),
      quotedAt: z.number(),
    }),
  });

  app.post('/quote/validate', async (req, reply) => {
    const body = ValidateSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const { venueId, tokenIn, tokenOut, amountIn, minAmountOut, maxSlippageBps, originalQuote } = body.data;

    // Check original quote freshness
    const ageMs = Date.now() - originalQuote.quotedAt;
    if (ageMs > MAX_QUOTE_AGE_MS) {
      staleQuoteRejections.inc({ venue_id: venueId });
      log.warn('Quote validation failed: stale', { venueId, ageMs });
      void reply.status(422);
      return {
        valid: false,
        reason: 'stale_quote',
        ageMs,
        maxAgeMs: MAX_QUOTE_AGE_MS,
      };
    }

    // Get fresh quote
    const adapter = venueRegistry.get(venueId);
    if (!adapter) {
      void reply.status(404);
      return { valid: false, reason: `venue_not_found: ${venueId}` };
    }

    try {
      const freshQuote = await adapter.getQuote({ tokenIn, tokenOut, amountIn });
      if (!freshQuote) {
        staleQuoteRejections.inc({ venue_id: venueId });
        return { valid: false, reason: 'venue_returned_no_quote' };
      }

      // Check if fresh quote still meets minAmountOut
      const freshAmountOut = parseFloat(freshQuote.amountOut);
      const requiredMin = parseFloat(minAmountOut);
      if (freshAmountOut < requiredMin) {
        log.warn('Fresh quote below minAmountOut', {
          venueId,
          freshAmountOut: freshQuote.amountOut,
          minAmountOut,
        });
        return {
          valid: false,
          reason: 'below_min_amount_out',
          freshAmountOut: freshQuote.amountOut,
          minAmountOut,
        };
      }

      // Check slippage degradation vs original
      const originalAmountOut = parseFloat(originalQuote.amountOut);
      if (originalAmountOut > 0) {
        const degradationBps = Math.round(
          ((originalAmountOut - freshAmountOut) / originalAmountOut) * 10_000,
        );

        if (degradationBps > MAX_SLIPPAGE_DEGRADATION_BPS) {
          log.warn('Quote degraded beyond tolerance', {
            venueId,
            degradationBps,
            maxDegradationBps: MAX_SLIPPAGE_DEGRADATION_BPS,
          });
          return {
            valid: false,
            reason: 'slippage_degradation',
            degradationBps,
            maxDegradationBps: MAX_SLIPPAGE_DEGRADATION_BPS,
          };
        }
      }

      // Check absolute slippage
      if (freshQuote.slippageEstimateBps > maxSlippageBps) {
        return {
          valid: false,
          reason: 'absolute_slippage_exceeded',
          freshSlippageBps: freshQuote.slippageEstimateBps,
          maxSlippageBps,
        };
      }

      return {
        valid: true,
        freshQuote: {
          price: freshQuote.price,
          amountOut: freshQuote.amountOut,
          quotedAt: Date.now(),
          slippageBps: freshQuote.slippageEstimateBps,
          confidence: freshQuote.confidence,
        },
      };
    } catch (err) {
      staleQuoteRejections.inc({ venue_id: venueId });
      log.error('Quote validation error', {
        venueId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { valid: false, reason: 'validation_error' };
    }
  });

  // ── Health + Metrics ────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'quote-refresher',
    timestamp: Date.now(),
  }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Quote refresher started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down quote refresher...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
