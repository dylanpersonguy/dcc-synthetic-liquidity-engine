import { z } from 'zod';
import { Quote, QuoteRequest, QuoteMode, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Quote API — GET /quote
// ============================================================================
//
// Returns one or more ranked quotes for a trade.
// Auth: PUBLIC (rate-limited per IP / API key)
//
// The quote engine collects venue snapshots, evaluates all viable modes,
// and returns the best quotes with full transparency.

export const GetQuoteQuery = z.object({
  pairId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  amount: DecimalString,
  preferredMode: QuoteMode.optional(),
  maxSlippageBps: z.coerce.number().int().min(0).max(5000).optional(),
  /** Max number of quotes to return (ranked best to worst) */
  maxQuotes: z.coerce.number().int().min(1).max(5).default(3),
});
export type GetQuoteQuery = z.infer<typeof GetQuoteQuery>;

export const GetQuoteResponse = z.object({
  quotes: z.array(Quote),
  /** If no quotes available, this explains why */
  reason: z.string().nullable().default(null),
  /** Server timestamp for clock skew detection */
  serverTimestamp: TimestampMs,
});
export type GetQuoteResponse = z.infer<typeof GetQuoteResponse>;

// Error cases:
// 400 — invalid parameters (bad pair, invalid amount, etc.)
// 404 — pair not found or disabled
// 422 — amount exceeds max trade size for this pair
// 503 — all venue sources stale; unable to produce reliable quote
// 429 — rate limit exceeded
