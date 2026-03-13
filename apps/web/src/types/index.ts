// ============================================================================
// Frontend Domain Types
// Optimized for UI consumption — maps cleanly to backend @dcc/types
// ============================================================================

// ── Enums ──────────────────────────────────────────────────────────────

export type MarketMode = 'native' | 'synthetic' | 'teleport' | 'redeemable';

export type VenueType =
  | 'dcc_amm'
  | 'dcc_orderbook'
  | 'jupiter'
  | 'raydium'
  | 'uniswap';

export type VenueHealth = 'healthy' | 'degraded' | 'down';

export type QuoteConfidence = 'high' | 'medium' | 'low';

export type ExecutionStatus =
  | 'quote_created'
  | 'route_locked'
  | 'local_leg_pending'
  | 'local_leg_complete'
  | 'external_leg_pending'
  | 'external_leg_complete'
  | 'awaiting_delivery'
  | 'completed'
  | 'partially_filled'
  | 'failed'
  | 'refunded'
  | 'expired';

export type MarketStatus = 'active' | 'quote_only' | 'paused' | 'disabled';

export type RiskTier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';

export type CircuitBreakerLevel = 'none' | 'soft_pause' | 'hard_pause';

// ── Core Entities ──────────────────────────────────────────────────────

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  logoUrl?: string;
  isSynthetic: boolean;
}

export interface MarketInfo {
  pairId: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  primaryMode: MarketMode;
  supportedModes: MarketMode[];
  status: MarketStatus;
  riskTier: RiskTier;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  localLiquidity: number;
  externalLiquidity: number;
  maxSafeRouteSize: number;
  sources: VenueSource[];
  circuitBreaker: CircuitBreakerLevel;
}

export interface VenueSource {
  venueId: string;
  venueType: VenueType;
  venueName: string;
  health: VenueHealth;
  lastQuoteAt: number;
  latencyMs: number;
  errorCount24h: number;
  enabled: boolean;
}

// ── Quote / Route ──────────────────────────────────────────────────────

export interface RouteLeg {
  index: number;
  venueId: string;
  venueName: string;
  venueType: VenueType;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  price: string;
  feeEstimate: string;
  slippageBps: number;
}

export interface QuoteResponse {
  quoteId: string;
  pairId: string;
  mode: MarketMode;
  side: 'buy' | 'sell';
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inputAmount: string;
  outputAmount: string;
  effectivePrice: string;
  legs: RouteLeg[];
  protocolFee: string;
  venueFees: string;
  totalFeeEstimate: string;
  estimatedSlippageBps: number;
  confidence: QuoteConfidence;
  confidenceScore: number;
  createdAt: number;
  expiresAt: number;
  estimatedSettlementMs: number;
  priceSources: string[];
  warnings: string[];
  maxSafeSize: string;
}

export interface RoutePlan {
  routeId: string;
  quoteId: string;
  pairId: string;
  mode: MarketMode;
  legs: RouteLeg[];
  requiresEscrow: boolean;
  estimatedSettlementMs: number;
}

// ── Execution ──────────────────────────────────────────────────────────

export interface ExecutionRecord {
  executionId: string;
  routeId: string;
  pairId: string;
  mode: MarketMode;
  status: ExecutionStatus;
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inputAmount: string;
  outputAmountEstimated: string;
  outputAmountActual?: string;
  legs: ExecutionLegStatus[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failureReason?: string;
  refundEligible: boolean;
  refundedAt?: number;
  escrowAddress?: string;
  escrowExpiresAt?: number;
  deliveryTxHash?: string;
  userAddress: string;
}

export interface ExecutionLegStatus {
  index: number;
  venueId: string;
  venueName: string;
  chain: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  confirmedAt?: number;
}

// ── Admin / Operator ───────────────────────────────────────────────────

export interface OperatorDashboardSummary {
  activeMarkets: number;
  pausedMarkets: number;
  totalMarkets: number;
  routeSuccessRate24h: number;
  totalExecutions24h: number;
  failedExecutions24h: number;
  pendingExecutions: number;
  relayerOnline: boolean;
  relayerInventoryUsd: number;
  syntheticExposureUsd: number;
  syntheticCapUtilization: number;
  staleQuoteAlerts: number;
  redemptionQueueSize: number;
  venueHealthSummary: Record<VenueType, VenueHealth>;
}

export interface RelayerStatus {
  relayerId: string;
  online: boolean;
  lastHeartbeat: number;
  chains: {
    chain: string;
    connected: boolean;
    balance: string;
    balanceUsd: number;
  }[];
  totalInventoryUsd: number;
  totalExposureUsd: number;
  recentFills: RecentFill[];
  failedJobs24h: number;
  avgLatencyMs: number;
}

export interface RecentFill {
  executionId: string;
  pairId: string;
  chain: string;
  amount: string;
  txHash: string;
  completedAt: number;
  latencyMs: number;
}

export interface RiskAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  details?: string;
  createdAt: number;
  acknowledged: boolean;
}

export interface MarketRiskInfo {
  pairId: string;
  circuitBreaker: CircuitBreakerLevel;
  maxTradeSize: number;
  maxDailyVolume: number;
  currentDailyVolume: number;
  staleSourceCount: number;
  totalSources: number;
  syntheticCapUsed?: number;
  syntheticCapTotal?: number;
}

