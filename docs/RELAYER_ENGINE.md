# Relayer + Hedging Engine

> The execution subsystem of the DCC Global Liquidity Router.

## Architecture Overview

The Relayer Engine handles the entire lifecycle of cross-venue execution: from
intent intake through venue interaction, fill tracking, hedge management, and
reconciliation. It is designed for **production reliability and operational
traceability**.

```
                    ┌──────────────────┐
                    │ execution-service │  (upstream — produces intents)
                    └────────┬─────────┘
                             │ POST /intake
                    ┌────────▼─────────┐
                    │ relayer-service   │  Job Intake + Dispatch
                    │ (validates, dedup │  Port 3210
                    │  enqueues)        │
                    └────────┬─────────┘
                             │ BullMQ
                    ┌────────▼─────────┐
                    │ execution-worker  │  Core Execution State Machine
                    │ (state machine,   │  Port 3201
                    │  venue executor)  │
                    └──┬───┬───┬───┬───┘
                       │   │   │   │
          ┌────────────┘   │   │   └────────────┐
          ▼                ▼   ▼                ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ inventory-   │ │ quote-   │ │ hedging- │ │reconciliation│
  │ manager      │ │ refresher│ │ engine   │ │ -service     │
  │ Port 3202    │ │ Port 3205│ │ Port 3203│ │ Port 3204    │
  └──────────────┘ └──────────┘ └──────────┘ └──────────────┘

  ┌──────────────────┐
  │ relayer-api       │  Admin/Operator REST API
  │ Port 3200         │  (status, jobs, inventory, admin controls)
  └──────────────────┘
```

## Services

### relayer-service (Port 3210)
**Job Intake & Dispatch Engine**

Receives execution intents from the execution-service via `POST /intake`,
validates the payload schema and business rules, de-duplicates by executionId,
and enqueues validated jobs to the BullMQ execution queue.

Endpoints:
- `POST /intake` — Submit an execution job
- `GET /queue/status` — Queue health metrics
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

### execution-worker (Port 3201)
**Core Execution State Machine**

Consumes jobs from the BullMQ queue and drives the 17-state execution pipeline:

```
received → validated → inventory_reserved → quote_refreshed →
ready_to_execute → submitting → submitted → awaiting_confirmation →
filled → delivery_pending → completed → inventory_released → reconciled
```

Error paths: `→ failed/timed_out/rejected → inventory_released`

Each state transition is:
- Validated against the transition map (no illegal jumps)
- Recorded in the `relayer_job_transitions` audit table
- Conditional on current status (optimistic concurrency)
- Timestamped and logged

8 risk checks before execution:
1. Emergency pause flag
2. Market status (open)
3. Market circuit breaker
4. Venue health/availability
5. Per-route notional limit
6. Per-venue notional limit
7. Global notional limit
8. Daily budget remaining

### inventory-manager (Port 3202)
**Inventory Tracking & Reservation**

Manages the protocol's cross-chain inventory with atomic reservation semantics.
Before executing, the worker reserves inventory; after filling, it's consumed;
on failure, it's released.

Endpoints:
- `GET /inventory` — All positions
- `GET /inventory/:asset` — Positions by asset
- `GET /inventory/:chain/:asset` — Specific position
- `POST /inventory/reserve` — Reserve inventory for execution
- `POST /inventory/release` — Release reservation (on failure)
- `POST /inventory/consume` — Consume reservation (on fill)
- `POST /inventory/deposit` — Deposit/upsert inventory
- `GET /inventory/reservations` — Active reservations
- `GET /inventory/summary` — Aggregate with health classification

### hedging-engine (Port 3203)
**Exposure Tracking & Hedge Management**

V1 model: the external venue execution IS the hedge. Tracks residual exposure
(difference between expected and actual fills) and flags large residuals for
rebalancing.

Endpoints:
- `POST /hedge/record` — Record a hedge for an execution
- `GET /hedge/:jobId` — Hedge records for a job
- `GET /hedge/execution/:executionId` — Hedge records by execution
- `GET /hedge/residuals` — Unhedged residual exposure
- `GET /hedge/exposure` — Aggregate exposure summary

### reconciliation-service (Port 3204)
**On-Chain Reconciliation Pipeline**

Periodically verifies that on-chain reality matches internal records. Compares
expected vs actual amounts with a 2% tolerance and flags mismatches.

Endpoints:
- `POST /reconciliation/trigger` — Manual reconciliation trigger
- `GET /reconciliation/status` — Aggregate status counts
- `GET /reconciliation/mismatches` — Unresolved mismatches
- `GET /reconciliation/:jobId` — Reconciliation records by job
- `POST /reconciliation/:id/resolve` — Manual mismatch resolution

### quote-refresher (Port 3205)
**Pre-Execution Quote Refresh & Validation**

Gets fresh quotes from venues and validates that conditions haven't degraded
since the original quote. Enforces freshness (30s max), slippage degradation
(50bps max), and minimum amount out.

Endpoints:
- `POST /quote/refresh` — Get fresh quote from venue
- `POST /quote/validate` — Validate fresh quote vs original

### relayer-api (Port 3200)
**Operator REST API**

Administrative interface for relayer operations: system status, job management,
inventory overview, venue health, hedge exposure, and admin controls.

