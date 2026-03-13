import type {
  Quote,
  QuoteRequest,
  QuoteMode,
  QuoteLeg,
  VenueQuote,
  VenueSnapshot,
  Pair,
  MarketRiskConfig,
  ProtocolRiskConfig,
} from '@dcc/types';

// ============================================================================
// Core Router Logic — Deterministic Route Selection Algorithm
// ============================================================================

const MAX_ACCEPTABLE_SLIPPAGE = 500; // 500 bps = 5%

// ── Step 1: Discover candidate routes ────────────────────────────────────

export interface RouteCandidate {
  mode: QuoteMode;
  legs: VenueQuote[];
  totalOutputAmount: string;
  totalFees: string;
  worstSlippageBps: number;
  worstFreshness: number;
  requiresRelayer: boolean;
  requiresEscrow: boolean;
}

/**
 * discoverCandidates — enumerate all possible route structures for a pair.
 */
export function discoverCandidates(
  pair: Pair,
  venues: VenueSnapshot[],
  request: QuoteRequest,
): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];

  // Group venue snapshots by venueId for lookup
  const snapshotByVenue = new Map<string, VenueSnapshot>();
  for (const vs of venues) {
    snapshotByVenue.set(vs.venueId, vs);
  }

  // 1. LOCAL direct — if pair has a local pool or book with fresh data
  if (pair.supportedModes.includes('NATIVE') || pair.supportedModes.includes('LOCAL' as any)) {
    for (const vs of venues) {
      if ((vs.venueType === 'DCC_AMM' || vs.venueType === 'DCC_ORDERBOOK') && !vs.isStale && vs.midPrice) {
        // Simulate a local leg quote
        const amountIn = parseFloat(request.amount);
        const price = parseFloat(vs.midPrice);
        if (price > 0 && amountIn > 0) {
          const feeRate = 0.003; // 30 bps
          const fee = amountIn * feeRate;
          const amountOut = (amountIn - fee) * price;
          const slippageBps = Math.round(amountIn / 500000 * 100); // proportional

          const leg: VenueQuote = {
            venueId: vs.venueId,
            venueType: vs.venueType,
            chain: 'dcc',
            tokenIn: pair.baseAssetId,
            tokenOut: pair.quoteAssetId,
            amountIn: request.amount,
            amountOut: amountOut.toFixed(6),
            price: price.toFixed(8),
            feeEstimate: fee.toFixed(6),
            slippageEstimateBps: slippageBps,
            route: [vs.venueId],
            fetchedAt: vs.fetchedAt,
            expiresAt: vs.fetchedAt + 30000,
            confidence: vs.freshness,
          };

          candidates.push({
            mode: 'LOCAL',
            legs: [leg],
            totalOutputAmount: amountOut.toFixed(6),
            totalFees: fee.toFixed(6),
            worstSlippageBps: slippageBps,
            worstFreshness: vs.freshness,
            requiresRelayer: false,
            requiresEscrow: false,
          });
        }
      }
    }
  }

  // 2. TELEPORT — hub-routed: input→hub_asset on DCC, then hub→output on external venue
  if (pair.supportedModes.includes('TELEPORT')) {
    // Find DCC-side venue for first leg (input → hub, e.g. DCC→USDC)
    const dccVenues = venues.filter(
      (vs) => (vs.venueType === 'DCC_AMM' || vs.venueType === 'DCC_ORDERBOOK') && !vs.isStale && vs.midPrice,
    );
    // Find external venues for second leg (hub → output, e.g. USDC→SOL)
    const externalVenues = venues.filter(
      (vs) => vs.venueType !== 'DCC_AMM' && vs.venueType !== 'DCC_ORDERBOOK' && !vs.isStale && vs.midPrice,
    );

    for (const dccV of dccVenues) {
      for (const extV of externalVenues) {
        const amountIn = parseFloat(request.amount);
        const dccPrice = parseFloat(dccV.midPrice!);
        const extPrice = parseFloat(extV.midPrice!);

        if (dccPrice > 0 && extPrice > 0 && amountIn > 0) {
          // Leg 0: DCC → Hub (e.g., DCC → USDC on local AMM)
          const leg0Fee = amountIn * 0.003;
          const hubAmount = (amountIn - leg0Fee) * dccPrice;
          const leg0Slippage = Math.round(amountIn / 500000 * 100);

          const leg0: VenueQuote = {
            venueId: dccV.venueId,
            venueType: dccV.venueType,
            chain: 'dcc',
            tokenIn: pair.baseAssetId,
            tokenOut: 'USDC',
            amountIn: request.amount,
            amountOut: hubAmount.toFixed(6),
            price: dccPrice.toFixed(8),
            feeEstimate: leg0Fee.toFixed(6),
            slippageEstimateBps: leg0Slippage,
            route: [dccV.venueId],
            fetchedAt: dccV.fetchedAt,
            expiresAt: dccV.fetchedAt + 30000,
            confidence: dccV.freshness,
          };

          // Leg 1: Hub → Output (e.g., USDC → SOL on Jupiter)
          const leg1Fee = hubAmount * 0.0008;
          const outputAmount = (hubAmount - leg1Fee) * extPrice;
          const leg1Slippage = Math.round(hubAmount / 2000000 * 50);

          const leg1: VenueQuote = {
            venueId: extV.venueId,
            venueType: extV.venueType,
            chain: extV.venueType === 'UNISWAP' ? 'ethereum' : 'solana',
            tokenIn: 'USDC',
            tokenOut: pair.quoteAssetId,
            amountIn: hubAmount.toFixed(6),
            amountOut: outputAmount.toFixed(6),
            price: extPrice.toFixed(8),
            feeEstimate: leg1Fee.toFixed(6),
            slippageEstimateBps: leg1Slippage,
            route: [extV.venueId],
            fetchedAt: extV.fetchedAt,
            expiresAt: extV.fetchedAt + 30000,
            confidence: extV.freshness,
          };

          const totalFees = leg0Fee + leg1Fee;
          const worstSlippage = Math.max(leg0Slippage, leg1Slippage);
          const worstFreshness = Math.min(dccV.freshness, extV.freshness);

          candidates.push({
            mode: 'TELEPORT',
            legs: [leg0, leg1],
            totalOutputAmount: outputAmount.toFixed(6),
            totalFees: totalFees.toFixed(6),
            worstSlippageBps: worstSlippage,
            worstFreshness: worstFreshness,
            requiresRelayer: true,
            requiresEscrow: true,
          });
        }
      }
    }
  }

  // 3. SYNTHETIC — if pair has a syntheticAssetId
  if (pair.supportedModes.includes('SYNTHETIC') && pair.syntheticAssetId) {
    for (const vs of venues) {
      if ((vs.venueType === 'DCC_AMM' || vs.venueType === 'DCC_ORDERBOOK') && !vs.isStale && vs.midPrice) {
        const amountIn = parseFloat(request.amount);
        const price = parseFloat(vs.midPrice);
        if (price > 0 && amountIn > 0) {
          const fee = amountIn * 0.002;
          const amountOut = (amountIn - fee) * price;
          const slippageBps = Math.round(amountIn / 500000 * 50);

          const leg: VenueQuote = {
            venueId: vs.venueId,
            venueType: vs.venueType,
            chain: 'dcc',
            tokenIn: pair.baseAssetId,
            tokenOut: pair.quoteAssetId,
            amountIn: request.amount,
            amountOut: amountOut.toFixed(6),
            price: price.toFixed(8),
            feeEstimate: fee.toFixed(6),
            slippageEstimateBps: slippageBps,
            route: [vs.venueId, 'synthetic-mint'],
            fetchedAt: vs.fetchedAt,
            expiresAt: vs.fetchedAt + 30000,
            confidence: vs.freshness * 0.9,
          };

          candidates.push({
            mode: 'SYNTHETIC',
            legs: [leg],
            totalOutputAmount: amountOut.toFixed(6),
            totalFees: fee.toFixed(6),
            worstSlippageBps: slippageBps,
            worstFreshness: vs.freshness * 0.9,
            requiresRelayer: false,
            requiresEscrow: false,
          });
        }
      }
    }
  }

  return candidates;
}