export interface VenueHealthDetail {
  venueId: string;
  venueType: VenueType;
  venueName: string;
  health: VenueHealth;
  latencyMs: number;
  lastQuoteAt: number;
  errorCount24h: number;
  quotesServed24h: number;
  uptime24h: number;
  supportedPairs: string[];
}

// ── Synthetic Assets ───────────────────────────────────────────────────

export interface SyntheticAssetInfo {
  syntheticAssetId: string;
  symbol: string;
  name: string;
  underlyingSymbol: string;
  markPrice: number;
  change24h: number;
  totalSupply: number;
  supplyCap: number;
  backingRatio: number;
  mintFee: number;
  burnFee: number;
  status: 'ACTIVE' | 'PAUSED' | 'WIND_DOWN';
}

export interface SyntheticVaultState {
  totalBackingUsd: number;
  totalLiabilityUsd: number;
  backingRatio: number;
  assets: Record<string, {
    supply: number;
    markPrice: number;
    liabilityUsd: number;
    backingAllocatedUsd: number;
    utilization: number;
  }>;
  lastUpdated: number;
}

export interface MintRecord {
  mintId: string;
  userAddress: string;
  syntheticAssetId: string;
  symbol: string;
  collateralAmount: number;
  collateralAsset: string;
  mintedAmount: number;
  markPriceAtMint: number;
  feeAmount: number;
  status: 'completed' | 'pending' | 'failed';
  createdAt: number;
}

export interface BurnRecord {
  burnId: string;
  userAddress: string;
  syntheticAssetId: string;
  symbol: string;
  burnedAmount: number;
  collateralReturned: number;
  collateralAsset: string;
  markPriceAtBurn: number;
  feeAmount: number;
  status: 'completed' | 'pending' | 'failed';
  createdAt: number;
}

// ── Admin Synthetic Management ─────────────────────────────────────────

export type SyntheticBackingModel = 'INVENTORY_BACKED' | 'OVERCOLLATERALIZED';
export type SyntheticAssetStatus = 'ACTIVE' | 'PAUSED' | 'WIND_DOWN' | 'DISABLED';

export interface OracleSource {
  sourceId: string;
  providerId: string;
  providerName: string;
  coinId: string;
  weight: number;
  maxStalenessMs: number;
}

export interface AdminSyntheticAsset {
  syntheticAssetId: string;
  symbol: string;
  name: string;
  underlyingSymbol: string;
  underlyingAssetId: string;
  decimals: number;
  dccTokenId: string;
  backingModel: SyntheticBackingModel;
  backingAssetId: string;
  targetBackingRatio: number;
  totalSupply: number;
  supplyCap: number;
  isRedeemable: boolean;
  markPrice: number;
  change24h: number;
  mintFee: number;
  burnFee: number;
  riskTier: string;
  status: SyntheticAssetStatus;
  oracleSources: OracleSource[];
  createdAt: number;
}

export interface OracleProviderCoin {
  coinId: string;
  symbol: string;
  name: string;
}

export interface OracleProvider {
  providerId: string;
  providerName: string;
  description: string;
  apiType: 'rest' | 'websocket' | 'onchain';
  requiresApiKey: boolean;
  freeRateLimit: string;
  coins: OracleProviderCoin[];
}

export interface CreateSyntheticRequest {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  underlyingAssetId: string;
  decimals: number;
  backingModel: SyntheticBackingModel;
  backingAssetId: string;
  targetBackingRatio: number;
  supplyCap: number;
  isRedeemable: boolean;
  riskTier: string;
  mintFee: number;
  burnFee: number;
  oracleSources: Omit<OracleSource, 'sourceId'>[];
}

// ── Pool / AMM Types ──────────────────────────────────────────────────

export type PoolStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export interface LpPosition {
  address: string;
  lpTokens: string;
  sharePercent: number;
  seedAmountA: string;
  seedAmountB: string;
  seedTimestamp: number;
}

export interface AdminPool {
  poolId: string;
  tokenA: string;
  tokenASymbol: string;
  tokenB: string;
  tokenBSymbol: string;
  reserveA: string;
  reserveB: string;
  totalLpSupply: string;
  feeRateBps: number;
  protocolFeeShareBps: number;
  virtualLiquidityA: string;
  virtualLiquidityB: string;
  status: PoolStatus;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  apr: number;
  lpPositions: LpPosition[];
  createdAt: number;
}

export interface CreatePoolRequest {
  tokenA: string;
  tokenASymbol: string;
  tokenB: string;
  tokenBSymbol: string;
  initialAmountA: string;
  initialAmountB: string;
  feeRateBps: number;
  protocolFeeShareBps: number;
  virtualLiquidityA: string;
  virtualLiquidityB: string;
}

export interface AddLiquidityRequest {
  poolId: string;
  amountA: string;
  amountB: string;
  providerAddress: string;
}

export interface UpdatePoolConfigRequest {
  feeRateBps?: number;
  protocolFeeShareBps?: number;
  virtualLiquidityA?: string;
  virtualLiquidityB?: string;
}
