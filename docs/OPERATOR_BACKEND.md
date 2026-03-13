# Operator Backend Architecture

## Overview

The Operator Backend provides real-time monitoring, alerting, and control for the DecentralChain Global Liquidity Router protocol. It is designed for production reliability and operational clarity — not demo functionality.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          apps/operator-api                               │
│                    (Fastify REST API — :3100)                            │
│                                                                          │
│  /admin/summary  /admin/markets  /admin/executions  /admin/relayers     │
│  /admin/venues   /admin/risk     /admin/alerts      /admin/protocol/*   │
│  /metrics        /health                                                 │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ reads from
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ packages/    │   │ packages/    │   │ packages/    │
  │ database     │   │ metrics      │   │ config       │
  │ (pg repos)   │   │ (prometheus) │   │ (zod env)    │
  └──────┬───────┘   └──────────────┘   └──────────────┘
         │
    PostgreSQL (15 tables, 9 enum types)
```

### Monitoring Services (write to database)

| Service                      | Port | Responsibility                                      |
|------------------------------|------|------------------------------------------------------|
| `execution-tracker`          | 3101 | Execution lifecycle tracking, state machine, legs    |
| `relayer-monitor`            | 3102 | Relayer heartbeat, inventory, health detection       |
| `venue-health-monitor`       | 3103 | Venue probing, latency/error tracking, health scoring|
| `market-health-monitor`      | 3104 | Market health scoring (7 weighted factors)           |
| `synthetic-risk-monitor`     | 3105 | Synthetic exposure, backing ratio, utilization       |
| `alert-engine`               | 3106 | Alert generation, deduplication, lifecycle           |
| `protocol-control`           | 3107 | Emergency pause, circuit breakers, market controls   |

## Database Schema (packages/database)

### Enum Types (9)
- `execution_status` — 12-state execution machine
- `market_status`, `market_mode`, `risk_tier`
- `venue_health_status`, `relayer_status`
- `alert_severity`, `circuit_breaker_level`, `leg_status`

### Tables (15)
- **markets** — Market configuration and state
- **executions** — Full execution lifecycle records
- **execution_legs** — Per-leg status for multi-leg routes
- **execution_transitions** — Audit log of state changes
- **route_plans** — Stored route plans with scoring
- **relayers** — Relayer state and performance
- **relayer_inventory** — Per-asset per-chain balances
- **venue_health** — Venue health snapshots
- **market_health** — Computed market health scores
- **synthetic_exposure** — Synthetic asset exposure tracking
- **risk_alerts** — Alert lifecycle (create → acknowledge → resolve)
- **protocol_controls** — Key-value protocol safety switches
- **execution_metrics** — Time-series execution metrics by hour
- **route_metrics** — Time-series route metrics by hour
- **connector_health** — Per-venue per-pair connector snapshots

## Metrics (packages/metrics)

### Prometheus Metrics
All metrics are prefixed with `dcc_` and exposed at `GET /metrics`.

| Metric                          | Type      | Labels                              |
|---------------------------------|-----------|--------------------------------------|
| `dcc_execution_total`           | Counter   | pair_id, status, mode               |
| `dcc_execution_latency_ms`      | Histogram | pair_id, mode                       |
| `dcc_execution_pending`         | Gauge     | pair_id                             |
| `dcc_execution_volume_usd`      | Counter   | pair_id, mode                       |
| `dcc_route_success_rate`        | Gauge     | pair_id, settlement_mode            |
| `dcc_route_slippage_bps`        | Histogram | pair_id, settlement_mode            |
| `dcc_venue_latency_ms`          | Histogram | venue_id, venue_type                |
| `dcc_venue_health_status`       | Gauge     | venue_id, venue_type                |
| `dcc_venue_error_rate`          | Gauge     | venue_id                            |
| `dcc_relayer_status`            | Gauge     | relayer_id                          |
| `dcc_relayer_inventory_usd`     | Gauge     | relayer_id                          |
| `dcc_relayer_active_jobs`       | Gauge     | relayer_id                          |
| `dcc_relayer_latency_ms`        | Histogram | relayer_id, chain                   |
| `dcc_market_health_score`       | Gauge     | pair_id                             |
| `dcc_market_liquidity_usd`      | Gauge     | pair_id, source                     |
| `dcc_synthetic_exposure_usd`    | Gauge     | synthetic_asset_id                  |
| `dcc_synthetic_utilization`     | Gauge     | synthetic_asset_id                  |
| `dcc_synthetic_backing_ratio`   | Gauge     | synthetic_asset_id                  |
| `dcc_active_alerts`             | Gauge     | severity                            |
| `dcc_protocol_paused`           | Gauge     | —                                   |
| `dcc_circuit_breaker_level`     | Gauge     | —                                   |

### Structured Logging
JSON logs with fields: `timestamp`, `level`, `message`, `service`, `event`, `executionId`, `pairId`, `venueId`, `relayerId`, `severity`, `durationMs`.

## API Endpoints (apps/operator-api)

### Dashboard
- `GET /admin/summary` — Full dashboard overview (markets, executions, relayers, venues, alerts, protocol state)

### Markets
- `GET /admin/markets` — List markets with health scores (filter: status, mode)
- `GET /admin/markets/:pairId` — Market detail with execution + route metrics
- `POST /admin/markets/:pairId/pause` — Pause market
- `POST /admin/markets/:pairId/unpause` — Unpause market

### Executions
- `GET /admin/executions` — Paginated executions (filter: status, pairId, relayerId; cursor pagination)
- `GET /admin/executions/:executionId` — Execution detail with legs
- `GET /admin/executions/stats` — Status distribution and 24h metrics

### Relayers
- `GET /admin/relayers` — All relayers with status counts
- `GET /admin/relayers/:relayerId` — Relayer detail with inventory breakdown

### Monitoring
- `GET /admin/venues` — Venue health overview
- `GET /admin/venues/:venueId` — Venue detail with connector health
- `GET /admin/risk` — Risk overview (synthetic exposure, alerts, protocol state)
- `GET /admin/alerts` — Alerts with filters (severity, category, acknowledged, resolved)
- `POST /admin/alerts/:id/acknowledge` — Acknowledge alert
- `POST /admin/alerts/:id/resolve` — Resolve alert

### Protocol Controls
- `POST /admin/protocol/pause` — Emergency pause entire protocol
- `POST /admin/protocol/resume` — Resume protocol

### Operations
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

## Execution State Machine (12 states)

```
quote_created → route_locked → local_leg_pending → local_leg_complete
                             → external_leg_pending → external_leg_complete
                                                    → awaiting_delivery → completed
                (any non-terminal) → failed / expired → refunded
                local_leg_complete → partially_filled → completed / refunded
```

Terminal states: `completed`, `failed`, `expired`, `refunded`

## Alert Categories

| Category            | Severity  | Condition                              |
|---------------------|-----------|----------------------------------------|
| `venue_down`        | critical  | Venue health status = down             |
| `relayer_offline`   | critical  | Relayer status = offline               |
| `relayer_degraded`  | warning   | Relayer status = degraded              |
| `inventory_low`     | warning   | Relayer inventory < $1,000             |
| `execution_spike`   | critical  | Failure rate > 20% in last hour        |
| `synthetic_cap`     | warn/crit | Utilization > 80% (warn) / 95% (crit)  |
| `synthetic_backing` | warn/crit | Backing ratio < 1.1 (warn) / 1.0 (crit)|
| `market_unhealthy`  | warn/crit | Health score < 50 (warn) / 25 (crit)   |

## Market Health Scoring

Weighted composite score (0-100):
- Local Liquidity: 20%
- External Liquidity: 15%
- Route Success Rate: 25%
- Average Execution Time: 15%
- Venue Coverage: 15%
- Relayer Coverage: 5%
- Synthetic Utilization: 5%

## Running Locally

```bash
# Start infrastructure
docker compose up postgres redis -d

# Apply database schema
cd packages/database && DATABASE_URL=postgresql://dcc:dcc_dev_password@localhost:5432/dcc_liquidity pnpm migrate

# Start operator API
cd apps/operator-api && PORT=3100 DATABASE_URL=postgresql://dcc:dcc_dev_password@localhost:5432/dcc_liquidity pnpm dev

# Start monitoring services (each in separate terminal)
cd services/execution-tracker && PORT=3101 DATABASE_URL=... pnpm dev
cd services/relayer-monitor && PORT=3102 DATABASE_URL=... pnpm dev
cd services/venue-health-monitor && PORT=3103 DATABASE_URL=... pnpm dev
cd services/market-health-monitor && PORT=3104 DATABASE_URL=... pnpm dev
cd services/synthetic-risk-monitor && PORT=3105 DATABASE_URL=... pnpm dev
cd services/alert-engine && PORT=3106 DATABASE_URL=... pnpm dev
cd services/protocol-control && PORT=3107 DATABASE_URL=... pnpm dev
```