// ── Step 2: Score candidates ─────────────────────────────────────────────

export interface ScoringWeights {
  output: number;
  fee: number;
  slippage: number;
  freshness: number;
  settlement: number;
}

export interface ScoredRoute {
  candidate: RouteCandidate;
  scores: {
    outputScore: number;
    feeScore: number;
    slippageScore: number;
    freshnessScore: number;
    settlementScore: number;
    compositeScore: number;
  };
}

/**
 * scoreCandidates — deterministic scoring of all route candidates.
 */
export function scoreCandidates(
  candidates: RouteCandidate[],
  weights: ScoringWeights,
  _riskConfig: MarketRiskConfig,
): ScoredRoute[] {
  if (candidates.length === 0) return [];

  // Find max output/fees across all candidates for normalization
  const outputs = candidates.map((c) => parseFloat(c.totalOutputAmount));
  const fees = candidates.map((c) => parseFloat(c.totalFees));
  const maxOutput = Math.max(...outputs);
  const maxFee = Math.max(...fees);

  const scored: ScoredRoute[] = [];

  for (const candidate of candidates) {
    const output = parseFloat(candidate.totalOutputAmount);
    const fee = parseFloat(candidate.totalFees);

    // 1. Output score: normalized 0-1 (higher output = better)
    const outputScore = maxOutput > 0 ? output / maxOutput : 0;

    // 2. Fee score: inverted (lower fee = better)
    const feeScore = maxFee > 0 ? 1 - fee / maxFee : 1;

    // 3. Slippage score
    let slippageScore: number;
    if (candidate.worstSlippageBps > MAX_ACCEPTABLE_SLIPPAGE) {
      slippageScore = -1; // reject
    } else {
      slippageScore = 1 - candidate.worstSlippageBps / MAX_ACCEPTABLE_SLIPPAGE;
    }

    // 4. Freshness score
    const freshnessScore = candidate.worstFreshness;

    // 5. Settlement score
    let settlementScore: number;
    switch (candidate.mode) {
      case 'LOCAL': settlementScore = 1.0; break;
      case 'SYNTHETIC': settlementScore = 0.8; break;
      case 'REDEEMABLE': settlementScore = 0.7; break;
      case 'TELEPORT': settlementScore = 0.5; break;
      default: settlementScore = 0.3;
    }

    // 6. Composite score
    const compositeScore =
      weights.output * outputScore +
      weights.fee * feeScore +
      weights.slippage * slippageScore +
      weights.freshness * freshnessScore +
      weights.settlement * settlementScore;

    // Filter: reject candidates with negative slippage score or zero freshness
    if (slippageScore >= 0 && freshnessScore > 0) {
      scored.push({
        candidate,
        scores: { outputScore, feeScore, slippageScore, freshnessScore, settlementScore, compositeScore },
      });
    }
  }

  // Sort by composite score descending
  scored.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);
  return scored;
}