Key endpoints:
- `GET /status` — Full system status
- `GET /jobs` — Job listing with filters
- `GET /jobs/:jobId` — Full job detail with attempts, executions, hedges
- `POST /jobs/retry` — Re-enqueue a failed job
- `POST /jobs/:jobId/cancel` — Cancel a pre-execution job
- `GET /inventory/summary` — Inventory health
- `GET /venues` — Venue status cache
- `POST /admin/pause` — Emergency pause
- `POST /admin/resume` — Resume operations
- `GET /admin/risk-limits` — View risk limits
- `POST /admin/risk-limits` — Update risk limits
- `GET /admin/stale-jobs` — Stale/expired jobs

## Database Schema

### New Tables (in `relayer-tables.ts`)

| Table | Purpose |
|-------|---------|
| `relayer_jobs` | Durable job records with 17-state status, payload JSONB |
| `relayer_attempts` | Per-attempt records with timing and results |
| `inventory_reservations` | Explicit reservation lifecycle tracking |
| `external_executions` | Venue execution records (tx hash, amounts, timing) |
| `hedge_records` | Exposure/hedged/residual tracking per execution |
| `reconciliation_records` | On-chain vs internal comparison results |
| `venue_status_cache` | Venue availability snapshots |
| `relayer_risk_limits` | Per-route/per-venue/global notional limits |
| `relayer_job_transitions` | Audit log of every state transition |

### New Enums

- `relayer_job_status` — 17 states matching the execution state machine
- `reservation_status` — active / released / consumed / expired
- `reconciliation_status` — pending / matched / mismatched / resolved / unresolved

## Queue Design

**BullMQ** (Redis-backed) was chosen for the job queue because:
- Production-proven at massive scale
- Built-in retry with exponential backoff (3 attempts, 2s base delay)
- Job deduplication by executionId
- Stalled job recovery (30s check interval)
- Worker lock management (2min lock, 60s renewal)
- TypeScript-native with excellent DX
- Eliminates need for custom Lua scripts

Queue name: `relayer:execution-jobs`
Concurrency: 1 worker per process (serialized execution for v1)
Priority: risk tier mapped to numeric priority (lower = higher priority)

## Metrics

13 new Prometheus metrics added to `@dcc/metrics`:

| Metric | Type | Labels |
|--------|------|--------|
| `relayer_jobs_received_total` | Counter | pair_id, risk_tier |
| `relayer_jobs_failed_total` | Counter | pair_id, failure_reason |
| `relayer_jobs_completed_total` | Counter | pair_id, venue_id |
| `relayer_execution_latency_seconds` | Histogram | pair_id, venue_id |
| `venue_submission_latency_seconds` | Histogram | venue_id, chain |
| `inventory_available_balance` | Gauge | asset, chain |
| `inventory_reserved_balance` | Gauge | asset, chain |
| `stale_quote_rejections_total` | Counter | venue_id |
| `partial_fill_total` | Counter | venue_id, pair_id |
| `reconciliation_mismatch_total` | Counter | venue_id |
| `hedge_residual_exposure` | Gauge | asset, chain |
| `relayer_queue_depth` | Gauge | state |
| `risk_budget_used` | Gauge | scope |

## Risk Controls

The execution-worker enforces 8 risk checks before every execution:

1. **Emergency pause** — protocol_controls table flag
2. **Market status** — market must be in OPEN status
3. **Market circuit breaker** — must not be active for the pair
4. **Venue availability** — venue_status_cache must show available
5. **Per-route notional** — relayer_risk_limits for the specific pair
6. **Per-venue notional** — relayer_risk_limits for the venue
7. **Global notional** — relayer_risk_limits global cap
8. **Daily budget** — total daily spend remaining

## Development

### Running locally

```bash
# Start infrastructure
docker compose up postgres redis -d

# Install dependencies (includes bullmq, ioredis)
pnpm install

# Run migrations
pnpm --filter @dcc/database run migrate

# Start services (each in a separate terminal)
pnpm --filter @dcc/relayer-service dev        # Port 3210 — intake
pnpm --filter @dcc/execution-worker dev       # Port 3201 — worker
pnpm --filter @dcc/inventory-manager dev      # Port 3202
pnpm --filter @dcc/hedging-engine dev         # Port 3203
pnpm --filter @dcc/reconciliation-service dev # Port 3204
pnpm --filter @dcc/quote-refresher dev        # Port 3205
pnpm --filter @dcc/relayer-api dev            # Port 3200 — admin API
```

### Typecheck

```bash
pnpm --filter @dcc/queue typecheck
pnpm --filter @dcc/execution-worker typecheck
pnpm --filter @dcc/inventory-manager typecheck
pnpm --filter @dcc/hedging-engine typecheck
pnpm --filter @dcc/reconciliation-service typecheck
pnpm --filter @dcc/quote-refresher typecheck
pnpm --filter @dcc/relayer-api typecheck
```

### Port Map

| Service | Port |
|---------|------|
| relayer-api | 3200 |
| execution-worker | 3201 |
| inventory-manager | 3202 |
| hedging-engine | 3203 |
| reconciliation-service | 3204 |
| quote-refresher | 3205 |
| relayer-service (intake) | 3210 |

## V1 Limitations

- **Single worker pipeline** — one execution-worker process, concurrency=1
- **Simulated confirmations** — tx confirmation polling is stubbed (1s delay)
- **No automated hedging** — external execution IS the hedge; residuals tracked only
- **No cross-chain delivery** — delivery_pending → completed is immediate
- **Centralized relayer** — single protocol-run relayer, no decentralized set
- **In-process execution deps** — inventory/quote/hedge calls are function-level, not HTTP
