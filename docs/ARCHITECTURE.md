# DCC Synthetic Liquidity Engine — Architecture Blueprint

## 1. Executive Summary

The DCC Synthetic Liquidity Engine is a **Global Liquidity Router + Synthetic Asset Protocol** designed to make DecentralChain behave like a much larger chain. It unifies local DCC liquidity (AMM + orderbook), external price/liquidity intelligence (Jupiter, Raydium, Uniswap), synthetic asset markets, and a protocol-run relayer into a single coherent trading experience.

**Core value proposition:** Users can trade DCC, USDC, SOL, ETH, BTC, BONK, WIF, and future assets even when those assets don't natively exist on DCC or lack deep native liquidity.

**Architecture approach:**
- Modular, phased delivery (7 phases)
- Three-layer design: on-chain contracts, off-chain services, external connectors
- pnpm monorepo with clean package boundaries
- Safety-first: escrow-backed execution, circuit breakers, strict caps, honest synthetic accounting

**Shipping sequence:**
1. Phase 0: Registry, config, quote skeleton (no live trading)
2. Phase 1: Live external quotes, unified quote API
3. Phase 2: Relayer-backed cross-chain execution
4. Phase 3: Synthetic asset issuance (sSOL, sETH, sBTC)
5. Phase 4: Synthetic AMM pools
6. Phase 5: Long-tail assets (sBONK, sWIF)
7. Phase 6: Open liquidity network

---

## 2. Recommended First Production Architecture

The recommended v1 architecture is **hub-routed, centralized relayer, inventory-backed synthetics**:

### Hub Asset Model
- **USDC** on DCC is the hub asset.
- All cross-chain routes convert to USDC first, then route USDC→target on the external venue.
- Why: Simplifies routing (n pairs → 2 legs max), maximizes liquidity (USDC has deepest external pools), and concentrates relayer inventory in one asset.

### Centralized Protocol Relayer (v1)
- Single protocol-run relayer holds inventory on DCC, Solana, and Ethereum.
- ExecutionEscrow on DCC guarantees user safety: if relayer doesn't fill, user gets a refund.
- Trust assumption is explicit: users trust the relayer to be honest and solvent within the escrow timeout window.
- This is the correct v1 trade-off: shipping speed + operational simplicity vs. eventual decentralization (Phase 6).

### Inventory-Backed Synthetics
- Synthetic assets (sSOL, sETH, sBTC) are backed by protocol reserves in USDC.
- The protocol holds real value (USDC) equal to the mark-to-market liability of outstanding synthetics.
- Supply caps enforce that the protocol never overextends.
- This is more honest and simpler than overcollateralized (requires governance/liquidation) or algorithmic (fragile peg).

### What is NOT in v1
- No open relayer network (Phase 6)
- No overcollateralized synthetic minting by users
- No on-chain governance
- No L2/alt-chain expansion beyond Solana + Ethereum
- No synthetic orderbook (Phase 4)
- No long-tail assets (Phase 5)

This architecture is recommended because it maximizes safety, minimizes operational complexity, and gets real users trading real routes quickly.

---

## 3. Full Monorepo / Repo Structure

```
dcc-synthetic-liquidity-engine/
├── package.json                  # Root workspace config
├── pnpm-workspace.yaml           # pnpm workspace definition
├── turbo.json                    # Turborepo pipeline config
├── tsconfig.base.json            # Shared TypeScript config
├── docker-compose.yml            # Local dev deps (Postgres, Redis)
├── .env.example                  # Environment variable template
├── .gitignore
│
├── packages/                     # Shared libraries
│   ├── types/                    # @dcc/types — all domain models, enums, Zod schemas
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── common.ts         # Branded IDs, ChainId, DecimalString, pagination
│   │   │   ├── market.ts         # Pair, MarketMode, MarketStatus, Asset, DepthLevel
│   │   │   ├── quote.ts          # Quote, QuoteRequest, QuoteMode, QuoteLeg
│   │   │   ├── route.ts          # RoutePlan, RouteLeg, RouteScore, SettlementMode
│   │   │   ├── execution.ts      # ExecutionIntent, ExecutionRecord, ExecutionStatus
│   │   │   ├── synthetic.ts      # SyntheticAsset, SyntheticVaultState, BackingModel
│   │   │   ├── redemption.ts     # RedemptionRequest, RedemptionStatus
│   │   │   ├── risk.ts           # RiskConfig, CircuitBreakerLevel, RiskStatus
│   │   │   ├── venue.ts          # VenueQuote, VenueSnapshot, IVenueAdapter
│   │   │   ├── relayer.ts        # FillAttestation, RelayerState
│   │   │   └── inventory.ts      # InventoryPosition, RebalanceProposal
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── config/                   # @dcc/config — Zod-validated env config schemas
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── connectors/               # @dcc/connectors — external venue adapters
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── base-adapter.ts   # Abstract BaseVenueAdapter
│   │   │   ├── venue-registry.ts # Runtime adapter registry
│   │   │   ├── jupiter/jupiter-adapter.ts
│   │   │   ├── raydium/raydium-adapter.ts
│   │   │   ├── uniswap/uniswap-adapter.ts
│   │   │   ├── dcc/dcc-amm-adapter.ts
│   │   │   └── dcc/dcc-orderbook-adapter.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── router-core/              # @dcc/router-core — pure routing algorithm
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── router.ts         # discoverCandidates, scoreCandidates, selectRoute
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── api-spec/                 # @dcc/api-spec — REST API Zod schemas
│       ├── src/
│       │   ├── index.ts
│       │   ├── market-api.ts
│       │   ├── quote-api.ts
│       │   ├── route-api.ts
│       │   ├── execution-api.ts
│       │   ├── redemption-api.ts
│       │   ├── risk-api.ts
│       │   └── inventory-api.ts
│       ├── package.json
│       └── tsconfig.json
│
├── contracts/                    # On-chain contract interfaces
│   └── dcc-contracts/            # @dcc/contracts
│       ├── src/
│       │   ├── index.ts
│       │   ├── pair-registry.ts
│       │   ├── risk-config.ts
│       │   ├── execution-escrow.ts
│       │   ├── synthetic-asset-factory.ts
│       │   ├── synthetic-vault.ts
│       │   ├── synthetic-amm.ts
│       │   └── redemption-router.ts
│       ├── package.json
│       └── tsconfig.json
│
├── services/                     # Off-chain protocol services
│   ├── market-data-service/      # @dcc/market-data-service
│   ├── quote-engine/             # @dcc/quote-engine
│   ├── router-service/           # @dcc/router-service
│   ├── execution-service/        # @dcc/execution-service
│   ├── relayer-service/          # @dcc/relayer-service
│   ├── redemption-service/       # @dcc/redemption-service
│   ├── risk-monitor-service/     # @dcc/risk-monitor-service
│   └── inventory-rebalancer/     # @dcc/inventory-rebalancer
│
├── config/                       # Seed data + protocol configuration
│   ├── initial-markets.ts        # Market seed entries for PairRegistry
│   └── default-risk.ts           # Default risk parameters
│
├── docs/                         # Architecture documentation
│   ├── ARCHITECTURE.md           # (this file)
│   ├── SECURITY_CHECKLIST.md
│   ├── TESTING_PLAN.md
│   └── FRONTEND_REQUIREMENTS.md
│
└── scripts/                      # Utility scripts
    └── (future: seed scripts, migration scripts)
```

