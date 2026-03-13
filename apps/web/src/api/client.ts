// ============================================================================
// API Client — Production service integration
// ============================================================================

import type {
  MarketInfo,
  QuoteResponse,
  ExecutionRecord,
  OperatorDashboardSummary,
  RelayerStatus,
  RiskAlert,
  VenueHealthDetail,
  MarketRiskInfo,
  RoutePlan,
  SyntheticAssetInfo,
  SyntheticVaultState,
  MintRecord,
  BurnRecord,
  AdminSyntheticAsset,
  OracleProvider,
  CreateSyntheticRequest,
  SyntheticAssetStatus,
  AdminPool,
  CreatePoolRequest,
  AddLiquidityRequest,
  UpdatePoolConfigRequest,
  PoolStatus,
} from '@/types';

// ── Service URLs ───────────────────────────────────────────────────────

const MARKET_DATA_URL = import.meta.env['VITE_MARKET_DATA_URL'] ?? 'http://localhost:3210';
const QUOTE_ENGINE_URL = import.meta.env['VITE_QUOTE_ENGINE_URL'] ?? 'http://localhost:3211';
const ROUTER_SERVICE_URL = import.meta.env['VITE_ROUTER_SERVICE_URL'] ?? 'http://localhost:3212';
const EXECUTION_SERVICE_URL = import.meta.env['VITE_EXECUTION_SERVICE_URL'] ?? 'http://localhost:3213';
const OPERATOR_API_URL = import.meta.env['VITE_OPERATOR_API_URL'] ?? 'http://localhost:3100';
const SYNTHETIC_SERVICE_URL = import.meta.env['VITE_SYNTHETIC_SERVICE_URL'] ?? 'http://localhost:3220';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function getMarkets(): Promise<MarketInfo[]> {
  const data = await fetchJson<{ markets: MarketInfo[] }>(`${MARKET_DATA_URL}/markets`);
  return data.markets ?? [];
}

export async function getMarket(pairId: string): Promise<MarketInfo | null> {
  const data = await fetchJson<{ market: MarketInfo }>(`${MARKET_DATA_URL}/markets/${encodeURIComponent(pairId)}`);
  return data.market ?? null;
}

