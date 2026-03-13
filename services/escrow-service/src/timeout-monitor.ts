// ============================================================================
// Timeout Monitor — Automatic expiration of stale escrow intents
// ============================================================================
//
// Runs on a periodic interval and:
//   1. Finds all non-terminal escrow intents past their expiresAt
//   2. Transitions them to 'expired' status
//   3. Emits ExecutionExpired events
//   4. Updates metrics
//
// Anyone can trigger expiration (mirrors on-chain behavior), but this
// background monitor ensures it happens automatically.
// ============================================================================

import { escrowIntentRepo } from '@dcc/database';
import { escrowIntentsExpired, escrowActiveIntents, escrowTimeoutRate } from '@dcc/metrics';
import { transitionEscrow } from './state-machine.js';
import type { Logger } from '@dcc/metrics';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let recentExpiredCount = 0;
let recentTotalChecked = 0;

export function startTimeoutMonitor(intervalMs: number, logger: Logger): void {
  if (intervalHandle) return;

  logger.info('[timeout-monitor] Starting', { durationMs: intervalMs });

  intervalHandle = setInterval(async () => {
    try {
      await checkExpiredIntents(logger);
    } catch (err) {
      logger.error('[timeout-monitor] Error in timeout check', { err: err instanceof Error ? err : undefined });
    }
  }, intervalMs);
}

export function stopTimeoutMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function checkExpiredIntents(logger: Logger): Promise<void> {
  const expired = await escrowIntentRepo.findExpired();

  if (expired.length === 0) return;

  logger.info('[timeout-monitor] Found expired intents', { durationMs: expired.length });

  let expiredCount = 0;

  for (const intent of expired) {
    try {
      await transitionEscrow(
        intent.execution_id,
        'expired',
        'timeout-monitor',
        { refund_amount: intent.amount_in },
        'Execution expired (timeout)',
      );

      escrowIntentsExpired.inc({ pair_id: intent.pair_id });
      expiredCount++;

      logger.info(
        '[timeout-monitor] Expired execution',
        { executionId: intent.execution_id, pairId: intent.pair_id },
      );
    } catch (err) {
      // May fail if already transitioned by someone else — that's fine
      logger.warn(
        '[timeout-monitor] Failed to expire intent (may already be transitioned)',
        { executionId: intent.execution_id },
      );
    }
  }

  recentExpiredCount += expiredCount;
  recentTotalChecked += expired.length;

  // Update metrics
  const activeCount = await escrowIntentRepo.getActiveCount();
  escrowActiveIntents.set(activeCount);

  // Update timeout rate (rolling approximation)
  if (recentTotalChecked > 0) {
    escrowTimeoutRate.set(recentExpiredCount / Math.max(recentTotalChecked, 1));
  }
}

/**
 * Auto-refund processor: finds intents in refundable states with no refund tx
 * and triggers refund processing.
 */
export async function processAutoRefunds(
  logger: Logger,
  processRefund: (executionId: string) => Promise<void>,
): Promise<number> {
  const pendingRefunds = await escrowIntentRepo.findPendingRefunds();

  if (pendingRefunds.length === 0) return 0;

  logger.info('[auto-refund] Processing pending refunds', { durationMs: pendingRefunds.length });

  let processed = 0;

  for (const intent of pendingRefunds) {
    try {
      await processRefund(intent.execution_id);
      processed++;
    } catch (err) {
      logger.error(
        '[auto-refund] Failed to process refund',
        { executionId: intent.execution_id, err: err instanceof Error ? err : undefined },
      );
    }
  }

  return processed;
}