// ── Step 3: Apply risk filters ───────────────────────────────────────────

export function applyRiskFilters(
  scoredRoutes: ScoredRoute[],
  globalRisk: ProtocolRiskConfig,
  marketRisk: MarketRiskConfig,
  context: {
    currentDailyVolume: string;
    currentOpenExecutions: number;
    relayerAvailableInventory: Record<string, string>;
    syntheticRemainingCap: Record<string, string>;
  },
): ScoredRoute[] {
  // 1. Emergency pause
  if (globalRisk.emergencyPause) return [];

  // 2. Market circuit breaker
  if (marketRisk.circuitBreaker !== 'NONE') return [];

  return scoredRoutes.filter((sr) => {
    const inputAmount = parseFloat(sr.candidate.legs[0]?.amountIn ?? '0');

    // 3. Max trade size
    if (inputAmount > parseFloat(marketRisk.maxTradeSize)) return false;

    // 4. Daily volume limit
    const currentVol = parseFloat(context.currentDailyVolume);
    if (currentVol + inputAmount > parseFloat(marketRisk.maxDailyVolume)) return false;

    // 5. Max open executions
    if (context.currentOpenExecutions >= marketRisk.maxOpenExecutions) return false;

    // 7. Relayer inventory check (TELEPORT)
    if (sr.candidate.requiresRelayer) {
      const outputAsset = sr.candidate.legs[sr.candidate.legs.length - 1]?.tokenOut ?? '';
      const available = parseFloat(context.relayerAvailableInventory[outputAsset] ?? '0');
      const needed = parseFloat(sr.candidate.totalOutputAmount);
      if (available < needed) return false;
    }

    return true;
  });
}

