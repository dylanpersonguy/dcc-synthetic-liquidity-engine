# DCC Synthetic Liquidity Engine — Frontend Requirements

## Market Mode Display

### Mode Badges
Every market displayed in the UI must show a mode badge:

| Mode | Badge Text | Color | Tooltip |
|------|-----------|-------|---------|
| NATIVE | Native | `#22c55e` (green) | "Fully on-chain DCC swap" |
| SYNTHETIC | Synthetic | `#3b82f6` (blue) | "DCC synthetic asset backed by protocol reserves" |
| TELEPORT | Teleport | `#a855f7` (purple) | "Cross-chain delivery via protocol relayer" |
| REDEEMABLE | Redeemable | `#eab308` (gold) | "Redeemable for underlying asset" |
| QUOTE_ONLY | Preview | `#6b7280` (gray) | "Price preview only — execution coming soon" |

---

## Quote Display

When showing a quote to the user, the following information MUST be visible:

### Required Fields
1. **Route legs** — visual diagram showing each step (e.g., "DCC → USDC → SOL")
2. **Expected output** — amount user will receive
3. **Settlement mode** — "Instant (DCC AMM)" or "~2 min (Solana delivery)"
4. **Price source(s)** — which venues provided price data (Jupiter, DCC AMM, etc.)
5. **Fee breakdown** — protocol fee, venue fees, gas estimate, total
6. **Confidence indicator** — color-coded: green (>0.7), yellow (0.4-0.7), red (<0.4)

### Risk Warnings (contextual)
- **Synthetic mode**: "This is a synthetic asset representing [SOL]. It is backed by protocol reserves, not the real asset."
- **Teleport mode**: "Your trade will be settled via protocol relayer on [Solana]. If settlement fails, your escrowed funds are refundable after [5 minutes]."
- **Redeemable mode**: "This synthetic can be redeemed for real [SOL]. Redemption may take [minutes to hours] depending on availability."
- **Low confidence**: "Quote data may be stale. The execution price may differ from the quoted price."
- **Near cap**: "This synthetic asset is near its supply cap. Large orders may be partially rejected."

### Quote Expiration
- Display countdown showing remaining validity
- Auto-refresh quote when expired
- Disable "Execute" button when quote expired

---

## Execution Flow UI

### Status States
```
PENDING     → "Preparing your trade..."
ACCEPTED    → "Trade accepted, processing..."
ESCROWED    → "Funds escrowed, waiting for fill..." (Teleport only)
FILLING     → "Relayer executing on [Solana]..."
FILLED      → "Trade complete! ✓"
FAILED      → "Trade failed. Refund available."
EXPIRED     → "Trade timed out. Refund available."
REFUNDED    → "Funds refunded to your wallet."
```

### Progress Indicator
- Step-by-step progress bar showing current leg
- Estimated time remaining for teleport routes
- Real-time status polling (WebSocket or SSE preferred, fallback to polling)

### Refund UI
- Refund button visible when status is FAILED or EXPIRED
- Clear explanation: "Your escrowed [100 USDC] can be refunded to your DCC wallet"
- Transaction confirmation before executing refund
- Success confirmation with transaction link

---

## Market List Page

### Columns
| Column | Description |
|--------|-------------|
| Pair | Base/Quote with icons |
| Mode | Badge (Native/Synthetic/Teleport) |
| Price | Mid-price from best source |
| 24h Change | Percentage change |
| Source | Venue(s) providing price |
| Status | Active / Paused / Quote Only |

### Filters
- By mode (Native, Synthetic, Teleport, All)
- By status (Active, All)
- Search by asset name

### Sort
- By pair name, price, volume, mode

---

## Synthetic Portfolio View

### Holdings Table
| Column | Description |
|--------|-------------|
| Asset | sSOL, sETH, sBTC with icon |
| Balance | User's holding |
| Mark Value | Current USD value |
| Backing Ratio | Global backing % for this synthetic |
| Actions | Trade / Redeem (if redeemable) |

### Backing Ratio Display
- Green: >100%
- Yellow: 90-100%
- Orange: 80-90%
- Red: <80% (should be paused)
- Display as percentage with color bar

### Redemption Flow
1. User clicks "Redeem" on a redeemable synthetic
2. Enter amount and destination address + chain
3. Review: "Burn [10 sSOL] → Receive [~10 SOL] on Solana at [address]"
4. Confirm and sign transaction
5. Track redemption status (similar to execution flow)

---

## Risk Transparency

### Protocol Health Dashboard (public)
- Total synthetic liability (USD)
- Total backing reserves (USD)
- Global backing ratio
- Per-synthetic breakdown
- Circuit breaker status (all green / warnings)
- Relayer status (online/offline, last heartbeat)

### Per-Market Risk Display
- Current circuit breaker level (NONE / SOFT_PAUSE / HARD_PAUSE)
- Stale data warning if venue offline
- Volume caps (daily limit, remaining)
- Price confidence level

---

## Accessibility & Error Handling

### Error States
- Network error → retry prompt with clear message
- Quote unavailable → "Quotes temporarily unavailable for this pair"
- Market paused → "Trading paused for [pair]. [Reason if available]"
- Rate limited → "Too many requests. Please wait [X] seconds."
- Insufficient balance → "Insufficient [DCC] balance. You have [X], need [Y]."

### Loading States
- Skeleton loaders for market list and quotes
- Spinner for execution status
- Progress bar for multi-step operations

### Responsive Design
- Mobile-first layout
- Touch-friendly buttons for trade execution
- Compact mode badge display on small screens
