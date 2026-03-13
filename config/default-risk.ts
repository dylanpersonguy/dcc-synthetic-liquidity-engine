// ============================================================================
// Default Risk Configuration — Protocol Launch Parameters
// ============================================================================

import type { ProtocolRiskConfig } from '@dcc/types';

export const DEFAULT_RISK_CONFIG: Omit<ProtocolRiskConfig, 'updatedAt'> = {
  maxTotalRelayerNotional: '500000',     // $500k total relayer exposure
  maxTotalSyntheticNotional: '1000000',  // $1M total synthetic exposure
  maxRedemptionBacklog: 100,
  globalStaleQuoteThresholdMs: 30_000,   // 30s

  emergencyPause: false,
  globalCircuitBreaker: 'NONE',

  allowedRelayers: ['protocol-relayer-v1'],
  maxRelayerExposure: '100000',          // $100k per relayer

  defaultEscrowTimeoutMs: 300_000,       // 5 minutes
  maxEscrowTimeoutMs: 900_000,           // 15 minutes

  routeScoreWeights: {
    output: 0.35,      // output amount is most important
    fee: 0.15,         // fee minimization
    slippage: 0.15,    // slippage control
    freshness: 0.15,   // data freshness
    settlement: 0.20,  // settlement certainty (safety)
  },

  marketOverrides: {},
};