---

## 4. On-Chain Contract Blueprint

### 4.1 PairRegistry (Phase 0)
Central pair identity registry. All market resolution begins here.

| Method | Access | Description |
|--------|--------|-------------|
| `registerPair` | ADMIN | Create new pair |
| `updatePairConfig` | ADMIN | Modify pair settings |
| `setPairStatus` | ADMIN/OPERATOR | Pause/enable pair |
| `linkExternalSource` | ADMIN | Link external venue |
| `getPair` | PUBLIC | Read pair metadata |
| `listPairs` | PUBLIC | List all pairs |

**Key invariants:**
- PairId is deterministic hash of base+quote
- NATIVE mode requires localPoolId or localBookId
- SYNTHETIC mode requires syntheticAssetId
- PAUSED pairs reject new quotes and executions

### 4.2 RiskConfig (Phase 0)
Protocol-wide and per-market risk parameters.

| Method | Access | Description |
|--------|--------|-------------|
| `setGlobalConfig` | RISK_ADMIN | Global limits |
| `setMarketConfig` | RISK_ADMIN | Per-market limits |
| `triggerEmergencyPause` | OPERATOR | Halt everything |
| `setCircuitBreaker` | OPERATOR/RISK_ADMIN | Trip/reset breakers |
| `getGlobalConfig` | PUBLIC | Read global config |

**Key invariants:**
- Emergency pause overrides everything
- Per-market limits can only be MORE restrictive than global
- Circuit breakers escalate freely; de-escalation requires RISK_ADMIN

### 4.3 ExecutionEscrow (Phase 0 skeleton, Phase 2 live)
User fund safety for relayer-backed routes.

| Method | Access | Description |
|--------|--------|-------------|
| `deposit` | PUBLIC | Create escrow + lock funds |
| `claimRefund` | PUBLIC | Refund after timeout/failure |
| `submitFillAttestation` | RELAYER | Prove external fill |
| `finalize` | SETTLEMENT | Complete escrow |
| `markFailed` | SETTLEMENT | Mark failure |
| `forceRefund` | OPERATOR | Emergency refund |

**Key invariants:**
- Each executionId used exactly once (nonce-based replay protection)
- Funds leave only via finalize XOR refund, never both
- Refund requires EXPIRED or FAILED status
- Finalize requires valid FillAttestation from allowed relayer

### 4.4 SyntheticAssetFactory (Phase 3)
Define and manage synthetic assets with restricted mint/burn.

### 4.5 SyntheticVault (Phase 3)
Backing/liability accounting. Protocol balance sheet.

### 4.6 SyntheticAMM (Phase 4)
Local AMM pools for synthetic asset trading.

### 4.7 RedemptionRouter (Phase 3+)
Burn-and-redeem flow for redeemable synthetics.

Full interface specifications are in `contracts/dcc-contracts/src/`.

---

## 5. Off-Chain Service Blueprint

### Service Dependency Graph