export async function getQuote(params: {
  pairId: string;
  side: 'buy' | 'sell';
  amount: string;
}): Promise<QuoteResponse> {
  const data = await fetchJson<{ quote: QuoteResponse }>(`${QUOTE_ENGINE_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.quote;
}

export async function planRoute(payload: {
  quoteId: string;
  pairId: string;
}): Promise<RoutePlan> {
  const data = await fetchJson<{ routePlan: RoutePlan }>(`${ROUTER_SERVICE_URL}/route`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, side: 'SELL', amount: '1000' }),
  });
  return data.routePlan;
}

export async function executeRoute(payload: {
  routeId: string;
  userAddress: string;
  pairId?: string;
  amount?: string;
  destinationAddress?: string;
  destinationChain?: string;
}): Promise<ExecutionRecord> {
  const data = await fetchJson<{ execution: ExecutionRecord }>(`${EXECUTION_SERVICE_URL}/executions`, {
    method: 'POST',
    body: JSON.stringify({
      pairId: payload.pairId ?? 'DCC/SOL',
      side: 'SELL',
      amount: payload.amount ?? '1000',
      userAddress: payload.userAddress,
      destinationAddress: payload.destinationAddress ?? payload.userAddress,
      destinationChain: payload.destinationChain ?? 'solana',
    }),
  });
  return data.execution;
}

export async function getExecution(id: string): Promise<ExecutionRecord | null> {
  const data = await fetchJson<{ execution: ExecutionRecord }>(`${EXECUTION_SERVICE_URL}/executions/${encodeURIComponent(id)}`);
  return data.execution ?? null;
}

export async function getExecutions(): Promise<ExecutionRecord[]> {
  const data = await fetchJson<{ executions: ExecutionRecord[] }>(`${EXECUTION_SERVICE_URL}/executions`);
  return data.executions ?? [];
}

// ── Operator API ───────────────────────────────────────────────────────

export async function getOperatorSummary(): Promise<OperatorDashboardSummary> {
  return fetchJson<OperatorDashboardSummary>(`${OPERATOR_API_URL}/admin/summary`);
}

export async function getRelayerStatus(): Promise<RelayerStatus> {
  const data = await fetchJson<{ relayers: RelayerStatus[] }>(`${OPERATOR_API_URL}/admin/relayers`);
  return data.relayers[0]!;
}

export async function getVenueHealth(): Promise<VenueHealthDetail[]> {
  const data = await fetchJson<{ venues: VenueHealthDetail[] }>(`${OPERATOR_API_URL}/admin/venues`);
  return data.venues ?? [];
}

export async function getRiskAlerts(): Promise<RiskAlert[]> {
  const data = await fetchJson<{ alerts: RiskAlert[] }>(`${OPERATOR_API_URL}/admin/alerts`);
  return data.alerts ?? [];
}

export async function getMarketRisks(): Promise<MarketRiskInfo[]> {
  const data = await fetchJson<{ markets: MarketRiskInfo[] }>(`${OPERATOR_API_URL}/admin/markets`);
  return data.markets ?? [];
}

// ── Synthetic Service API ──────────────────────────────────────────────

export async function getSyntheticAssets(): Promise<SyntheticAssetInfo[]> {
  const data = await fetchJson<{ assets: SyntheticAssetInfo[] }>(`${SYNTHETIC_SERVICE_URL}/synthetics`);
  return data.assets ?? [];
}

export async function getSyntheticAsset(id: string): Promise<SyntheticAssetInfo | null> {
  const data = await fetchJson<{ asset: SyntheticAssetInfo }>(`${SYNTHETIC_SERVICE_URL}/synthetics/${encodeURIComponent(id)}`);
  return data.asset ?? null;
}

export async function getVaultState(): Promise<SyntheticVaultState> {
  const data = await fetchJson<{ vault: SyntheticVaultState }>(`${SYNTHETIC_SERVICE_URL}/vault`);
  return data.vault;
}

export async function mintSynthetic(params: {
  syntheticAssetId: string;
  collateralAmount: number;
  collateralAsset: 'DUSD';
  userAddress: string;
}): Promise<MintRecord> {
  const data = await fetchJson<{ mint: MintRecord }>(`${SYNTHETIC_SERVICE_URL}/synthetics/mint`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.mint;
}

export async function burnSynthetic(params: {
  syntheticAssetId: string;
  burnAmount: number;
  userAddress: string;
}): Promise<BurnRecord> {
  const data = await fetchJson<{ burn: BurnRecord }>(`${SYNTHETIC_SERVICE_URL}/synthetics/burn`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.burn;
}

export async function getSyntheticHistory(userAddress?: string): Promise<{ mints: MintRecord[]; burns: BurnRecord[] }> {
  const url = userAddress
    ? `${SYNTHETIC_SERVICE_URL}/synthetics/history?userAddress=${encodeURIComponent(userAddress)}`
    : `${SYNTHETIC_SERVICE_URL}/synthetics/history`;
  return fetchJson<{ mints: MintRecord[]; burns: BurnRecord[] }>(url);
}

// ── Admin Synthetic Management API ─────────────────────────────────────

export async function getAdminSynthetics(): Promise<AdminSyntheticAsset[]> {
  const data = await fetchJson<{ assets: AdminSyntheticAsset[] }>(`${SYNTHETIC_SERVICE_URL}/admin/synthetics`);
  return data.assets ?? [];
}

export async function getOracleProviders(): Promise<OracleProvider[]> {
  // Fallback coins list — used if the API returns empty coins arrays
  const FALLBACK_COINS = [
    { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    { coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    { coinId: 'solana', symbol: 'SOL', name: 'Solana' },
    { coinId: 'binancecoin', symbol: 'BNB', name: 'BNB' },
    { coinId: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
    { coinId: 'cardano', symbol: 'ADA', name: 'Cardano' },
    { coinId: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
    { coinId: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
    { coinId: 'polygon', symbol: 'MATIC', name: 'Polygon' },
    { coinId: 'cosmos', symbol: 'ATOM', name: 'Cosmos' },
    { coinId: 'near', symbol: 'NEAR', name: 'NEAR Protocol' },
    { coinId: 'arbitrum', symbol: 'ARB', name: 'Arbitrum' },
    { coinId: 'optimism', symbol: 'OP', name: 'Optimism' },
    { coinId: 'sui', symbol: 'SUI', name: 'Sui' },
    { coinId: 'aptos', symbol: 'APT', name: 'Aptos' },
    { coinId: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
    { coinId: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
    { coinId: 'uniswap', symbol: 'UNI', name: 'Uniswap' },
    { coinId: 'aave', symbol: 'AAVE', name: 'Aave' },
    { coinId: 'ripple', symbol: 'XRP', name: 'XRP' },
    { coinId: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
    { coinId: 'stellar', symbol: 'XLM', name: 'Stellar' },
    { coinId: 'filecoin', symbol: 'FIL', name: 'Filecoin' },
    { coinId: 'render-token', symbol: 'RNDR', name: 'Render' },
    { coinId: 'injective-protocol', symbol: 'INJ', name: 'Injective' },
  ];

  try {
    const raw = await fetchJson<OracleProvider[] | { providers: OracleProvider[] }>(`${SYNTHETIC_SERVICE_URL}/admin/oracle-providers`);
    // Handle both response shapes: bare array or { providers: [...] }
    const providers: OracleProvider[] = Array.isArray(raw) ? raw : (raw.providers ?? []);
    // Fill in coins if the backend returned empty arrays
    return providers.map(p => ({
      ...p,
      coins: p.coins?.length ? p.coins : FALLBACK_COINS,
    }));
  } catch {
    // If the API is unreachable, return default providers with fallback coins
    return [
      { providerId: 'coingecko', providerName: 'CoinGecko', apiType: 'rest', requiresApiKey: false, freeRateLimit: '10-30 req/min', description: 'Free tier', coins: FALLBACK_COINS },
      { providerId: 'binance', providerName: 'Binance', apiType: 'rest', requiresApiKey: false, freeRateLimit: '1200 req/min', description: 'Public API', coins: FALLBACK_COINS },
      { providerId: 'cryptocompare', providerName: 'CryptoCompare', apiType: 'rest', requiresApiKey: false, freeRateLimit: '100K/month', description: 'Free tier', coins: FALLBACK_COINS },
      { providerId: 'defillama', providerName: 'DeFi Llama', apiType: 'rest', requiresApiKey: false, freeRateLimit: 'Unlimited', description: 'Free', coins: FALLBACK_COINS },
    ];
  }
}

export async function createAdminSynthetic(req: CreateSyntheticRequest): Promise<AdminSyntheticAsset> {
  const data = await fetchJson<{ asset: AdminSyntheticAsset }>(`${SYNTHETIC_SERVICE_URL}/admin/synthetics`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return data.asset;
}

export async function updateAdminSynthetic(synthId: string, params: {
  supplyCap?: number;
  targetBackingRatio?: number;
  isRedeemable?: boolean;
  mintFee?: number;
  burnFee?: number;
}): Promise<AdminSyntheticAsset> {
  const data = await fetchJson<{ asset: AdminSyntheticAsset }>(`${SYNTHETIC_SERVICE_URL}/admin/synthetics/${encodeURIComponent(synthId)}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
  return data.asset;
}

export async function setSyntheticStatus(synthId: string, status: SyntheticAssetStatus): Promise<void> {
  await fetchJson(`${SYNTHETIC_SERVICE_URL}/admin/synthetics/${encodeURIComponent(synthId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function addOracleToSynthetic(synthId: string, oracle: {
  providerId: string;
  providerName: string;
  coinId: string;
  weight: number;
  maxStalenessMs: number;
}): Promise<void> {
  await fetchJson(`${SYNTHETIC_SERVICE_URL}/admin/synthetics/${encodeURIComponent(synthId)}/oracles`, {
    method: 'POST',
    body: JSON.stringify(oracle),
  });
}

export async function removeOracleFromSynthetic(synthId: string, sourceId: string): Promise<void> {
  await fetchJson(`${SYNTHETIC_SERVICE_URL}/admin/synthetics/${encodeURIComponent(synthId)}/oracles/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
  });
}

