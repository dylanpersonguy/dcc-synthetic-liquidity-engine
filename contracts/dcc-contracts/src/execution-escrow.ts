// ============================================================================
// ExecutionEscrow — On-Chain Contract Interface (V2 — Full State Machine)
// ============================================================================
//
// Holds user funds during cross-chain / relayer-backed route execution.
// Provides safety guarantees: timeout-based refunds, replay protection,
// and finalization only upon valid relayer attestation.
//
// Companion to: contracts/dcc-contracts/ride/ExecutionEscrow.ride
//
// ============================================================================
// EXECUTION STATE MACHINE
// ============================================================================
//
//   created ───► funds_locked ───► route_locked ─────┐
//                                                     │
//                    ┌────────────────────────────────┤
//                    │                                 │
//                    ▼                                 ▼
//            local_leg_executed              external_leg_pending
//                    │                                 │
//                    ├──► delivery_pending ◄── external_leg_confirmed
//                    │           │                      │
//                    │           ▼                      ▼
//                    │      completed          partially_completed
//                    │
//                    └──► external_leg_pending
//
//   Any non-terminal ──► failed ──► refunded
//   Any non-terminal ──► expired ──► refunded
//   partially_completed ──► refunded (remaining input)
//
// ============================================================================
// TERMINAL STATES: completed, refunded
// REFUNDABLE STATES: failed, expired, partially_completed
// ============================================================================
//
// STATE KEYS (on-chain)
// ============================================================================
//
// execution:{executionId}:user           -> address
// execution:{executionId}:pair           -> PairId
// execution:{executionId}:amountIn       -> u128
// execution:{executionId}:amountOutExpected -> u128
// execution:{executionId}:minAmountOut   -> u128
// execution:{executionId}:status         -> EscrowExecutionStatus (int)
// execution:{executionId}:routeHash      -> hash of RoutePlan
// execution:{executionId}:expiresAt      -> u64
// execution:{executionId}:relayer        -> RelayerId
// execution:{executionId}:assetIn        -> AssetId
// execution:{executionId}:assetOut       -> AssetId
// execution:{executionId}:createdAt      -> u64
// execution:{executionId}:nonce          -> u64
// execution:{executionId}:mode           -> ExecutionMode (int)
// execution:{executionId}:actualAmountOut -> u128 | null
// execution:{executionId}:refundAmount   -> u128 | null
// execution:{executionId}:settledAt      -> u64 | null
// execution:{executionId}:proofData      -> string | null
//
// user:{address}:nonce                   -> u64 (monotonic, prevents replay)
//
// global:executionCount                  -> u64
// global:activeExecutions                -> u64
// global:failedExecutions                -> u64
// global:completedExecutions             -> u64
// global:refundedExecutions              -> u64
// global:paused                          -> bool
//
// relayer:{relayerId}:allowed            -> bool
// role:settlement:{address}              -> bool
// role:operator:{address}                -> bool
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// PUBLIC:
//   - createExecutionIntent (user deposits funds)
//   - refundExecution (user or operator, after fail/expire)
//   - expireExecution (anyone, after timeout)
//   - getExecutionStatus, getUserNonce (reads)
//
// RELAYER_ROLE:
//   - confirmExternalExecution (assigned relayer only)
//   - partialFill (assigned relayer or SETTLEMENT_ROLE)
//
// SETTLEMENT_ROLE:
//   - lockRoute, markLocalExecution, markExternalPending
//   - markDeliveryPending, completeExecution, failExecution
//
// OPERATOR_ROLE:
//   - forceRefund (emergency)
//   - setRelayerAllowed
//   - pause / unpause
//
// CONTRACT OWNER:
//   - grantSettlementRole / revokeSettlementRole
//   - grantOperatorRole / revokeOperatorRole
//
// ============================================================================
// EVENTS (emitted via transaction metadata)
// ============================================================================
//
// ExecutionCreated(executionId, user, inputAsset, amountIn, expiresAt)
// ExecutionRouteLocked(executionId, routeHash)
// ExecutionLocalLegExecuted(executionId, localAmountOut)
// ExecutionExternalPending(executionId)
// ExecutionExternalConfirmed(executionId, relayerId, actualAmountOut, proofData)
// ExecutionDeliveryPending(executionId)
// ExecutionCompleted(executionId, outputAmount, settledAt)
// ExecutionPartialFill(executionId, partialAmountOut, refundAmount)
// ExecutionFailed(executionId, reason)
// ExecutionRefunded(executionId, refundAmount)
// ExecutionExpired(executionId)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. Each executionId is used EXACTLY ONCE (replay protection via user nonce).
// 2. Funds can only leave escrow via completeExecution OR refundExecution.
//    NEVER both — mutual exclusion enforced by state machine.
// 3. completeExecution requires delivery_pending status.
// 4. refundExecution requires failed, expired, or partially_completed status.
// 5. User nonce is strictly monotonic: each deposit increments by 1.
// 6. expireExecution can be called by anyone after expiresAt.
// 7. confirmExternalExecution validates: relayer identity, not expired,
//    amount ≥ minAmountOut, execution in external_leg_pending state.
// 8. partialFill proportionally computes refund from unfilled portion.
// 9. No state can be skipped — all transitions are explicit and validated.
//
// ============================================================================
// PAUSE BEHAVIOR
// ============================================================================
//
// When paused:
//   - createExecutionIntent: REJECTED
//   - refundExecution: ALLOWED (safety valve)
//   - expireExecution: ALLOWED (safety valve)
//   - completeExecution: ALLOWED (complete in-flight routes)
//   - confirmExternalExecution: ALLOWED (in-flight)
//   - forceRefund: ALLOWED (emergency)
//   - All other state transitions: ALLOWED for in-flight executions
//
// ============================================================================