```
                                    ┌──────────────┐
                                    │  Frontend /   │
                                    │   API GW      │
                                    └──────┬───────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
     ┌────────▼─────────┐     ┌───────────▼──────────┐    ┌───────────▼──────────┐
     │  quote-engine     │     │  router-service       │    │  execution-service   │
     │  (stateless)      │     │  (plans routes)       │    │  (orchestrates)      │
     └────────┬─────────┘     └───────────┬──────────┘    └───────────┬──────────┘
              │                            │                            │
              │          ┌─────────────────┼────────────────┐          │
              │          │                 │                 │          │
     ┌────────▼─────────▼──┐              │     ┌──────────▼──────────▼─┐
     │  market-data-service │              │     │  relayer-service       │
     │  (ingests venues)    │              │     │  (fills externals)     │
     └──────────┬──────────┘              │     └──────────┬────────────┘
                │                          │                 │
     ┌──────────▼──────────┐              │     ┌──────────▼────────────┐
     │  Redis (pub/sub +   │              │     │  inventory-rebalancer  │
     │   snapshot cache)   │              │     └──────────┬────────────┘
     └─────────────────────┘              │                 │
                                          │     ┌──────────▼────────────┐
                               ┌──────────▼──┐  │  redemption-service   │
                               │ risk-monitor │  └──────────────────────┘
                               │   service    │
                               └─────────────┘
```

### Data Flow

1. **market-data-service** polls venue adapters → writes `VenueSnapshot` to Redis
2. **quote-engine** reads Redis snapshots → runs `@dcc/router-core` → returns `Quote`
3. **router-service** accepts quote + user intent → produces `RoutePlan`
4. **execution-service** receives `RoutePlan` → creates `ExecutionEscrow` on DCC → dispatches to relayer
5. **relayer-service** receives job → executes on external venue → submits `FillAttestation`
6. **execution-service** validates attestation → finalizes escrow → records completion
7. **risk-monitor-service** reads everything → trips circuit breakers when thresholds hit
8. **inventory-rebalancer** monitors balances → proposes rebalance operations

---

## 6. External Connector Design

All connectors implement `IVenueAdapter`:

```typescript
interface IVenueAdapter {
  getQuote(tokenIn, tokenOut, amountIn) → VenueQuote | null
  getRouteCandidates(tokenIn, tokenOut, amountIn) → VenueQuote[]
  getDepthEstimate(tokenIn, tokenOut, notional) → { availableSize, slippageBps }
  getMidPrice(tokenIn, tokenOut) → string | null
  getFreshness() → { lastUpdateMs, isStale }
  normalizeSymbol(venueSymbol) → string
  buildExecutionPayload(quote) → unknown
}
```

**Key design rules:**
- Adapters are pure data translators — no business logic
- All output is normalized to `VenueQuote` shape
- Staleness tracking is built into base class
- Symbol normalization maps venue-native identifiers to canonical symbols
- `buildExecutionPayload` is only used by relayer-service for actual execution

---

## 7. Domain Models

All models defined in `packages/types/src/` with Zod schemas for runtime validation.

### Key Entities & Invariants

| Entity | Key Fields | Invariant |
|--------|-----------|-----------|
| **Pair** | pairId, mode, status, riskTier, localPoolId, syntheticAssetId | PairId = hash(base, quote); mode determines required links |
| **Quote** | quoteId, legs[], confidenceScore, expiresAt | Expired quotes rejected; confidence 0 = stale |
| **RoutePlan** | routeId, legs[], score, requiresEscrow | Deterministic given same input snapshot |
| **ExecutionRecord** | executionId, status, nonce | Status follows strict state machine; nonce prevents replay |
| **SyntheticAsset** | syntheticAssetId, totalSupply, supplyCap, backingModel | totalSupply ≤ supplyCap always |
| **RedemptionRequest** | redemptionId, status | Failed redemption re-mints burned tokens |
| **FillAttestation** | executionId, relayerId, txHash, signature | Signed by relayer, verified by protocol |
| **VenueSnapshot** | venueId, midPrice, freshness, isStale | Snapshots expire per maxStalenessMs |
| **InventoryPosition** | assetId, chain, balance, available | available = balance - reservedForExecutions |

---

## 8. API Design

### Endpoint Summary

| Method | Path | Auth | Service | Phase |
|--------|------|------|---------|-------|
| GET | `/markets` | PUBLIC | router-service | 0 |
| GET | `/markets/:pairId` | PUBLIC | router-service | 0 |
| GET | `/markets/:pairId/depth` | PUBLIC | market-data-service | 1 |
| GET | `/quote` | PUBLIC (rate-limited) | quote-engine | 1 |
| POST | `/route/plan` | USER | router-service | 1 |
| POST | `/route/execute` | USER (signed) | execution-service | 2 |
| GET | `/execution/:id` | PUBLIC | execution-service | 2 |
| POST | `/redeem` | USER (signed) | redemption-service | 3 |
| GET | `/redeem/:id` | PUBLIC | redemption-service | 3 |
| GET | `/risk/status` | OPERATOR | risk-monitor-service | 1 |
| GET | `/inventory/status` | OPERATOR | inventory-rebalancer | 2 |

Full request/response schemas are in `packages/api-spec/src/`.

---

## 9. Router Logic and Pseudocode

The router is implemented in `packages/router-core/src/router.ts` as a pure-function pipeline:

```
runRouter(input) →
  1. discoverCandidates(pair, venues, request)     → RouteCandidate[]
  2. scoreCandidates(candidates, weights, risk)    → ScoredRoute[]
  3. applyRiskFilters(scored, globalRisk, ...)     → ScoredRoute[] (filtered)
  4. selectRoute(filtered, safetyPreference)       → ScoredRoute | null
  5. buildQuote(selected, request, pair, ...)      → Quote
```

