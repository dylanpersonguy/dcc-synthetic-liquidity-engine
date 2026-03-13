import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Relayer Domain
// ============================================================================

/**
 * RelayerStatus — operational state of a relayer.
 */
export const RelayerStatusEnum = z.enum([
  'ACTIVE',
  'DEGRADED',
  'PAUSED',
  'OFFLINE',
]);
export type RelayerStatusEnum = z.infer<typeof RelayerStatusEnum>;

/**
 * FillAttestation — proof from a relayer that an external leg was filled.
 *
 * INVARIANTS:
 *  - `txHash` is verifiable on `chain`.
 *  - `signature` is the relayer's signed attestation over the fill data.
 *  - Protocol validates this before finalizing escrow.
 */
export const FillAttestation = z.object({
  executionId: z.string(),
  legIndex: z.number().int(),
  relayerId: z.string(),
  chain: z.string(),
  txHash: z.string(),
  amountDelivered: DecimalString,
  recipientAddress: z.string(),
  timestamp: TimestampMs,
  signature: z.string(),
});
export type FillAttestation = z.infer<typeof FillAttestation>;

/**
 * RelayerState — full state snapshot of a relayer.
 */
export const RelayerState = z.object({
  relayerId: z.string(),
  status: RelayerStatusEnum,
  supportedChains: z.array(z.string()),
  totalNotionalExposure: DecimalString,
  maxNotionalExposure: DecimalString,
  activeExecutions: z.number().int(),
  completedExecutions24h: z.number().int(),
  failedExecutions24h: z.number().int(),
  averageSettlementMs: z.number().int(),
  inventoryBalances: z.record(z.string(), DecimalString), // chain -> balance
  lastHeartbeat: TimestampMs,
});
export type RelayerState = z.infer<typeof RelayerState>;