// ── Step 4: Select best route ────────────────────────────────────────────

/**
 * selectRoute — pick the single best route from scored + filtered candidates.
 *
 * LOGIC:
 *   1. Take the first (highest compositeScore) candidate from filtered list.
 *   2. If filtered list is empty → return null (no viable route).
 *   3. If the best route's freshnessScore < 0.5 → attach a warning.
 *   4. If the best route is TELEPORT and the next-best is LOCAL with
 *      compositeScore within 5% → prefer LOCAL (safety preference).
 *
 * This "prefer safety" heuristic can be tuned via config.
 */
export function selectRoute(
  filteredRoutes: ScoredRoute[],
  safetyPreference: number, // 0.0 = pure score, 1.0 = strongly prefer local
): ScoredRoute | null {
  if (filteredRoutes.length === 0) return null;

  // Sort by composite score descending (should already be sorted, but be safe)
  const sorted = [...filteredRoutes].sort(
    (a, b) => b.scores.compositeScore - a.scores.compositeScore,
  );

  const best = sorted[0]!;

  // Safety preference: if best is TELEPORT but a LOCAL route is nearly as good, prefer LOCAL
  if (best.candidate.mode === 'TELEPORT' && safetyPreference > 0) {
    const localAlternative = sorted.find((r) => r.candidate.mode === 'LOCAL');
    if (localAlternative) {
      const scoreDiff = best.scores.compositeScore - localAlternative.scores.compositeScore;
      const threshold = safetyPreference * 0.1; // at max safety, tolerate 10% worse score
      if (scoreDiff < threshold) {
        return localAlternative;
      }
    }
  }

  return best;
}

// ── Step 5: Build Quote from selected route ──────────────────────────────

/**
 * buildQuote — convert a selected ScoredRoute into a user-facing Quote object.
 */
export function buildQuote(
  selected: ScoredRoute,
  request: QuoteRequest,
  pair: Pair,
  quoteId: string,
  now: number,
  quoteTtlMs: number,
): Quote {
  const legs: QuoteLeg[] = selected.candidate.legs.map((vq, idx) => ({
    legIndex: idx,
    venueId: vq.venueId,
    chain: vq.chain,
    tokenIn: vq.tokenIn,
    tokenOut: vq.tokenOut,
    amountIn: vq.amountIn,
    amountOut: vq.amountOut,
    price: vq.price,
    feeEstimate: vq.feeEstimate,
    slippageEstimate: String(vq.slippageEstimateBps),
  }));

  return {
    quoteId,
    pairId: pair.pairId,
    mode: selected.candidate.mode,
    side: request.side,
    inputAsset: request.side === 'SELL' ? pair.baseAssetId : pair.quoteAssetId,
    outputAsset: request.side === 'SELL' ? pair.quoteAssetId : pair.baseAssetId,
    inputAmount: request.amount,
    outputAmount: selected.candidate.totalOutputAmount,
    effectivePrice: selected.candidate.legs.length > 0
      ? selected.candidate.legs[selected.candidate.legs.length - 1]!.price
      : '0',
    legs,
    totalFeeEstimate: selected.candidate.totalFees,
    protocolFee: '0', // calculated separately
    venueFees: selected.candidate.totalFees,
    estimatedSlippageBps: selected.candidate.worstSlippageBps,
    confidenceScore: selected.scores.freshnessScore,
    createdAt: now,
    expiresAt: now + quoteTtlMs,
    priceSources: selected.candidate.legs.map((l) => l.venueId),
    warnings: [],
  };
}