### Discover Candidates
Enumerates all possible route structures:
1. **LOCAL**: Direct AMM or orderbook fill (if pair has local venue)
2. **SYNTHETIC**: Mint synthetic asset (if pair has synthetic link)
3. **TELEPORT (hub-routed)**: Input → USDC (local) → Output (external venue)
4. **TELEPORT (direct)**: USDC → Output (single external leg)

### Score Candidates
Deterministic scoring across 5 dimensions:
- **Output** (35%): Normalized output amount
- **Settlement** (20%): LOCAL=1.0, SYNTHETIC=0.8, TELEPORT=0.5
- **Fees** (15%): Normalized total fees (lower = better)
- **Slippage** (15%): Worst-case slippage across legs
- **Freshness** (15%): Venue data freshness

### Risk Filters (in order)
1. Emergency pause → reject all
2. Market circuit breaker → reject
3. Max trade size → reject
4. Daily volume limit → reject
5. Stale quote → remove stale candidates
6. Max open executions → reject
7. Relayer inventory → reject teleport if insufficient
8. Synthetic cap → reject synthetic if supply cap exceeded

### Safety Preference
If TELEPORT wins but LOCAL is within threshold → prefer LOCAL.

**Critical invariant:** Same input → same output. No randomness.

---

## 10. Synthetic Asset Design

### Pricing
Synthetic assets (sSOL, sETH, sBTC) are priced by **external oracle sources**:
- sSOL: Jupiter mid-price for SOL/USDC
- sETH: Uniswap mid-price for ETH/USDC
- sBTC: Uniswap mid-price for WBTC/USDC

Each synthetic has 1+ oracle sources with weights and max staleness. The weighted median is used. If all sources are stale, the synthetic is unquotable.

### Backing Model (v1): INVENTORY_BACKED
The protocol holds USDC reserves equal to (or exceeding) the mark-to-market value of all outstanding synthetics.

**How it works:**
- When user buys sSOL with USDC: protocol mints sSOL, receives USDC into vault
- The vault's USDC balance is the "backing" for all synth liabilities
- `backingRatio = totalUSDCReserves / totalSynthLiabilityAtMark`
- Target: backingRatio ≥ 1.0 (100%)
- If backingRatio drops below 0.9 (90%): SOFT_PAUSE on new mints
- If backingRatio drops below 0.8 (80%): HARD_PAUSE on all synth operations

**Why not overcollateralized?** Requires governance, liquidation engines, and price oracles with 0 downtime. Too complex for v1.

**Why not algorithmic?** Fragile peg history (UST). Not appropriate for a new chain.

### Supply Caps
Each synthetic has a hard supply cap enforced on-chain:
- sSOL: start at $200,000 notional equivalent
- sETH: start at $200,000
- sBTC: start at $100,000
Caps increase as trust and reserves grow.

### Redemption
Redeemable synthetics can be burned for underlying delivery:
1. User calls RedemptionRouter.requestRedemption → burns sSOL
2. Redemption request is queued
3. redemption-service picks it up and fulfills:
   a. From protocol SOL inventory (instant)
   b. Via relayer buy on Jupiter (delayed)
   c. Deferred queue if neither available
4. On completion: mark delivered
5. On failure: RE-MINT the burned tokens back to user

### Not in v1
- Users cannot mint their own synthetics (only protocol)
- No leverage, no margin
- No synthetic orderbook (Phase 4)

---

## 11. Execution / Settlement Flows

### Flow 1: Local-Only Swap (e.g., DCC/USDC on DCC AMM)

```
User → Frontend → quote-engine: GET /quote?pair=DCC/USDC&side=SELL&amount=100
      ← Quote (mode=LOCAL, 1 leg: DCC AMM)

User → Frontend → router-service: POST /route/plan { quoteId }
      ← RoutePlan (mode=LOCAL, no escrow)

User signs intent → execution-service: POST /route/execute { routeId, signature }
      execution-service → DCC AMM: swap(DCC → USDC)
      ← ExecutionRecord (status=FILLED, immediate)
```

**Settlement time:** 1 DCC block (~seconds)

### Flow 2: Synthetic Swap (e.g., Buy sSOL with USDC)

```
User → quote-engine: GET /quote?pair=USDC/sSOL&side=BUY&amount=100
      ← Quote (mode=SYNTHETIC, 1 leg: synthetic mint)

User → router-service: POST /route/plan { quoteId }
      ← RoutePlan (mode=SYNTHETIC)

User signs → execution-service: POST /route/execute { routeId, signature }
      execution-service → SyntheticVault: check backing + cap
      execution-service → SyntheticAssetFactory: mint(sSOL, user, amount)
      execution-service → SyntheticVault: recordMint(sSOL, amount, price)
      User receives sSOL on DCC
      ← ExecutionRecord (status=FILLED)
```

**Settlement time:** 1 DCC block

### Flow 3: Teleport Swap (e.g., DCC → SOL)

