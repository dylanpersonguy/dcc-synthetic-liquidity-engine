import { z } from 'zod';
import { RedemptionRequest, RedemptionStatus, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Redemption API — POST /redeem, GET /redeem/:id
// ============================================================================

// ── POST /redeem ─────────────────────────────────────────────────────────
// Request redemption of a redeemable synthetic asset.
// Auth: USER (DCC signature; must hold the synthetic tokens)

export const CreateRedemptionRequest = z.object({
  syntheticAssetId: z.string().min(1),
  amount: DecimalString,
  destinationAddress: z.string().min(1),
  destinationChain: z.string().min(1),
  userAddress: z.string().min(1),
  signature: z.string().min(1),
});
export type CreateRedemptionRequest = z.infer<typeof CreateRedemptionRequest>;

export const CreateRedemptionResponse = z.object({
  redemptionId: z.string(),
  status: RedemptionStatus,
  expectedDeliveryMs: z.number().int().optional(),
  burnTxId: z.string(),
});
export type CreateRedemptionResponse = z.infer<typeof CreateRedemptionResponse>;

// Error cases:
// 400 — invalid request
// 403 — signature verification failed
// 404 — synthetic asset not found or not redeemable
// 422 — insufficient balance, redemption paused, backlog full
// 500 — burn transaction failed

// ── GET /redeem/:id ──────────────────────────────────────────────────────
// Check redemption status.
// Auth: PUBLIC (redemption ID is unguessable)

export const GetRedemptionParams = z.object({
  id: z.string().min(1),
});

export const GetRedemptionResponse = RedemptionRequest;
export type GetRedemptionResponse = z.infer<typeof GetRedemptionResponse>;

// Error cases:
// 404 — redemption not found
// 500 — internal error
