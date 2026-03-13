import { z } from 'zod';
import { RoutePlan, DecimalString, TimestampMs } from '@dcc/types';

// ============================================================================
// Route API — POST /route/plan, POST /route/execute
// ============================================================================

// ── POST /route/plan ─────────────────────────────────────────────────────
// Given a quoteId, produce a concrete execution plan.
// Auth: USER (must be authenticated / signed)
//
// This is the step between "showing the user a quote" and "executing the trade."
// The route plan locks in the specific legs, settlement mode, and scoring.

export const CreateRoutePlanRequest = z.object({
  quoteId: z.string().min(1),
  userAddress: z.string().min(1),
  /** For cross-chain delivery: where should the output go? */
  destinationAddress: z.string().optional(),
  destinationChain: z.string().optional(),
  /** Maximum acceptable slippage in bps (overrides quote default) */
  maxSlippageBps: z.coerce.number().int().min(0).max(5000).optional(),
});
export type CreateRoutePlanRequest = z.infer<typeof CreateRoutePlanRequest>;

export const CreateRoutePlanResponse = z.object({
  routePlan: RoutePlan,
  /** Human-readable warnings (e.g. "synthetic, not redeemable yet") */
  warnings: z.array(z.string()),
});
export type CreateRoutePlanResponse = z.infer<typeof CreateRoutePlanResponse>;

// Error cases:
// 400 — invalid request
// 404 — quoteId not found or expired
// 409 — quote already used for another route plan
// 422 — risk check failed (amount exceeds limit, pair paused, etc.)
// 503 — venue data stale; cannot plan route

// ── POST /route/execute ──────────────────────────────────────────────────
// Submit a signed execution intent for a route plan.
// Auth: USER (DCC signature required)
//
// For local-only routes: executes immediately.
// For relayer routes: creates escrow entry, dispatches to relayer.

export const ExecuteRouteRequest = z.object({
  routeId: z.string().min(1),
  userAddress: z.string().min(1),
  /** User's DCC signature over the execution intent */
  signature: z.string().min(1),
  /** User's nonce (for replay protection) */
  nonce: z.number().int().min(0),
});
export type ExecuteRouteRequest = z.infer<typeof ExecuteRouteRequest>;

export const ExecuteRouteResponse = z.object({
  executionId: z.string(),
  status: z.string(),
  escrowTxId: z.string().nullable().default(null),
  estimatedSettlementMs: z.number().int().optional(),
});
export type ExecuteRouteResponse = z.infer<typeof ExecuteRouteResponse>;

// Error cases:
// 400 — invalid request or signature
// 404 — routeId not found or expired
// 409 — nonce already used (replay attempt)
// 422 — risk check failed, insufficient user balance, pair paused
// 500 — escrow creation failed
