import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Risk Configuration Domain
// ============================================================================

/**
 * CircuitBreakerLevel — protocol-wide or per-market halt severity.
 */
export const CircuitBreakerLevel = z.enum([
  'NONE',          // normal operation
  'SOFT_PAUSE',    // new quotes disabled; existing executions complete
  'HARD_PAUSE',    // all activity frozen; admin intervention required
]);
export type CircuitBreakerLevel = z.infer<typeof CircuitBreakerLevel>;

/**
 * MarketRiskConfig — per-pair risk limits.
 */
export const MarketRiskConfig = z.object({
  pairId: z.string(),
  maxTradeSize: DecimalString,
  maxDailyVolume: DecimalString,
  maxOpenExecutions: z.number().int(),
  staleQuoteThresholdMs: z.number().int(),
  maxSlippageBps: z.number().int(),
  circuitBreaker: CircuitBreakerLevel,
});
export type MarketRiskConfig = z.infer<typeof MarketRiskConfig>;

/**
 * ProtocolRiskConfig — global risk configuration.
 *
 * INVARIANTS:
 *  - All numeric limits > 0 when set.
 *  - `emergencyPause` overrides all per-market states.
 *  - `allowedRelayers` is the whitelist; empty = no relayer routes.
 */
export const ProtocolRiskConfig = z.object({
  // Global limits
  maxTotalRelayerNotional: DecimalString,
  maxTotalSyntheticNotional: DecimalString,
  maxRedemptionBacklog: z.number().int(),
  globalStaleQuoteThresholdMs: z.number().int(),

  // Circuit breakers
  emergencyPause: z.boolean().default(false),
  globalCircuitBreaker: CircuitBreakerLevel,

  // Relayer controls
  allowedRelayers: z.array(z.string()),
  maxRelayerExposure: DecimalString,

  // Settlement
  defaultEscrowTimeoutMs: z.number().int(),
  maxEscrowTimeoutMs: z.number().int(),

  // Scoring weights (must sum to 1.0)
  routeScoreWeights: z.object({
    output: z.number().min(0).max(1),
    fee: z.number().min(0).max(1),
    slippage: z.number().min(0).max(1),
    freshness: z.number().min(0).max(1),
    settlement: z.number().min(0).max(1),
  }),

  // Per-market overrides
  marketOverrides: z.record(z.string(), MarketRiskConfig).default({}),

  updatedAt: TimestampMs,
});
export type ProtocolRiskConfig = z.infer<typeof ProtocolRiskConfig>;

/**
 * RiskStatus — live risk monitoring snapshot.
 */
export const RiskStatus = z.object({
  globalCircuitBreaker: CircuitBreakerLevel,
  staleVenues: z.array(z.string()),
  relayerExposure: DecimalString,
  syntheticExposure: DecimalString,
  redemptionBacklog: z.number().int(),
  routeFailureRate24h: z.number(),
  inventoryHealth: z.record(z.string(), z.enum(['HEALTHY', 'LOW', 'CRITICAL'])),
  alertCount: z.number().int(),
  timestamp: TimestampMs,
});
export type RiskStatus = z.infer<typeof RiskStatus>;