```
User → quote-engine: GET /quote?pair=DCC/SOL&side=SELL&amount=1000
      ← Quote (mode=TELEPORT, 2 legs: DCC→USDC local + USDC→SOL Jupiter)

User → router-service: POST /route/plan { quoteId, destinationAddress: "So1...", destinationChain: "solana" }
      ← RoutePlan (requiresEscrow=true, estimatedSettlementMs=120000)

User signs → execution-service: POST /route/execute { routeId, signature, nonce }
  1. execution-service validates nonce + signature
  2. execution-service → DCC AMM: swap DCC → USDC (leg 0, local)
  3. execution-service → ExecutionEscrow: deposit(USDC, amount, expiresAt)
  4. execution-service → relayer-service: dispatch job { executionId, leg 1: USDC→SOL via Jupiter }
  5. relayer-service → Jupiter: buildExecutionPayload → submit Solana transaction
  6. relayer-service → ExecutionEscrow: submitFillAttestation
  7. execution-service → validates attestation (checks Solana tx)
  8. execution-service → ExecutionEscrow: finalize
  9. ← ExecutionRecord (status=FILLED)
```

**Settlement time:** ~30s-2min (Solana confirmation)

**Failure path:**
- If relayer doesn't fill within escrowTimeout:
  - Escrow status → EXPIRED
  - User calls claimRefund → gets USDC back
  - Leg 0 (DCC→USDC) is NOT reversed; user holds USDC

### Flow 4: Redemption Flow (e.g., Redeem sSOL → SOL)

```
User holds sSOL → Frontend → POST /redeem
  { syntheticAssetId: "sSOL", amount: "10", destinationAddress: "So1...", destinationChain: "solana" }

  1. redemption-service → RedemptionRouter: requestRedemption
     - Burns 10 sSOL from user
     - Creates redemption record (QUEUED)

  2. redemption-service checks fulfillment options:
     a. Protocol has SOL inventory on Solana? → transfer directly
     b. No inventory? → relayer-service: buy SOL on Jupiter, deliver to user

  3. On success: RedemptionRouter.markCompleted(redemptionId, deliveredAmount, txHash)
  4. On failure: RedemptionRouter.markFailed(redemptionId, reason)
     → RE-MINTS 10 sSOL back to user
```

**Settlement time:** seconds (inventory) to minutes (relay buy)

---

## 12. Risk Model

### Per-Asset Caps (v1)

| Synthetic | Supply Cap (notional) | Max Single Trade |
|-----------|----------------------|-----------------|
| sSOL | $200,000 | $10,000 |
| sETH | $200,000 | $10,000 |
| sBTC | $100,000 | $5,000 |
| sBONK | $50,000 | $2,000 |

### Per-Route Caps

| Route Type | Max Per-Trade | Max Daily Volume |
|------------|--------------|-----------------|
| Local (DCC/USDC) | $50,000 | $1,000,000 |
| Teleport (DCC→SOL) | $10,000 | $200,000 |
| Teleport (USDC→ETH) | $25,000 | $500,000 |

### Stale Quote Threshold
- Global: 30 seconds
- Per-venue override: Jupiter 10s, Uniswap 15s, Raydium 10s
- If ALL sources for a pair are stale → reject quotes entirely
- If SOME are stale → exclude stale sources, log warning

### Relayer Inventory Threshold
- Max relayer notional exposure: $100,000
- If exposure > 80% → warn, slow-mode routing
- If exposure > 95% → reject new teleport routes

### Max Synthetic Exposure
- Total outstanding synth liability: $1,000,000
- Per-synth caps as above
- Backing ratio floor: 80% (hard pause triggers)

### Circuit Breakers

| Trigger | Level | Effect |
|---------|-------|--------|
| Venue stale > 60s | SOFT_PAUSE per-market | No new quotes for affected pairs |
| Relayer failed 3x in 1h | SOFT_PAUSE teleport routes | Teleport disabled; local/synth continue |
| Backing ratio < 90% | SOFT_PAUSE synth mints | No new synth mints; burns OK |
| Backing ratio < 80% | HARD_PAUSE synthetics | All synth ops frozen |
| Global emergency | HARD_PAUSE global | Everything frozen; admin only |

### Quote Confidence Score
- Based on: freshness of underlying venue data, number of confirmable sources
- Range: [0, 1]
- Quotes with confidence < 0.3 are rejected
- Frontend displays confidence as color indicator

### Settlement SLA / Timeout Handling
- Default escrow timeout: 5 minutes
- Max escrow timeout: 15 minutes
- If not finalized within timeout → auto-refundable by user
- execution-service also runs a sweeper that marks expired escrows

### Replay Protection
- User nonce per address, strictly monotonic
- ExecutionEscrow enforces: nonce == user.currentNonce + 1
- Prevents double-spend on same execution intent

### Partial Fill Behavior (v1: NOT supported)
- In v1, all fills are all-or-nothing
- Partial fills add complexity (multiple attestations, accounting)
- Deferred to Phase 6

### Failure Escalation
1. Route failure → log + increment failure counter
2. Relayer failure → alert ops + SOFT_PAUSE if repeated
3. Escrow timeout → auto-refund available
4. Backing ratio breach → SOFT/HARD_PAUSE
5. Emergency → admin triggers global HARD_PAUSE

---

## 13. Initial Market Launch Plan

