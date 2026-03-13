import { z } from 'zod';
import { DecimalString, TimestampMs } from './common.js';

// ============================================================================
// Inventory Domain
// ============================================================================

/**
 * InventoryHealth — RAG status for inventory position.
 */
export const InventoryHealth = z.enum(['HEALTHY', 'LOW', 'CRITICAL']);
export type InventoryHealth = z.infer<typeof InventoryHealth>;

/**
 * InventoryPosition — a single asset balance on a specific chain.
 */
export const InventoryPosition = z.object({
  assetId: z.string(),
  chain: z.string(),
  balance: DecimalString,
  reservedForExecutions: DecimalString,
  available: DecimalString,
  targetBalance: DecimalString,
  health: InventoryHealth,
  lastUpdated: TimestampMs,
});
export type InventoryPosition = z.infer<typeof InventoryPosition>;

/**
 * RebalanceProposal — a proposed movement of inventory between chains.
 */
export const RebalanceProposal = z.object({
  proposalId: z.string(),
  assetId: z.string(),
  fromChain: z.string(),
  toChain: z.string(),
  amount: DecimalString,
  reason: z.string(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  requiresApproval: z.boolean(),
  approved: z.boolean().default(false),
  executedAt: TimestampMs.nullable().default(null),
  createdAt: TimestampMs,
});
export type RebalanceProposal = z.infer<typeof RebalanceProposal>;
