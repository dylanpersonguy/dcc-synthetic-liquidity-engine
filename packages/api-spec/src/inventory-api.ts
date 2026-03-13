import { z } from 'zod';
import { InventoryPosition, InventoryHealth, RebalanceProposal, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Inventory API — GET /inventory/status
// ============================================================================

// ── GET /inventory/status ────────────────────────────────────────────────
// Returns cross-chain inventory positions.
// Auth: OPERATOR (sensitive operational data)

export const GetInventoryStatusResponse = z.object({
  positions: z.array(InventoryPosition),
  pendingRebalances: z.array(RebalanceProposal),
  overallHealth: InventoryHealth,
  timestamp: TimestampMs,
});
export type GetInventoryStatusResponse = z.infer<typeof GetInventoryStatusResponse>;

// Error cases:
// 403 — not authorized
// 500 — internal error