| Pair | Mode | Phase | Rationale |
|------|------|-------|-----------|
| **DCC/USDC** | NATIVE | Phase 0 | Anchor pair; local AMM; both assets on DCC |
| **DCC/SOL** | TELEPORT | Phase 1 quote → Phase 2 live | High demand; hub-routed via Jupiter |
| **DCC/ETH** | TELEPORT | Phase 1 quote → Phase 2 live | High demand; hub-routed via Uniswap |
| **USDC/SOL** | TELEPORT | Phase 1 quote → Phase 2 live | Single-leg; direct hub→SOL |
| **USDC/ETH** | TELEPORT | Phase 1 quote → Phase 2 live | Single-leg; direct hub→ETH |
| **DCC/BTC** | SYNTHETIC | Phase 3 | No direct BTC bridge; sBTC is safest approach |
| **DCC/sSOL** | SYNTHETIC | Phase 3 | Synthetic SOL for local DCC trading |
| **DCC/sETH** | SYNTHETIC | Phase 3 | Synthetic ETH for local DCC trading |
| **DCC/sBTC** | SYNTHETIC | Phase 3 | Synthetic BTC |
| **DCC/sBONK** | SYNTHETIC | Phase 5 | Long-tail; low caps |
| **DCC/sWIF** | SYNTHETIC | Phase 5 | Long-tail; low caps |

**Deferred:**
- Open relayer/MM markets → Phase 6
- Redeemable BONK/WIF → Phase 5+ (synthetic-only first)
- sSOL/sBTC/sETH AMM pools → Phase 4

---

## 14. Phase-by-Phase Implementation Roadmap

### Phase 0 — Foundation
**Goals:** Core infrastructure, pair registry, risk config, escrow skeleton
**Contracts:** PairRegistry, RiskConfig, ExecutionEscrow (skeleton)
**Services:** market-data-service (scaffold), risk-monitor-service (scaffold)
**Packages:** @dcc/types, @dcc/config, @dcc/connectors (base), @dcc/api-spec
**Test:** Unit tests for types, config validation, adapter interfaces
**Security:** Review PairRegistry and RiskConfig access controls
**Gate:** All packages build, type-check, and pass unit tests

### Phase 1 — Global Quote Router
**Goals:** Live external quotes, unified quote API, route comparison
**Contracts:** None new (use Phase 0 contracts)
**Services:** market-data-service (live polling), quote-engine (live), router-service (quote-only mode)
**Packages:** @dcc/connectors (Jupiter, Raydium, Uniswap HTTP implementations), @dcc/router-core (full scoring)
**Frontend:** Quote page showing multi-source prices, mode labels, depth
**Test:** Integration tests for venue adapters, deterministic router tests, stale quote tests
**Security:** Rate limiting on quote API, input validation
**Gate:** Can serve live quotes for all Phase 1 pairs with >0.7 confidence score

### Phase 2 — Protocol-Run Relayer / Teleport Routing
**Goals:** Live cross-chain execution for initial routes
**Contracts:** ExecutionEscrow (live), escrow deployment + testing
**Services:** execution-service (full lifecycle), relayer-service (live), inventory-rebalancer (basic)
**Frontend:** Execution flow, escrow status tracking, refund UI
**Test:** E2E execution tests, escrow timeout/refund tests, relayer failure tests
**Security:** Escrow audit, relayer key security review, replay protection verification
**Gate:** Successfully execute DCC→SOL and USDC→ETH with real settlement

### Phase 3 — Synthetic Assets
**Goals:** sSOL, sETH, sBTC issuance and trading
**Contracts:** SyntheticAssetFactory, SyntheticVault, RedemptionRouter
**Services:** redemption-service (basic)
**Frontend:** Synthetic asset pages, backing ratio display, redemption UI
**Test:** Synthetic cap tests, backing ratio tests, oracle staleness tests
**Security:** Synthetic factory audit, vault accounting audit, oracle manipulation review
**Gate:** Can mint/burn sSOL with correct backing ratio tracking

### Phase 4 — Synthetic AMM + Orderbook
**Goals:** Local pools for synthetic assets
**Contracts:** SyntheticAMM
**Services:** DCC AMM adapter integration
**Test:** Pool invariant tests, virtual liquidity tests, fee accounting
**Security:** AMM audit (constant product, rounding, fee extraction)
**Gate:** Functional DCC/sSOL pool with LP management

### Phase 5 — Long-Tail Assets
**Goals:** sBONK, sWIF, framework for new synthetics
**Contracts:** Use existing SyntheticAssetFactory
**Services:** Listing framework, TIER_3 risk config
**Test:** Fuzz tests on listing flow, cap enforcement under load
**Security:** Governance review for new asset listing process
**Gate:** sBONK listed with proper caps and monitoring

### Phase 6 — Open Liquidity Network
**Goals:** Third-party relayers, route auctions, fee sharing
**Contracts:** Extended relayer registration, auction module
**Services:** Relayer registration, route auction engine
**Test:** Adversarial relayer tests, multi-relayer selection tests
**Security:** Full protocol audit, relayer trust model review
**Gate:** Third-party relayer successfully completes fills

---

## 15. Testing Plan

### Unit Tests
- All Zod schemas validate correct/incorrect inputs
- Router scoring is deterministic (property-based tests)
- Venue adapters normalize symbols correctly
- Config parsing rejects invalid env vars
- State machine transitions are correct for Execution/Redemption

### Integration Tests
- market-data-service → Redis → quote-engine pipeline
- Venue adapter → real API (with recorded fixtures for CI)
- ExecutionEscrow deposit → fill → finalize lifecycle
- ExecutionEscrow deposit → timeout → refund lifecycle

