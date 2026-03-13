// ============================================================================
// @dcc/queue — BullMQ Queue Client
// ============================================================================
//
// Why BullMQ over raw ioredis:
//   - Production-proven at massive scale (billions of jobs/month at companies)
//   - Built-in reliable delivery: retry with exponential backoff, stalled
//     job recovery, dead-letter handling, job deduplication
//   - TypeScript-native with full type safety on payloads
//   - Worker concurrency control, rate limiting, job prioritization
//   - Eliminates ~500 lines of complex Lua scripts for atomic operations
//   - Well-maintained, active development (>10k GH stars)
//
// Queue design:
//   - Single queue "relayer:execution-jobs" for all relayer jobs
//   - Jobs are keyed by jobId (deduplication via BullMQ's jobId option)
//   - Workers process one job at a time (concurrency=1 for v1 safety)
//   - Exponential backoff: 2s → 4s → 8s on failure (max 3 attempts)
//   - Dead-letter after max retries (retained 7 days for investigation)
//   - Completed jobs retained 24h for status queries
//   - Stalled job recovery via BullMQ's built-in heartbeat mechanism
// ============================================================================

import { Queue, Worker, type Processor, type WorkerOptions, type QueueOptions } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  type RelayerJobPayload,
  type RelayerJobResult,
  RELAYER_QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
} from './types.js';

/**
 * Parse a Redis URL into BullMQ ConnectionOptions to avoid ioredis version
 * mismatch issues between our direct dep and BullMQ's bundled copy.
 */
export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1), 10) || 0 : 0,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  };
}

/**
 * Create the relayer job queue (producer side).
 *
 * Used by: relayer-service (intake) to enqueue approved jobs.
 */
export function createRelayerQueue(connection: ConnectionOptions, opts?: Partial<QueueOptions>): Queue<RelayerJobPayload, RelayerJobResult> {
  return new Queue(RELAYER_QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...opts,
  }) as Queue<RelayerJobPayload, RelayerJobResult>;
}

/**
 * Enqueue a relayer job with idempotency protection.
 *
 * Uses jobId as deduplication key — BullMQ ignores duplicate jobIds.
 * This prevents the same execution from being processed twice.
 */
export async function enqueueRelayerJob(
  queue: Queue<RelayerJobPayload, RelayerJobResult>,
  payload: RelayerJobPayload,
) {
  const job = await queue.add('execute', payload, {
    jobId: payload.jobId,
    priority: payload.riskTier === 'TIER_1' ? 1 : payload.riskTier === 'TIER_2' ? 2 : 3,
  });
  return job;
}

/**
 * Create the relayer execution worker (consumer side).
 *
 * Used by: execution-worker service to process jobs.
 *
 * @param processor - The function that processes each job
 * @param concurrency - Number of concurrent jobs (default: 1 for v1 safety)
 */
export function createRelayerWorker(
  connection: ConnectionOptions,
  processor: Processor<RelayerJobPayload, RelayerJobResult>,
  opts?: Partial<WorkerOptions>,
): Worker<RelayerJobPayload, RelayerJobResult> {
  return new Worker(
    RELAYER_QUEUE_NAME,
    processor,
    {
      connection,
      concurrency: 1,
      stalledInterval: 30_000,       // check for stalled jobs every 30s
      maxStalledCount: 2,            // mark stalled after 2 missed heartbeats
      lockDuration: 120_000,         // 2 min lock per job
      lockRenewTime: 60_000,         // renew lock every 60s
      ...opts,
    },
  );
}

/**
 * Get queue health metrics for monitoring.
 */
export async function getQueueHealth(queue: Queue<RelayerJobPayload, RelayerJobResult>): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}> {
  const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);
  return { waiting, active, completed, failed, delayed, paused: isPaused };
}