import type { FillAttestation } from '@dcc/types';

// ============================================================================
// ENUMS & TYPES
// ============================================================================

export type EscrowExecutionStatus =
  | 'created'
  | 'funds_locked'
  | 'route_locked'
  | 'local_leg_executed'
  | 'external_leg_pending'
  | 'external_leg_confirmed'
  | 'delivery_pending'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'refunded'
  | 'expired';

export type ExecutionMode = 'LOCAL' | 'TELEPORT' | 'SYNTHETIC' | 'REDEEMABLE';

/** V1 EscrowStatus kept for backward compatibility */
export type EscrowStatus = 'PENDING' | 'ACCEPTED' | 'FILLED' | 'FAILED' | 'REFUNDED' | 'EXPIRED';

export interface EscrowEntry {
  executionId: string;
  userAddress: string;
  pairId: string;
  inputAsset: string;
  inputAmount: string;
  outputAsset: string;
  expectedAmountOut: string;
  minAmountOut: string;
  status: EscrowExecutionStatus;
  routeHash: string;
  executionMode: ExecutionMode;
  relayerId: string | null;
  nonce: number;
  createdAt: number;
  expiresAt: number;
  settledAt: number | null;
  actualAmountOut: string | null;
  refundAmount: string | null;
  proofData: string | null;
}

export interface EscrowGlobalStats {
  executionCount: number;
  activeExecutions: number;
  failedExecutions: number;
  completedExecutions: number;
  refundedExecutions: number;
}

// ============================================================================
// VALID STATE TRANSITIONS
// ============================================================================

export const ESCROW_VALID_TRANSITIONS: Record<EscrowExecutionStatus, EscrowExecutionStatus[]> = {
  created:                  ['funds_locked'],
  funds_locked:             ['route_locked', 'failed', 'expired'],
  route_locked:             ['local_leg_executed', 'external_leg_pending', 'failed', 'expired'],
  local_leg_executed:       ['external_leg_pending', 'delivery_pending', 'failed', 'expired'],
  external_leg_pending:     ['external_leg_confirmed', 'partially_completed', 'failed', 'expired'],
  external_leg_confirmed:   ['delivery_pending', 'failed', 'expired'],
  delivery_pending:         ['completed', 'failed', 'expired'],
  completed:                [],
  partially_completed:      ['refunded'],
  failed:                   ['refunded'],
  refunded:                 [],
  expired:                  ['refunded'],
};

export const ESCROW_TERMINAL_STATES: ReadonlySet<EscrowExecutionStatus> = new Set([
  'completed',
  'refunded',
]);

export const ESCROW_REFUNDABLE_STATES: ReadonlySet<EscrowExecutionStatus> = new Set([
  'failed',
  'expired',
  'partially_completed',
]);

// ============================================================================
// CONTRACT INTERFACE
// ============================================================================

export interface IExecutionEscrow {
  // ── User Methods ───────────────────────────────────────────────────────

  /**
   * Create an escrow entry and deposit funds.
   * Nonce must equal user's current nonce + 1.
   * Transitions: (none) → funds_locked
   * @access PUBLIC (user's own funds)
   */
  createExecutionIntent(params: {
    executionId: string;
    pairId: string;
    inputAsset: string;
    outputAsset: string;
    amountIn: string;
    expectedAmountOut: string;
    minAmountOut: string;
    routePlanHash: string;
    executionMode: ExecutionMode;
    relayerId: string;
    expiresAt: number;
    nonce: number;
  }): Promise<{ txId: string }>;