### Deterministic Router Tests
- Given fixed venue snapshots + config → assert exact route selected
- Verify safety preference: when LOCAL is close to TELEPORT, LOCAL wins
- Verify stale quote filtering removes exactly the stale candidates

### Stale Quote Tests
- All venues stale → reject quote
- One venue stale, others fresh → serve quote from fresh sources only
- Venue goes stale mid-flight → risk monitor trips circuit breaker

### Relayer Failure Tests
- Relayer fails to fill → escrow expires → user refunds
- Relayer submits invalid attestation → finalize rejects
- Relayer exceeds max exposure → new routes rejected
- Relayer goes offline → heartbeat timeout → SOFT_PAUSE

### Escrow Refund Tests
- Timeout refund (user-initiated)
- Failure refund (settlement-initiated)
- Force refund (operator emergency)
- Double-refund attempt → revert

### Synthetic Cap Tests
- Mint up to cap → succeeds
- Mint beyond cap → revert
- Burn + re-mint → cap space restored
- Backing ratio drop → circuit breaker trips

### Load Tests
- 100 concurrent quote requests
- 10 concurrent executions across different routes
- Measure p99 latency for quote generation

### Fuzz Tests
- Random QuoteRequest inputs → router never panics
- Random venue snapshot combinations → scoring never produces NaN
- Random execution states → state machine never reaches invalid state

### Adversarial Route Manipulation Tests
- Manipulated venue price → risk filter catches stale/suspicious quote
- Rapid repeated execution intents → nonce enforcement
- Griefing via many small escrow deposits → cap enforcement

---

## 16. Security Checklist

### Contract Security
- [ ] PairRegistry: Only ADMIN can register/modify pairs
- [ ] RiskConfig: OPERATOR can only escalate circuit breakers, not de-escalate
- [ ] ExecutionEscrow: Funds exit only via finalize XOR refund
- [ ] ExecutionEscrow: Nonce strictly monotonic, replay impossible
- [ ] ExecutionEscrow: Timeout refund works even if relayer disappears
- [ ] SyntheticAssetFactory: Only MINT_ROLE modules can mint/burn
- [ ] SyntheticVault: Backing ratio floor prevents over-withdrawal
- [ ] SyntheticVault: Mark price must be non-stale
- [ ] RedemptionRouter: Failed redemption re-mints to user

### Relayer Trust Assumptions
- [ ] Relayer is protocol-run (centralized) in v1 — documented
- [ ] Relayer private keys stored securely (HSM or vault in prod)
- [ ] Relayer max exposure capped per RiskConfig
- [ ] Relayer fill attestation is verifiable (Solana/ETH tx hash)
- [ ] Users can refund without relayer cooperation (timeout path)

### Stale External Price Attack
- [ ] All venue data has freshness timestamp + confidence score
- [ ] Stale quotes are rejected at quote-engine level
- [ ] Risk monitor continually checks venue freshness
- [ ] Circuit breaker trips on prolonged staleness

### Griefing on Execution Requests
- [ ] Users must send real funds to create escrow (not free)
- [ ] Rate limiting on quote and execution endpoints
- [ ] Max open executions per market limits concurrent orders

### Double-Finalization Prevention
- [ ] ExecutionEscrow finalize is idempotent and single-use
- [ ] Once FILLED, no further transitions possible
- [ ] FillAttestation can only be submitted once per executionId

### Replay Protection
- [ ] User nonce is strictly monotonic in ExecutionEscrow
- [ ] Execution ID is globally unique (UUIDv4)
- [ ] Quote ID is unique and expires quickly

### Refund Safety
- [ ] Refund returns EXACT deposited input asset and amount
- [ ] Refund only possible from EXPIRED or FAILED states
- [ ] No partial refund (all-or-nothing in v1)

### Synthetic Insolvency Prevention
- [ ] Supply caps enforced on-chain
- [ ] Backing ratio monitored continuously
- [ ] Below-threshold backing triggers pause
- [ ] Protocol can only mint if backing ratio stays above floor

### Admin Key Risk
- [ ] ADMIN_ROLE keys are multisig
- [ ] OPERATOR_ROLE keys are separate from ADMIN
- [ ] RISK_ADMIN_ROLE keys are separate from protocol admin
- [ ] Key rotation procedures documented

### Pause / Recovery Procedures
- [ ] Emergency pause documented with runbook
- [ ] Pause allows refunds and in-flight completion
- [ ] Recovery requires multi-party consensus (RISK_ADMIN)
- [ ] Test HARD_PAUSE → verify all operations halt except refund

---

## 17. Frontend UX / Market Mode Design

### Market Mode Labels
Each market on the frontend displays a clear mode badge:

| Mode | Badge | Color | Description |
|------|-------|-------|-------------|
| NATIVE | "Native" | Green | Fully on-chain DCC swap |
| SYNTHETIC | "Synthetic" | Blue | DCC synthetic asset |
| TELEPORT | "Teleport" | Purple | Cross-chain via relayer |
| REDEEMABLE | "Redeemable" | Gold | Redeemable synthetic |
| QUOTE_ONLY | "Preview" | Gray | Quote available, no execution yet |

### Quote Display Requirements
For every quote shown to the user, display:

