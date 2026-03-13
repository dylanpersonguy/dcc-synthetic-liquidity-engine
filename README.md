# DCC Synthetic Liquidity Engine

A Global Liquidity Router + Synthetic Asset Protocol for [DecentralChain](https://decentralchain.io). Unifies local DCC liquidity (AMM + orderbook), external venue price intelligence (Jupiter, Raydium, Uniswap), synthetic assets, and a protocol-run relayer into a single routing layer.

## Quick Start

```bash
# Prerequisites: Node >=20, Docker
corepack enable && corepack prepare pnpm@9.15.0 --activate

# Start infrastructure
docker compose up -d postgres redis

# Install, build, migrate, seed
pnpm install
pnpm run build
pnpm --filter @dcc/database migrate
pnpm --filter @dcc/database seed

# Start all services in dev mode
pnpm dev
```

The swap UI is at **http://localhost:5173**. The operator dashboard is at **http://localhost:5173/admin**.

## Architecture

```
User → Web Frontend (Vite/React)
        │
        ▼
  Market Data Service (:3210) ─── polls ──→ Venue Adapters (Paper Mode)
        │                                     ├─ DCC AMM
        ▼                                     ├─ Jupiter
  Quote Engine (:3211)                        └─ Raydium
        │
        ▼
  Router Service (:3212)  ←── router-core (discover → score → filter → select)
        │
        ▼
  Execution Service (:3213)
        │
        ├─ LOCAL mode  → simulate completion
        └─ TELEPORT mode → Relayer Service (:3220) → Execution Worker
                                                        │
                                                        ▼
                                                   Escrow Service (:3300)
```

**Current state:** First vertical slice (DCC → SOL) is fully wired end-to-end in **paper mode** — no real funds move, all venue adapters return deterministic simulated quotes.

## Monorepo Structure

```
apps/
  operator-api/       Operator-facing REST API (:3100)
  escrow-api/         Escrow management API (:3301)
  relayer-api/        Relayer admin API (:3200)
  web/                React swap UI + operator dashboard (Vite)

packages/
  types/              Shared Zod schemas & TypeScript types
  config/             Environment config parsing
  database/           PostgreSQL repos + migration runner
  metrics/            Prometheus metrics + structured logger
  connectors/         Venue adapters (Jupiter, Raydium, DCC AMM)
  router-core/        Pure-function routing pipeline
  queue/              BullMQ queue setup
  api-spec/           API type definitions

services/
  market-data-service/    Venue polling + snapshot cache
  quote-engine/           Multi-venue quote aggregation
  router-service/         Route planning API
  execution-service/      Execution lifecycle orchestration
  execution-tracker/      12-state execution state machine
  execution-worker/       BullMQ worker for venue submission
  relayer-service/        Job intake + deduplication
  escrow-service/         On-chain escrow + finalization + refunds
  risk-monitor-service/   Real-time risk monitoring
  venue-health-monitor/   Venue probe + health classification
  market-health-monitor/  Weighted market scoring
  relayer-monitor/        Relayer heartbeat + inventory tracking
  synthetic-risk-monitor/ Synthetic exposure + backing ratio
  alert-engine/           Multi-category alert generation
  protocol-control/       Emergency pause + circuit breakers
  inventory-manager/      Inventory reservation lifecycle
  hedging-engine/         Hedge recording + exposure tracking
  reconciliation-service/ On-chain vs off-chain mismatch detection
  quote-refresher/        Quote staleness validation

contracts/
  dcc-contracts/          Ride smart contracts (4 contracts)
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Build all 34 packages |
| `pnpm run dev` | Start all services (watch mode) |
| `pnpm exec vitest run` | Run all 92 unit tests |
| `pnpm run typecheck` | Type-check without emitting |
| `pnpm --filter @dcc/database migrate` | Apply DB schema |
| `pnpm --filter @dcc/database seed` | Insert seed data (markets, relayers, venues) |
| `docker compose up -d postgres redis` | Start infrastructure |
| `docker compose up --build` | Build + start all containerized services |

## Routing Pipeline

The router-core package implements a pure-function pipeline:

1. **Discover** — Enumerate candidates (LOCAL, TELEPORT, SYNTHETIC) across venues
2. **Score** — 5-dimension weighted scoring: output (35%), slippage (20%), fee (15%), freshness (15%), settlement (15%)
3. **Filter** — Risk checks: emergency pause, max trade size, daily volume, open executions, circuit breakers
4. **Select** — Pick best route (safety preference for LOCAL mode)
5. **Build** — Construct Quote with TTL, execution legs, and nonce

## Paper Mode

All venue adapters default to `paperMode: true`:
- **DCC AMM**: DCC/USDC @ $0.85, $500K depth, 30 bps fee
- **Jupiter**: SOL/USDC @ $135.50, $2M depth, 8 bps fee
- **Raydium**: SOL/USDC @ $135.40, $800K depth, 25 bps fee

Set `paperMode: false` in adapter config and provide API URLs via environment variables to switch to live mode.

## Environment Variables

Copy `.env.example` to `.env` for local development. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://dcc:dcc_dev_password@localhost:5432/dcc_liquidity` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `DCC_NODE_URL` | `http://localhost:4000` | DCC blockchain node |
| `JUPITER_API_URL` | `https://quote-api.jup.ag/v6` | Jupiter V6 API |
| `RAYDIUM_API_URL` | `https://api-v3.raydium.io` | Raydium V3 API |

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system design + phase roadmap |
| [VERTICAL_SLICE.md](docs/VERTICAL_SLICE.md) | End-to-end DCC → SOL walkthrough |
| [OPERATOR_BACKEND.md](docs/OPERATOR_BACKEND.md) | Operator API + monitoring layer |
| [RELAYER_ENGINE.md](docs/RELAYER_ENGINE.md) | Relayer + hedging engine design |
| [SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) | Security audit checklist |
| [TESTING_PLAN.md](docs/TESTING_PLAN.md) | Test strategy + coverage targets |

## Tech Stack

- **Runtime**: Node.js 20, TypeScript 5.5 (strict)
- **Build**: pnpm 9.15 workspaces + Turborepo
- **HTTP**: Fastify 5
- **Validation**: Zod 3.23
- **Database**: PostgreSQL 16
- **Queue**: BullMQ + Redis 7
- **Metrics**: prom-client (Prometheus)
- **Frontend**: React 18, Vite, Tailwind CSS, React Query
- **Smart Contracts**: Ride (DecentralChain)
- **Tests**: Vitest
