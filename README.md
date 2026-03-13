<div align="center">

# 🌊 DCC Synthetic Liquidity Engine

### The Cross-Chain Liquidity Protocol for DecentralChain

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-9.15-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-EF4444?logo=turborepo&logoColor=white)](https://turbo.build/)

**A high-performance cross-chain liquidity aggregation protocol with on-chain AMM, synthetic assets, and smart order routing — built for the [DecentralChain](https://decentralchain.io) ecosystem.**

[Getting Started](#-getting-started) · [Architecture](#-architecture) · [Smart Contracts](#%EF%B8%8F-smart-contracts) · [Documentation](#-documentation)

</div>

---

## ✨ Highlights

- **🔄 On-Chain AMM** — Constant-product automated market maker with real LP token issuance, protocol fee extraction, and virtual liquidity support
- **🪙 10 Synthetic Assets** — sBTC, sETH, sSOL, sXRP, sDOGE, sBNB, sADA, sAVAX, sLINK, sDOT — all live on DCC mainnet with oracle-backed pricing
- **🧠 Smart Order Routing** — Multi-path route discovery across native markets, synthetic instruments, and cross-chain teleport bridges
- **📊 Real-Time Analytics** — Live TVL, 24h volume, fees, and APR computed from on-chain transaction data
- **🛡️ Risk Engine** — Circuit breakers, exposure limits, liquidation engine, and emergency pause controls
- **⛓️ 8 RIDE Smart Contracts** — Fully deployed on DCC mainnet: AMM, Vault, Factory, Oracle, Escrow, Liquidation, PairRegistry, RiskConfig
- **🏗️ Monorepo** — 34 packages orchestrated with pnpm workspaces + Turborepo for blazing-fast builds

---

## 📐 Architecture

```
                              ┌──────────────────────────────────┐
                              │         Frontend (React)         │
                              │    Swap · Markets · Admin Panel  │
                              └──────────────┬───────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                       ▼
          ┌─────────────────┐    ┌───────────────────┐    ┌──────────────────┐
          │  Operator API   │    │  Synthetic Service │    │   Relayer API    │
          │  (Admin Panel)  │    │  (Mint/Burn/Vault) │    │  (Bridge Ops)    │
          └────────┬────────┘    └─────────┬─────────┘    └────────┬─────────┘
                   │                       │                       │
       ┌───────────┴───────────┐           │          ┌────────────┴─────────┐
       ▼                       ▼           ▼          ▼                      ▼
┌─────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  ┌──────────────┐
│   Router    │  │  Risk Monitor│  │ Quote      │  │  Execution   │  │   Hedging    │
│   Service   │  │  + Alerts    │  │ Engine     │  │  Service     │  │   Engine     │
└──────┬──────┘  └──────────────┘  └─────┬─────┘  └──────┬───────┘  └──────────────┘
       │                                 │               │
       └──────────┬──────────────────────┘               │
                  ▼                                      ▼
  ┌────────────────────────────────────┐  ┌────────────────────────────────┐
  │         DCC Blockchain             │  │      External Venues           │
  │  ┌─────┐ ┌───────┐ ┌──────────┐   │  │  Jupiter · Uniswap · Binance  │
  │  │ AMM │ │ Vault │ │ Escrow   │   │  │  + CEX/DEX Connectors         │
  │  └─────┘ └───────┘ └──────────┘   │  └────────────────────────────────┘
  └────────────────────────────────────┘
```

The system follows a **hub-routed, inventory-backed** model where DUSD serves as the hub asset. Trades are routed through the optimal path — native on-chain swaps, synthetic minting, or cross-chain teleport bridges — scored by cost, slippage, speed, and risk.

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **pnpm** | ≥ 9.15.0 |
| **PostgreSQL** | 16+ |
| **Redis** | 7+ |

### Installation

```bash
# Clone the repository
git clone https://github.com/dylanpersonguy/dcc-synthetic-liquidity-engine.git
cd dcc-synthetic-liquidity-engine

# Enable pnpm
corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install dependencies
pnpm install

# Start infrastructure
docker compose up -d postgres redis

# Build all packages
pnpm build

# Start all services in development mode
pnpm dev
```

The swap UI is at **http://localhost:5173**. The operator dashboard is at **http://localhost:5173/admin**.

### Docker (Full Stack)

```bash
docker compose up --build
```

This spins up PostgreSQL, Redis, and all 20+ microservices with health checks and dependency ordering.

### Environment Variables

Copy `.env.example` to `.env` for local development:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis for job queues |
| `DCC_NODE_URL` | `https://mainnet-node.decentralchain.io` | DCC blockchain node |
| `DCC_SEED` | — | Deployer wallet seed phrase |
| `PAPER_MODE` | `false` | Enable paper trading (no real funds) |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## 📦 Monorepo Structure

```
apps/                              → User-facing applications
├── web/                           → React + Vite swap UI & admin dashboard
├── operator-api/                  → Operator-facing REST API
├── relayer-api/                   → Relayer-facing REST API
└── escrow-api/                    → Escrow settlement API

packages/                          → Shared libraries
├── types/                         → Domain types + Zod schemas
├── config/                        → Environment + market configuration
├── connectors/                    → CEX/DEX adapter layer
├── router-core/                   → Route scoring algorithm
├── api-spec/                      → OpenAPI spec + validators
├── database/                      → PostgreSQL client + migrations
├── metrics/                       → Prometheus instrumentation
└── queue/                         → BullMQ job definitions

services/                          → Background microservices
├── synthetic-service/             → Mint/burn/vault orchestration + pricing
├── market-data-service/           → Live price feeds (CoinGecko, Binance)
├── quote-engine/                  → Multi-venue quoting
├── execution-service/             → Trade settlement orchestration
├── execution-tracker/             → 12-state execution state machine
├── execution-worker/              → BullMQ worker for venue submission
├── hedging-engine/                → Delta-hedging positions
├── inventory-manager/             → LP inventory tracking + reservations
├── inventory-rebalancer/          → Cross-venue rebalancing
├── risk-monitor-service/          → Circuit breakers + exposure alerts
├── router-service/                → Smart order routing API
├── relayer-service/               → Job intake + deduplication
├── escrow-service/                → On-chain escrow + finalization
├── reconciliation-service/        → On-chain vs off-chain mismatch detection
├── venue-health-monitor/          → Venue probe + health classification
├── market-health-monitor/         → Weighted market scoring
├── relayer-monitor/               → Relayer heartbeat + inventory tracking
├── synthetic-risk-monitor/        → Synthetic exposure + backing ratio
├── alert-engine/                  → Multi-category alert generation
├── protocol-control/              → Emergency pause + circuit breakers
├── quote-refresher/               → Quote staleness validation
└── redemption-service/            → Synthetic asset redemption flows

contracts/                         → On-chain smart contracts
└── dcc-contracts/
    ├── ride/                      → 8 RIDE smart contracts
    └── scripts/                   → Deploy, redeploy & management scripts

config/                            → Global seed data + risk parameters
docs/                              → Architecture & planning documents
```

---

## ⛓️ Smart Contracts

All 8 contracts are deployed and live on **DCC Mainnet**:

| Contract | Address | Purpose |
|---|---|---|
| **SyntheticAMM** | `3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo` | Constant-product AMM with protocol fees |
| **SyntheticVault** | `3DZhXEqSzqxkrcGjbXQm8QTNw4tHSM9YaZ6` | Collateral vault for synthetic backing |
| **SyntheticAssetFactory** | `3Dkd7yNsoU1oj4tp6zaYGWyaHbRBPtZn8VB` | Synthetic asset minting & burning |
| **SyntheticOracleAdapter** | `3Dj6o4E6xS6Uit2Unw4M8YxPei5tCjaGDJD` | Oracle price feed adapter |
| **SyntheticLiquidationEngine** | `3DTh6sCdSFcy9SFLsK4hu8ZTVSpQ4hKqY5p` | Under-collateralized position liquidation |
| **ExecutionEscrow** | `3DPHeU6Bh7HYUTojDrXDst3Dp1H5R8xyQF6` | Atomic trade escrow + settlement |
| **PairRegistry** | `3DhUAQtPAVrUukobwVw4SgujyB3yFX82Qqr` | Trading pair registration |
| **RiskConfig** | `3DX3TjyzFcVGZzMJP3TgL1pTgpwGtjgf6kG` | On-chain risk parameters |

### AMM Features

- **Constant-product formula** with virtual liquidity depth support
- **Real LP tokens** — issued as on-chain assets (Issue → Reissue → Burn lifecycle)
- **Protocol fee extraction** — configurable split (default 20% protocol / 80% LPs)
- **Fee rate** — 0.30% per swap (`feeRateBps = 30`)
- **Admin controls** — pool creation, status management, config updates, emergency pause

---

## 🪙 Synthetic Assets

10 synthetic assets backed by DUSD collateral with live oracle pricing:

| Asset | Tracks | | Asset | Tracks |
|---|---|---|---|---|
| **sBTC** | Bitcoin | | **sBNB** | BNB |
| **sETH** | Ethereum | | **sADA** | Cardano |
| **sSOL** | Solana | | **sAVAX** | Avalanche |
| **sXRP** | XRP | | **sLINK** | Chainlink |
| **sDOGE** | Dogecoin | | **sDOT** | Polkadot |

Synthetics are **inventory-backed** — the protocol holds DUSD reserves and each synthetic is capped to collateral. Prices are sourced from CoinGecko and Binance via the oracle adapter.

---

## 🔀 Routing Pipeline

The `router-core` package implements a pure-function pipeline that discovers and ranks execution paths across multiple venue types:

```
1. Discover   → Find all executable paths (native, synthetic, teleport)
2. Score      → 5-dimension weighted rank: output (35%), slippage (20%),
                fee (15%), freshness (15%), settlement (15%)
3. Filter     → Risk checks: emergency pause, max trade size, daily volume,
                open executions, circuit breakers
4. Select     → Best route wins (safety preference for local mode)
5. Execute    → Settlement via on-chain escrow
6. Verify     → On-chain confirmation + reconciliation
```

**Supported route types:**

| Type | Description |
|---|---|
| **Native** | Direct on-chain swap via AMM pools |
| **Synthetic** | Mint/burn through the synthetic asset factory |
| **Teleport** | Cross-chain bridge via external venues (Jupiter, Uniswap) |

---

## 🧪 Paper Mode

All services support `PAPER_MODE=true` for safe development and testing:

- Simulates trade fills without touching real assets
- Generates realistic latency and slippage modeling
- Full integration test coverage without mainnet risk
- Deterministic quotes from all venue adapters

---

## 🛠️ Commands

| Command | Description |
|---|---|
| `pnpm build` | Build all 34 packages |
| `pnpm dev` | Start all services (watch mode) |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:integration` | Run integration test suite |
| `pnpm typecheck` | Type-check all packages |
| `pnpm clean` | Remove all dist + node_modules |
| `docker compose up -d postgres redis` | Start infrastructure only |
| `docker compose up --build` | Build + start all containerized services |

---

## 📖 Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Full system design, domain models & phase roadmap |
| [Frontend Requirements](docs/FRONTEND_REQUIREMENTS.md) | UI/UX specifications & accessibility |
| [Operator Backend](docs/OPERATOR_BACKEND.md) | Operator API design & monitoring layer |
| [Relayer Engine](docs/RELAYER_ENGINE.md) | Relayer subsystem & hedging engine design |
| [Security Checklist](docs/SECURITY_CHECKLIST.md) | Security requirements & audit items |
| [Testing Plan](docs/TESTING_PLAN.md) | Test strategy & coverage targets |
| [Vertical Slice](docs/VERTICAL_SLICE.md) | End-to-end DCC → SOL trade walkthrough |

---

## 🏛️ Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5.5 (strict mode) |
| **Runtime** | Node.js 20+ |
| **Frontend** | React 18 · Vite · TailwindCSS · React Query |
| **Backend** | Fastify 5 · Zod validation |
| **Database** | PostgreSQL 16 |
| **Queue** | Redis 7 · BullMQ |
| **Smart Contracts** | RIDE (DecentralChain) |
| **Build** | pnpm workspaces · Turborepo |
| **Metrics** | Prometheus (prom-client) |
| **Testing** | Vitest |
| **CI/CD** | GitHub Actions |
| **Container** | Docker Compose |

---

<div align="center">

Built for **[DecentralChain](https://decentralchain.io)** · Powering synthetic liquidity across chains

</div>