  /**
   * Claim a refund after escrow has been marked failed, expired, or partially completed.
   * For partial fills, refunds the unfilled portion of input.
   * Transitions: failed | expired | partially_completed → refunded
   * @access PUBLIC (original depositor or OPERATOR_ROLE)
   */
  refundExecution(executionId: string): Promise<{ txId: string; refundAmount: string }>;

  /**
   * Mark an execution as expired. Anyone can call after timeout.
   * Transitions: any non-terminal → expired
   * @access PUBLIC (anyone, after expiresAt)
   */
  expireExecution(executionId: string): Promise<{ txId: string }>;

  // ── Settlement Methods ─────────────────────────────────────────────────

  /**
   * Lock the route after router confirmation. Validates route hash.
   * Transitions: funds_locked → route_locked
   * @access SETTLEMENT_ROLE
   */
  lockRoute(executionId: string, routeHash: string): Promise<{ txId: string }>;

  /**
   * Mark local DCC swap as executed.
   * Transitions: route_locked → local_leg_executed
   * @access SETTLEMENT_ROLE
   */
  markLocalExecution(executionId: string, localAmountOut: string): Promise<{ txId: string }>;

  /**
   * Mark execution as awaiting external leg.
   * Transitions: route_locked | local_leg_executed → external_leg_pending
   * @access SETTLEMENT_ROLE
   */
  markExternalPending(executionId: string): Promise<{ txId: string }>;

  /**
   * Mark execution as awaiting delivery.
   * Transitions: external_leg_confirmed | local_leg_executed → delivery_pending
   * @access SETTLEMENT_ROLE
   */
  markDeliveryPending(executionId: string): Promise<{ txId: string }>;

  /**
   * Complete execution — final delivery of output to user.
   * This is the ONLY path funds leave escrow as settlement.
   * Transitions: delivery_pending → completed
   * @access SETTLEMENT_ROLE
   */
  completeExecution(executionId: string, outputAmount: string): Promise<{ txId: string }>;

  /**
   * Mark execution as failed. Enables refund.
   * Transitions: any non-terminal → failed
   * @access SETTLEMENT_ROLE
   */
  failExecution(executionId: string, reason: string): Promise<{ txId: string }>;

  // ── Relayer Methods ────────────────────────────────────────────────────

  /**
   * Confirm external execution with proof data.
   * Validates: relayer identity, amount ≥ minimum, not expired.
   * Transitions: external_leg_pending → external_leg_confirmed
   * @access RELAYER_ROLE (assigned relayer only)
   */
  confirmExternalExecution(params: {
    executionId: string;
    actualAmountOut: string;
    proofData: string;
  }): Promise<{ txId: string }>;

  /**
   * Submit fill attestation (legacy V1 compatibility).
   * @access RELAYER_ROLE (assigned relayer only)
   */
  submitFillAttestation(attestation: FillAttestation): Promise<{ txId: string }>;

  /**
   * Report partial fill. Delivers partial output, computes refund.
   * Transitions: external_leg_pending | external_leg_confirmed → partially_completed
   * @access RELAYER_ROLE or SETTLEMENT_ROLE
   */
  partialFill(params: {
    executionId: string;
    partialAmountOut: string;
    proofData: string;
  }): Promise<{ txId: string }>;

  // ── Operator Methods ───────────────────────────────────────────────────

  /**
   * Force a refund for a failed/expired/partially-filled escrow.
   * @access OPERATOR_ROLE
   */
  forceRefund(executionId: string): Promise<{ txId: string; refundAmount: string }>;

  /** Pause the escrow (blocks new deposits). @access OPERATOR_ROLE */
  pause(): Promise<{ txId: string }>;

  /** Unpause the escrow. @access OPERATOR_ROLE */
  unpause(): Promise<{ txId: string }>;

  /** Set relayer allowlist entry. @access OPERATOR_ROLE */
  setRelayerAllowed(relayerId: string, allowed: boolean): Promise<{ txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  getEscrow(executionId: string): Promise<EscrowEntry | null>;
  getUserNonce(userAddress: string): Promise<number>;
  getActiveEscrowsByUser(userAddress: string): Promise<EscrowEntry[]>;
  getEscrowsByStatus(status: EscrowExecutionStatus): Promise<EscrowEntry[]>;
  getGlobalStats(): Promise<EscrowGlobalStats>;
  isPaused(): Promise<boolean>;
}
