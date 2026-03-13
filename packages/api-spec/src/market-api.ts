import { z } from 'zod';
import { Pair, MarketDepth, MarketMode, MarketStatus, RiskTier, DepthLevel, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Market API — GET /markets, GET /markets/:pairId, GET /markets/:pairId/depth
// ============================================================================

// ── GET /markets ─────────────────────────────────────────────────────────
// Lists all registered markets. Supports filtering.
// Auth: PUBLIC (no authentication required)
// Served by: router-service (or a dedicated gateway)

export const ListMarketsQuery = z.object({
  mode: MarketMode.optional(),
  status: MarketStatus.optional(),
  riskTier: RiskTier.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type ListMarketsQuery = z.infer<typeof ListMarketsQuery>;

export const ListMarketsResponse = z.object({
  markets: z.array(Pair),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});
export type ListMarketsResponse = z.infer<typeof ListMarketsResponse>;

// Error cases:
// 400 — invalid filter parameters
// 500 — internal service error

// ── GET /markets/:pairId ─────────────────────────────────────────────────
// Returns full metadata for a single pair.
// Auth: PUBLIC

export const GetMarketParams = z.object({
  pairId: z.string().min(1),
});

export const GetMarketResponse = Pair;
export type GetMarketResponse = z.infer<typeof GetMarketResponse>;

// Error cases:
// 404 — pair not found
// 500 — internal service error

// ── GET /markets/:pairId/depth ───────────────────────────────────────────
// Returns aggregated depth (bids/asks) from all venue sources.
// Auth: PUBLIC

export const GetMarketDepthParams = z.object({
  pairId: z.string().min(1),
});

export const GetMarketDepthQuery = z.object({
  levels: z.coerce.number().int().min(1).max(50).default(10),
});

export const GetMarketDepthResponse = MarketDepth;
export type GetMarketDepthResponse = z.infer<typeof GetMarketDepthResponse>;

// Error cases:
// 404 — pair not found
// 503 — no fresh venue data available
// 500 — internal service error