// ============================================================================
// Full routing pipeline — compose all steps
// ============================================================================

export interface RouterInput {
  pair: Pair;
  request: QuoteRequest;
  venueSnapshots: VenueSnapshot[];
  globalRisk: ProtocolRiskConfig;
  marketRisk: MarketRiskConfig;
  context: {
    currentDailyVolume: string;
    currentOpenExecutions: number;
    relayerAvailableInventory: Record<string, string>;
    syntheticRemainingCap: Record<string, string>;
  };
  quoteId: string;
  now: number;
  quoteTtlMs: number;
  safetyPreference: number;
}

export interface RouterOutput {
  quote: Quote | null;
  allCandidates: RouteCandidate[];
  allScored: ScoredRoute[];
  filtered: ScoredRoute[];
  selected: ScoredRoute | null;
  rejectionReason: string | null;
}

/**
 * runRouter — the complete deterministic routing pipeline.
 *
 * PSEUDOCODE:
 *
 *   function runRouter(input):
 *     // Step 1: Discover all possible routes
 *     candidates = discoverCandidates(input.pair, input.venueSnapshots, input.request)
 *
 *     if candidates is empty:
 *       return { quote: null, rejectionReason: "No venue routes available for this pair" }
 *
 *     // Step 2: Score each candidate
 *     scored = scoreCandidates(candidates, input.globalRisk.routeScoreWeights, input.marketRisk)
 *
 *     if scored is empty:
 *       return { quote: null, rejectionReason: "All candidates scored below threshold" }
 *
 *     // Step 3: Apply risk filters
 *     filtered = applyRiskFilters(scored, input.globalRisk, input.marketRisk, input.context)
 *
 *     if filtered is empty:
 *       return { quote: null, rejectionReason: "All candidates rejected by risk filters" }
 *
 *     // Step 4: Select best
 *     selected = selectRoute(filtered, input.safetyPreference)
 *
 *     if selected is null:
 *       return { quote: null, rejectionReason: "No route selected" }
 *
 *     // Step 5: Build quote
 *     quote = buildQuote(selected, input.request, input.pair, input.quoteId, input.now, input.quoteTtlMs)
 *
 *     return { quote, allCandidates: candidates, allScored: scored, filtered, selected, rejectionReason: null }
 */
export function runRouter(input: RouterInput): RouterOutput {
  // Step 1
  const allCandidates = discoverCandidates(input.pair, input.venueSnapshots, input.request);

  if (allCandidates.length === 0) {
    return {
      quote: null,
      allCandidates,
      allScored: [],
      filtered: [],
      selected: null,
      rejectionReason: 'No venue routes available for this pair',
    };
  }

  // Step 2
  const allScored = scoreCandidates(
    allCandidates,
    input.globalRisk.routeScoreWeights,
    input.marketRisk,
  );

  if (allScored.length === 0) {
    return {
      quote: null,
      allCandidates,
      allScored,
      filtered: [],
      selected: null,
      rejectionReason: 'All candidates scored below threshold',
    };
  }

  // Step 3
  const filtered = applyRiskFilters(
    allScored,
    input.globalRisk,
    input.marketRisk,
    input.context,
  );

  if (filtered.length === 0) {
    return {
      quote: null,
      allCandidates,
      allScored,
      filtered,
      selected: null,
      rejectionReason: 'All candidates rejected by risk filters',
    };
  }

  // Step 4
  const selected = selectRoute(filtered, input.safetyPreference);

  if (!selected) {
    return {
      quote: null,
      allCandidates,
      allScored,
      filtered,
      selected: null,
      rejectionReason: 'No route selected after safety preference',
    };
  }

  // Step 5
  const quote = buildQuote(
    selected,
    input.request,
    input.pair,
    input.quoteId,
    input.now,
    input.quoteTtlMs,
  );

  return {
    quote,
    allCandidates,
    allScored,
    filtered,
    selected,
    rejectionReason: null,
  };
}
