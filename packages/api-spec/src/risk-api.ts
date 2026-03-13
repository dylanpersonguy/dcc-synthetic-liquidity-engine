import { z } from 'zod';
import { RiskStatus, CircuitBreakerLevel, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Risk API — GET /risk/status
// ============================================================================

// ── GET /risk/status ─────────────────────────────────────────────────────
// Returns live protocol risk snapshot.
// Auth: OPERATOR (or PUBLIC for a subset of non-sensitive fields)

export const GetRiskStatusResponse = RiskStatus;
export type GetRiskStatusResponse = z.infer<typeof GetRiskStatusResponse>;

// Error cases:
// 503 — risk monitoring service unavailable
// 500 — internal error

// ── GET /risk/market/:pairId ─────────────────────────────────────────────
// Returns risk status for a specific market.
// Auth: PUBLIC (used by frontend to show risk warnings)

export const GetMarketRiskParams = z.object({
  pairId: z.string().min(1),
});

export const GetMarketRiskResponse = z.object({
  pairId: z.string(),
  circuitBreaker: CircuitBreakerLevel,
  isStale: z.boolean(),
  maxTradeSize: DecimalString,
  currentDailyVolume: DecimalString,
  maxDailyVolume: DecimalString,
  utilizationPct: z.number().min(0).max(100),
  warnings: z.array(z.string()),
  timestamp: TimestampMs,
});
export type GetMarketRiskResponse = z.infer<typeof GetMarketRiskResponse>;

// Error cases:
// 404 — pair not found
// 500 — internal error
