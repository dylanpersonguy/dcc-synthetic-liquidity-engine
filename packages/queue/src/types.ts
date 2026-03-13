// ============================================================================
// @dcc/queue — Relayer Job Queue Types
// ============================================================================

/**
 * RelayerJobStatus — 17-state execution machine for relayer jobs.
 *
 * State machine:
 *   received → validated → inventory_reserved → quote_refreshed →
 *   ready_to_execute → submitting → submitted → awaiting_confirmation →
 *   filled → delivery_pending → completed → inventory_released → reconciled
 *
 * Error paths:
 *   received → rejected (invalid, expired, dedup)
 *   validated → rejected (risk check fail, inventory insufficient)
 *   inventory_reserved → failed (quote refresh failed)
 *   quote_refreshed → failed (slippage exceeded)
 *   submitting → failed (submission error)
 *   submitted → failed (on-chain failure)
 *   awaiting_confirmation → timed_out (confirmation timeout)
 *   awaiting_confirmation → partially_filled → filled | failed
 *   failed → inventory_released
 *   timed_out → inventory_released
 *
 * Terminal states: reconciled, rejected
 */
export type RelayerJobStatus =
  | 'received'
  | 'validated'
  | 'inventory_reserved'
  | 'quote_refreshed'
  | 'ready_to_execute'
  | 'submitting'
  | 'submitted'
  | 'awaiting_confirmation'
  | 'partially_filled'
  | 'filled'
  | 'delivery_pending'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'inventory_released'
  | 'reconciled'
  | 'rejected';

/** Valid state transitions — enforced by the state machine */
export const VALID_TRANSITIONS: Record<RelayerJobStatus, readonly RelayerJobStatus[]> = {
  received: ['validated', 'rejected'],
  validated: ['inventory_reserved', 'rejected'],
  inventory_reserved: ['quote_refreshed', 'failed'],
  quote_refreshed: ['ready_to_execute', 'failed'],
  ready_to_execute: ['submitting'],
  submitting: ['submitted', 'failed'],
  submitted: ['awaiting_confirmation', 'failed'],
  awaiting_confirmation: ['filled', 'partially_filled', 'timed_out'],
  partially_filled: ['filled', 'failed', 'timed_out'],
  filled: ['delivery_pending'],
  delivery_pending: ['completed', 'failed'],
  completed: ['inventory_released'],
  failed: ['inventory_released'],
  timed_out: ['inventory_released'],
  inventory_released: ['reconciled'],
  reconciled: [],
  rejected: [],
};

export const TERMINAL_STATES: ReadonlySet<RelayerJobStatus> = new Set([
  'reconciled',
  'rejected',
]);

export const FAILURE_STATES: ReadonlySet<RelayerJobStatus> = new Set([
  'failed',
  'timed_out',
  'rejected',
]);

/** A single leg in the route plan carried by the job */
export interface RelayerRouteLeg {
  legIndex: number;
  venueId: string;
  chain: string;
  settlementMode: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedAmountOut: string;
  minAmountOut: string;
  feeEstimate: string;
  requiresRelayer: boolean;
}

/**
 * RelayerJobPayload — the data enqueued for execution.
 *
 * This is the contract between the job producer (relayer-service intake)
 * and the consumer (execution-worker). Must be JSON-serializable.
 */
export interface RelayerJobPayload {
  jobId: string;
  executionId: string;
  routeId: string;
  quoteId: string;
  pairId: string;
  mode: string;
  inputAsset: string;
  outputAsset: string;
  amountIn: string;
  expectedAmountOut: string;
  minAmountOut: string;
  maxSlippageBps: number;
  expiresAt: number;
  legs: RelayerRouteLeg[];
  deliveryMode: string;
  riskTier: string;
  userAddress: string;
  destinationAddress: string;
  destinationChain: string;
  nonce: number;
  signature: string;
  /** Timestamp when the job was created (ms) */
  createdAt: number;
}

/**
 * RelayerJobResult — the structured result after execution.
 */
export interface RelayerJobResult {
  success: boolean;
  jobId: string;
  executionId: string;
  amountIn: string;
  amountOut: string | null;
  txHash: string | null;
  executedPrice: string | null;
  slippageBps: number | null;
  feesPaid: string | null;
  filledLegs: number;
  totalLegs: number;
  failureReason: string | null;
  completedAt: number | null;
}

/** Queue configuration constants */
export const RELAYER_QUEUE_NAME = 'relayer:execution-jobs';

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 86400, count: 10000 },
  removeOnFail: { age: 604800, count: 50000 },
};
