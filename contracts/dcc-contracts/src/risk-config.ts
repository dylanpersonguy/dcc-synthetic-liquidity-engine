// ============================================================================
// RiskConfig — On-Chain Contract Interface
// ============================================================================
//
// Protocol-wide and per-market risk parameters, enforced on-chain where
// possible and mirrored to off-chain services.
//
// PHASE: 0 (Foundation)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// risk:global:maxRelayerNotional       -> u128
// risk:global:maxSyntheticNotional     -> u128
// risk:global:staleQuoteThresholdMs    -> u64
// risk:global:defaultEscrowTimeoutMs   -> u64
// risk:global:maxEscrowTimeoutMs       -> u64
// risk:global:emergencyPause           -> bool
// risk:global:circuitBreaker           -> CircuitBreakerLevel
//
// risk:market:{pairId}:maxTradeSize    -> u128
// risk:market:{pairId}:maxDailyVolume  -> u128
// risk:market:{pairId}:maxOpenExec     -> u32
// risk:market:{pairId}:staleThreshMs   -> u64
// risk:market:{pairId}:maxSlippageBps  -> u32
// risk:market:{pairId}:circuitBreaker  -> CircuitBreakerLevel
//
// risk:relayer:{relayerId}:allowed     -> bool
// risk:relayer:{relayerId}:maxExposure -> u128
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// RISK_ADMIN_ROLE:
//   - setGlobalConfig, setMarketConfig, setRelayerConfig
//   - Held by risk-management multisig (separate from protocol admin)
//
// OPERATOR_ROLE:
//   - triggerEmergencyPause, setCircuitBreaker (to higher level only)
//
// ============================================================================
// EVENTS
// ============================================================================
//
// GlobalConfigUpdated(field, oldValue, newValue, actor)
// MarketConfigUpdated(pairId, field, oldValue, newValue, actor)
// RelayerConfigUpdated(relayerId, field, oldValue, newValue, actor)
// EmergencyPauseTriggered(actor)
// EmergencyPauseLifted(actor)
// CircuitBreakerTripped(scope, level, reason)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. emergencyPause == true overrides ALL market operations.
// 2. Per-market limits override global only if MORE restrictive.
// 3. Circuit breaker can only be escalated by OPERATOR; de-escalation
//    requires RISK_ADMIN.
// 4. staleQuoteThreshold must be ≥ 1000ms (safety floor).
// 5. maxEscrowTimeout must be ≥ defaultEscrowTimeout.
//
// ============================================================================

import type { CircuitBreakerLevel, MarketRiskConfig, ProtocolRiskConfig } from '@dcc/types';

export interface IRiskConfig {
  // ── Admin Methods ──────────────────────────────────────────────────────

  /** Set global protocol risk parameters. @access RISK_ADMIN_ROLE */
  setGlobalConfig(params: {
    maxTotalRelayerNotional?: string;
    maxTotalSyntheticNotional?: string;
    globalStaleQuoteThresholdMs?: number;
    defaultEscrowTimeoutMs?: number;
    maxEscrowTimeoutMs?: number;
    routeScoreWeights?: {
      output: number;
      fee: number;
      slippage: number;
      freshness: number;
      settlement: number;
    };
  }): Promise<{ txId: string }>;

  /** Set per-market risk parameters. @access RISK_ADMIN_ROLE */
  setMarketConfig(pairId: string, params: {
    maxTradeSize?: string;
    maxDailyVolume?: string;
    maxOpenExecutions?: number;
    staleQuoteThresholdMs?: number;
    maxSlippageBps?: number;
  }): Promise<{ txId: string }>;

  /** Add or update relayer allowlist entry. @access RISK_ADMIN_ROLE */
  setRelayerConfig(relayerId: string, params: {
    allowed: boolean;
    maxExposure: string;
  }): Promise<{ txId: string }>;

  // ── Operator Methods ───────────────────────────────────────────────────

  /** Trigger emergency pause. @access OPERATOR_ROLE */
  triggerEmergencyPause(): Promise<{ txId: string }>;

  /** Lift emergency pause. @access RISK_ADMIN_ROLE */
  liftEmergencyPause(): Promise<{ txId: string }>;

  /** Set circuit breaker level. @access OPERATOR_ROLE (escalate) / RISK_ADMIN (de-escalate) */
  setCircuitBreaker(scope: { global: true } | { pairId: string }, level: CircuitBreakerLevel): Promise<{ txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  /** Get full protocol risk config. */
  getGlobalConfig(): Promise<ProtocolRiskConfig>;

  /** Get per-market risk config. Falls back to global defaults if not overridden. */
  getMarketConfig(pairId: string): Promise<MarketRiskConfig>;

  /** Check if a relayer is allowed and get its limits. */
  getRelayerConfig(relayerId: string): Promise<{ allowed: boolean; maxExposure: string }>;

  /** Check if emergency pause is active. */
  isEmergencyPaused(): Promise<boolean>;
}
