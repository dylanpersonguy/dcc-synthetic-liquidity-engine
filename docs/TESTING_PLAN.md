# DCC Synthetic Liquidity Engine — Testing Plan

## Test Categories

### 1. Unit Tests

**@dcc/types**
- All Zod schemas accept valid inputs and reject invalid inputs
- Branded ID types enforce compile-time uniqueness
- Enum values are exhaustive
- DecimalString rejects non-numeric strings

**@dcc/config**
- `parseConfig` returns validated config for correct env vars
- `parseConfig` throws descriptive error for missing/invalid env vars
- Per-service config merges correctly with shared config

**@dcc/router-core**
- `discoverCandidates`: correct candidate generation for each market mode
- `scoreCandidates`: deterministic scoring given same input
- `applyRiskFilters`: each of the 8 risk checks tested individually
- `selectRoute`: safety preference selects LOCAL when within threshold
- `buildQuote`: output Quote shape matches schema

**@dcc/connectors**
- Symbol normalization maps venue symbols to canonical
- Staleness detection flags correctly after timeout
- `buildBaseQuote` calculates fees correctly

### 2. Integration Tests

**Market Data Pipeline**
- market-data-service polls adapter → writes VenueSnapshot to Redis
- quote-engine reads Redis → returns Quote via HTTP
- Stale snapshot in Redis → quote-engine returns low confidence

**Execution Lifecycle**
- escrow deposit → relayer fill → attestation → finalize → FILLED
- escrow deposit → timeout → refund → REFUNDED
- escrow deposit → invalid attestation → rejection

**Synthetic Lifecycle**
- mint sSOL → verify vault accounting updated
- mint beyond cap → verify rejection
- mint → backing ratio check → verify backing floor enforcement
- burn sSOL → verify supply decreased, cap space restored

**Redemption Lifecycle**
- burn sSOL → redemption queued → fulfilled → completed
- burn sSOL → redemption queued → failure → re-mint

### 3. Deterministic Router Tests

These tests verify the core invariant: **same input → same output**.

```
Test: "Fixed snapshots produce identical route"
  Given:
    - venueSnapshots: { jupiter: { SOL/USDC: 150.25 }, dcc-amm: { DCC/USDC: 0.05 } }
    - pair: DCC/SOL (TELEPORT mode)
    - amount: 1000 DCC
    - riskConfig: default
  Assert:
    - Route selected is TELEPORT with 2 legs
    - Score is exactly [expected_value]
    - Running again with identical input produces identical output

Test: "Safety preference chooses LOCAL over TELEPORT"
  Given:
    - LOCAL route score: 0.85
    - TELEPORT route score: 0.87
    - safetyThreshold: 0.05
  Assert:
    - LOCAL selected (within threshold, prefer simpler)

Test: "Safety preference allows TELEPORT when significantly better"
  Given:
    - LOCAL route score: 0.70
    - TELEPORT route score: 0.90
    - safetyThreshold: 0.05
  Assert:
    - TELEPORT selected (exceeds threshold)
```

### 4. Stale Quote Tests

```
Test: "All venues stale → reject quote"
  Given: all VenueSnapshots older than maxStalenessMs
  Assert: runRouter returns null / error

Test: "Partial stale → serve from fresh only"
  Given: Jupiter stale, Raydium fresh
  Assert: Quote uses Raydium data only

Test: "Mid-flight stale → circuit breaker"
  Given: venue goes stale during polling cycle
  Assert: risk-monitor-service triggers SOFT_PAUSE
```

### 5. Escrow Refund Tests

```
Test: "Timeout refund - user initiated"
  Given: escrow deposited, timeout elapsed, no fill
  Assert: user calls claimRefund → receives exact deposit amount

Test: "Failure refund - settlement initiated"
  Given: relayer reports failure → execution status = FAILED
  Assert: user calls claimRefund → receives exact deposit amount

Test: "Force refund - operator emergency"
  Given: operator calls forceRefund
  Assert: user receives funds regardless of state

Test: "Double refund → revert"
  Given: user already refunded
  Assert: second claimRefund reverts

Test: "Refund after finalize → revert"
  Given: execution already FILLED
  Assert: claimRefund reverts
```

### 6. Synthetic Cap Tests

```
Test: "Mint up to cap → succeeds"
  Assert: totalSupply == supplyCap after mint

Test: "Mint beyond cap → revert"
  Assert: transaction reverts with CAP_EXCEEDED

Test: "Burn restores cap space"
  Given: totalSupply at cap, burn 100
  Assert: new mint of 100 succeeds

Test: "Backing ratio triggers pause"
  Given: backingRatio drops below 0.9
  Assert: SOFT_PAUSE, new mints rejected
```

### 7. Load / Performance Tests

- 100 concurrent `GET /quote` requests → p99 < 200ms
- 10 concurrent `POST /route/execute` → all escrows created correctly
- market-data-service polling 5 venues at 1s interval → no missed cycles
- Redis pub/sub latency < 10ms for snapshot distribution
- Router scoring 50 candidates → < 50ms

### 8. Fuzz Tests

- Random `QuoteRequest` values → router never throws, always returns valid output or explicit rejection
- Random `VenueSnapshot` data → scoring never produces NaN/Infinity
- Random execution state transitions → state machine never reaches invalid state
- Random Zod schema inputs → validation never throws unhandled exception

### 9. Adversarial Scenario Tests

```
Test: "Manipulated venue price not accepted"
  Given: venue reports price 10x normal
  Assert: staleness + confidence checks reject or flag

Test: "Rapid execution intent replay"
  Given: user submits same nonce twice
  Assert: second attempt reverts

Test: "Escrow griefing via many small deposits"
  Given: user creates many minimum-value escrows
  Assert: max open executions per user enforced

Test: "Relayer submits attestation for wrong execution"
  Assert: attestation rejected, execution unchanged
```

## Test Infrastructure

### Framework
- **vitest** for all TypeScript tests
- Per-package test configuration via `vitest.config.ts`
- Shared test utilities in `packages/test-utils/` (future)

### Fixtures
- Recorded HTTP responses from Jupiter, Raydium, Uniswap (for CI)
- Deterministic VenueSnapshot fixtures for router tests
- Seed market data for integration tests

### CI Pipeline
```
pnpm install
pnpm typecheck    # tsc --noEmit for all packages
pnpm test         # vitest run for all packages
pnpm lint         # eslint + prettier check
```

### Coverage Requirements
- @dcc/router-core: >90% line coverage
- @dcc/types validators: 100% branch coverage on Zod schemas
- Contract interfaces: tested via integration tests against testnet
- Services: tested via integration tests with mocked adapters