1. **Route visualization**: visual leg-by-leg diagram
2. **Settlement mode**: e.g., "Settled via DCC AMM" or "Relayer delivery to Solana"
3. **Price source(s)**: e.g., "Jupiter + DCC AMM"
4. **Expected delivery**: "Instant" / "~2 minutes"
5. **Fee breakdown**: protocol fee, venue fees, total
6. **Confidence indicator**: green/yellow/red based on confidenceScore
7. **Risk warning** (if applicable):
   - Synthetic: "This is a synthetic asset, not the real asset"
   - Teleport: "Delivery via protocol relayer; refund available after 5 min timeout"
   - Redeemable: "Can be redeemed for real SOL later; redemption may take time"
   - Low confidence: "Quote may be stale; price may differ at execution"

### Execution Status Page
Show real-time execution status:
- PENDING → ACCEPTED → "Waiting for fill..." → FILLED → "Complete"
- With estimated time remaining
- Refund button visible after timeout

### Synthetic Portfolio View
- Show user's synthetic holdings with mark-to-market value
- Show global backing ratio for each synthetic
- Redemption button (if redeemable)
- Warning if backing ratio is approaching threshold

---

## 18. DevOps / Config / Environments

### Environment Layout

| Environment | DCC Node | External Venues | Database | Redis |
|-------------|----------|-----------------|----------|-------|
| **local** | DCC devnet (localhost) | Mock/recorded | Docker Postgres | Docker Redis |
| **testnet** | DCC testnet | Live APIs (rate-limited) | Managed Postgres | Managed Redis |
| **production** | DCC mainnet | Live APIs | Managed Postgres (HA) | Managed Redis (HA) |

### Secret Management
- **Local:** `.env.local` (gitignored)
- **Testnet/Prod:** Secrets manager (AWS SSM, Vault, etc.)
- **Relayer keys:** Hardware signer or HSM in production

### Per-Service Config
Each service reads from:
1. Shared `@dcc/config` schemas (Zod-validated from env)
2. Service-specific env vars (PORT, etc.)
3. Runtime config from Redis/DB for dynamic parameters

### Simulation Fixtures
- `config/initial-markets.ts`: seed markets for PairRegistry
- `config/default-risk.ts`: default risk parameters
- Recorded API responses from Jupiter/Raydium/Uniswap for offline tests
- Deterministic venue snapshot fixtures for router testing

### Docker Compose
- PostgreSQL 16 for durable state
- Redis 7 for cache + pub/sub
- Future: add service containers for full local stack

---

## 19. Open Questions / Tradeoffs

### Q1: DCC Contract Language
The contract interfaces are defined in TypeScript, but actual on-chain contracts depend on DCC's VM. If DCC supports Rust/WASM, the interfaces translate directly. If it has a custom VM, an adaptation layer is needed.

### Q2: Oracle Strategy for Synthetics
v1 uses venue API mid-prices as "oracles." This is acceptable for a centralized protocol but has latency and manipulation risks. A proper oracle network (Pyth, Chainlink, or DCC-native) should replace this in v2.

### Q3: Partial Fills
v1 is all-or-nothing. Partial fills are important for large orders but add escrow accounting complexity. Recommended for Phase 4+.

### Q4: MEV / Frontrunning
On DCC, if block producers can reorder transactions, escrow deposits could be frontrun. Mitigation: include a commit-reveal scheme or use DCC's ordering guarantees (if any).

### Q5: Relayer Liveness
If the single protocol relayer goes down, all teleport routes halt. Mitigation: quick failover to backup relayer instance + generous escrow timeout for user safety. Phase 6 adds multiple relayers.

### Q6: Synthetic Token Standard
Synthetic tokens need to be ERC20-like on DCC. The standard depends on DCC's token framework.

### Q7: Fee Model
Not specified in detail. Needs: protocol fee (% of trade), venue passthrough fees, relayer tip. Recommend flat bps model in v1.

---

## 20. Recommended Next Build Order

The immediate next engineering steps, in order:

1. **Install dependencies and verify monorepo builds**
   - `pnpm install && pnpm build`

2. **Implement venue adapter HTTP clients** (Phase 1)
   - Jupiter: fetch quotes from `/quote` endpoint
   - Uniswap: fetch quotes from routing API
   - Write recorded-response fixtures for CI

3. **Implement market-data-service polling** (Phase 1)
   - Periodic poll → normalize → write to Redis
   - Freshness tracking + stale detection

4. **Implement router-core scoring** (Phase 1)
   - `discoverCandidates` fully implemented
   - `scoreCandidates` with deterministic tests
   - `applyRiskFilters` with all checks

5. **Implement quote-engine HTTP server** (Phase 1)
   - Fastify server, `GET /quote` endpoint
   - Reads from Redis, runs router pipeline

6. **Deploy PairRegistry + RiskConfig on DCC testnet** (Phase 0)
   - Actual on-chain contract deployment
   - Seed initial markets

7. **Implement ExecutionEscrow on DCC testnet** (Phase 2)
   - Deposit/finalize/refund lifecycle
   - Nonce enforcement

8. **Implement relayer-service** (Phase 2)
   - Job consumer, Jupiter/Uniswap execution
   - Fill attestation submission

9. **Implement execution-service** (Phase 2)
   - Full lifecycle orchestration
   - Escrow integration
   - Relayer dispatch

10. **Launch Phase 2 on testnet**
    - DCC→SOL, USDC→ETH live routes
    - Monitor, load test, security review