// ── Admin Pool Management ──────────────────────────────────────────────

/** Public: returns only ACTIVE pools */
export async function getPools(): Promise<AdminPool[]> {
  return fetchJson<AdminPool[]>(`${SYNTHETIC_SERVICE_URL}/pools`);
}

export async function getAdminPools(): Promise<AdminPool[]> {
  return fetchJson<AdminPool[]>(`${SYNTHETIC_SERVICE_URL}/admin/pools`);
}

export async function createAdminPool(req: CreatePoolRequest): Promise<AdminPool> {
  return fetchJson<AdminPool>(`${SYNTHETIC_SERVICE_URL}/admin/pools`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function addLiquidityToPool(req: AddLiquidityRequest): Promise<{ lpMinted: string }> {
  return fetchJson<{ lpMinted: string }>(`${SYNTHETIC_SERVICE_URL}/admin/pools/${encodeURIComponent(req.poolId)}/liquidity`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function updatePoolConfig(poolId: string, params: UpdatePoolConfigRequest): Promise<void> {
  await fetchJson(`${SYNTHETIC_SERVICE_URL}/admin/pools/${encodeURIComponent(poolId)}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export async function setPoolStatus(poolId: string, status: PoolStatus): Promise<void> {
  await fetchJson(`${SYNTHETIC_SERVICE_URL}/admin/pools/${encodeURIComponent(poolId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
