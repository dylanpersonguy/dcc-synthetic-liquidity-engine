import { z } from 'zod';
import { ExecutionRecord, ExecutionStatus, TimestampMs } from '@dcc/types';

// ============================================================================
// Execution API — GET /execution/:id
// ============================================================================

// ── GET /execution/:id ───────────────────────────────────────────────────
// Returns the current state of an execution.
// Auth: PUBLIC (execution ID is unguessable UUID; no sensitive data)

export const GetExecutionParams = z.object({
  id: z.string().min(1),
});

export const GetExecutionResponse = ExecutionRecord;
export type GetExecutionResponse = z.infer<typeof GetExecutionResponse>;

// Error cases:
// 404 — execution not found
// 500 — internal error

// ── GET /executions (user query) ─────────────────────────────────────────
// Lists executions for a specific user. Used by frontend "Activity" view.
// Auth: USER (must match address)

export const ListExecutionsQuery = z.object({
  userAddress: z.string().min(1),
  status: ExecutionStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListExecutionsQuery = z.infer<typeof ListExecutionsQuery>;

export const ListExecutionsResponse = z.object({
  executions: z.array(ExecutionRecord),
  nextCursor: z.string().nullable(),
});
export type ListExecutionsResponse = z.infer<typeof ListExecutionsResponse>;

// Error cases:
// 400 — invalid parameters
// 403 — address mismatch (trying to query another user)
// 500 — internal error
