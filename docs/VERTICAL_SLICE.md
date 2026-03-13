# Vertical Slice: DCC → SOL (Paper Mode)

This document describes the first end-to-end vertical slice of the DecentralChain
Global Liquidity Router. It proves the entire system works as an integrated pipeline
from market data ingestion through quote generation, route planning, execution
orchestration, and frontend display — all in **paper mode** (no real funds move).

## Architecture

```
User (Web Frontend)
  │
  ├── GET /markets ──────────────────────► Market Data Service (:3210)
  │                                           │ polls venue adapters every 5s
  │                                           │ DCC AMM, Jupiter, Raydium
  │
  ├── POST /quote ───────────────────────► Quote Engine (:3211)
  │                                           │ fetches snapshots from market-data
  │                                           │ runs router pipeline (pure functions)
  │                                           │   discover → score → filter → select → build
  │
  ├── POST /route ───────────────────────► Router Service (:3212)
  │                                           │ calls quote-engine
  │                                           │ builds RoutePlan with legs + escrow
  │
  └── POST /executions ──────────────────► Execution Service (:3213)
                                              │ validates, creates record
                                              │ transitions state machine
                                              │ dispatches to relayer (TELEPORT)
                                              │ or simulates locally (NATIVE)
                                              │
                                              ├──► Relayer Service (:3220)
                                              │      enqueues to BullMQ
                                              │      ├──► Execution Worker (:3201)
                                              │
                                              └──► Execution Tracker (:3101)
                                                     monitors state + stale detection
```

## Route: DCC → SOL (TELEPORT)

This is a 2-leg cross-chain route:

| Leg | From | To | Venue | Chain | Mode |
|-----|------|----|-------|-------|------|
| 0 | DCC | USDC | DCC AMM | DecentralChain | Local |
| 1 | USDC | SOL | Jupiter / Raydium | Solana | External |

The router discovers all combinations of DCC venues × external venues, scores them on
5 dimensions (output, fee, slippage, freshness, settlement), applies risk filters,
and selects the best route.

## Paper Mode

Every venue adapter has a `paperMode` flag (default: `true`). In paper mode:

- **No external API calls** are made
- **Deterministic reference prices** are used (DCC/USDC = $0.85, SOL ≈ $135.50)
- **Simulated depth, fees, and slippage** model realistic market behavior
- **Execution completes instantly** with simulated transaction hashes

This allows full end-to-end testing without any blockchain interaction.

## Services

| Service | Port | Purpose |
|---------|------|---------|
| market-data-service | 3210 | Polls venue adapters, caches snapshots, REST API |
| quote-engine | 3211 | Aggregates venue data, runs router pipeline |
| router-service | 3212 | Route planning API, builds RoutePlan |
| execution-service | 3213 | Accepts execution intents, orchestrates lifecycle |
| relayer-service | 3220 | Job intake, validation, BullMQ dispatch |
| execution-worker | 3201 | BullMQ worker, 17-state execution machine |
| execution-tracker | 3101 | State monitoring, stale detection |
| operator-api | 3100 | Admin dashboard REST API |

## Frontend

The web frontend (`apps/web`) communicates with real services via configurable env vars:

```
VITE_MARKET_DATA_URL=http://localhost:3210
VITE_QUOTE_ENGINE_URL=http://localhost:3211
VITE_ROUTER_SERVICE_URL=http://localhost:3212
VITE_EXECUTION_SERVICE_URL=http://localhost:3213
VITE_OPERATOR_API_URL=http://localhost:3100
```

When services are unavailable, the frontend gracefully falls back to mock data.

## Running Locally

```bash
# Start infrastructure
docker compose up postgres redis -d

# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Start services (in separate terminals)
cd services/market-data-service && pnpm start
cd services/quote-engine && pnpm start
cd services/router-service && pnpm start
cd services/execution-service && pnpm start

# Start frontend
cd apps/web && pnpm dev
```

## Running Tests

```bash
# Router core tests (unit, no DB needed)
cd packages/router-core && pnpm test

# Specific vertical slice tests
cd packages/router-core && pnpm vitest run src/vertical-slice.test.ts
```

## Scoring Algorithm

Routes are scored on 5 weighted dimensions:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Output | 0.35 | Normalized output amount (higher = better) |
| Fee | 0.15 | Inverse of fee as fraction of input (lower fee = higher score) |
| Slippage | 0.20 | Rejection if > 500 bps; scored inversely |
| Freshness | 0.15 | Data recency from venue adapter |
| Settlement | 0.15 | LOCAL=1.0, SYNTHETIC=0.8, REDEEMABLE=0.7, TELEPORT=0.5 |

## Risk Filters

The following risk checks are applied in order:

1. **Emergency pause** — all routes rejected
2. **Circuit breaker** — per-market halt
3. **Max trade size** — per-pair limit
4. **Daily volume limit** — cumulative check
5. **Max open executions** — concurrency limit
6. **Relayer inventory** — TELEPORT routes only, checks output asset availability

## Security

- **Nonce enforcement** per user address (replay protection)
- **State machine transitions** validated (only allowed transitions proceed)
- **Quote TTL** — routes expire after 30 seconds
- **Execution ID** — UUID-based, globally unique
- **CORS** enabled on all services
- **No real fund movement** in paper mode
- **Escrow timeout** safeguard for TELEPORT routes (refundable after 5 min)

## State Machine

```
quote_created → route_locked → local_leg_pending → local_leg_complete
                                                          │
                              ┌────────────────────────────┘
                              ▼
                    external_leg_pending → external_leg_complete
                                                  │
                              ┌────────────────────┘
                              ▼
                    awaiting_delivery → completed
                              │
                              ▼
                           failed → refunded
                           expired → refunded
```
