// ============================================================================
// price-providers.ts — Multi-provider price fetching for DCC Oracle system
// ============================================================================
//
// Supported providers (all free, no API key required):
//   1. CoinGecko   — api.coingecko.com
//   2. Binance     — api.binance.com (public ticker API)
//   3. CryptoCompare — min-api.cryptocompare.com
//   4. DeFi Llama  — coins.llama.fi
//
// Optional (requires API key via env var):
//   5. CoinMarketCap — pro-api.coinmarketcap.com (CMC_API_KEY)
//
// Usage:
//   import { fetchAllProviderPrices, PROVIDERS } from './price-providers';
//   const results = await fetchAllProviderPrices(SYNTH_SYMBOLS);
// ============================================================================

// ── Types ──────────────────────────────────────────────────────────────

export interface ProviderConfig {
  venue: string;                           // On-chain venue identifier
  name: string;                            // Human-readable display name
  weight: number;                          // SCALE8 weight for oracle aggregation
  stalenessMs: number;                     // Max age before price is considered stale
  requiresApiKey: boolean;                 // Whether an env var is needed
  apiKeyEnv?: string;                      // Env var name for API key
}

export interface ProviderResult {
  venue: string;
  prices: Record<string, number>;          // synthId → USD price
  success: boolean;
  error?: string;
}

// ── Symbol Mappings ────────────────────────────────────────────────────

// Maps synthId to each provider's native symbol/identifier
const COINGECKO_IDS: Record<string, string> = {
  sSOL:  'solana',
  sETH:  'ethereum',
  sBTC:  'bitcoin',
  sBNB:  'binancecoin',
  sAVAX: 'avalanche-2',
};

const BINANCE_SYMBOLS: Record<string, string> = {
  sSOL:  'SOLUSDT',
  sETH:  'ETHUSDT',
  sBTC:  'BTCUSDT',
  sBNB:  'BNBUSDT',
  sAVAX: 'AVAXUSDT',
};

const CRYPTOCOMPARE_SYMBOLS: Record<string, string> = {
  sSOL:  'SOL',
  sETH:  'ETH',
  sBTC:  'BTC',
  sBNB:  'BNB',
  sAVAX: 'AVAX',
};

// DeFi Llama uses CoinGecko IDs with a "coingecko:" prefix
const DEFILLAMA_IDS: Record<string, string> = {
  sSOL:  'coingecko:solana',
  sETH:  'coingecko:ethereum',
  sBTC:  'coingecko:bitcoin',
  sBNB:  'coingecko:binancecoin',
  sAVAX: 'coingecko:avalanche-2',
};

const CMC_SYMBOLS: Record<string, string> = {
  sSOL:  'SOL',
  sETH:  'ETH',
  sBTC:  'BTC',
  sBNB:  'BNB',
  sAVAX: 'AVAX',
};

// ── Provider Configurations ────────────────────────────────────────────

// Weights split across 4 free providers (sums to ~100_000_000 per synth):
//   CoinGecko=30M, Binance=30M, CryptoCompare=20M, DeFi Llama=20M
// If CMC is enabled, weights redistribute automatically.

export const PROVIDERS: ProviderConfig[] = [
  {
    venue: 'coingecko',
    name: 'CoinGecko',
    weight: 30_000_000,
    stalenessMs: 120_000,
    requiresApiKey: false,
  },
  {
    venue: 'binance',
    name: 'Binance',
    weight: 30_000_000,
    stalenessMs: 120_000,
    requiresApiKey: false,
  },
  {
    venue: 'cryptocompare',
    name: 'CryptoCompare',
    weight: 20_000_000,
    stalenessMs: 120_000,
    requiresApiKey: false,
  },
  {
    venue: 'defillama',
    name: 'DeFi Llama',
    weight: 20_000_000,
    stalenessMs: 120_000,
    requiresApiKey: false,
  },
];

// Optional: CoinMarketCap (only if CMC_API_KEY is set)
const CMC_PROVIDER: ProviderConfig = {
  venue: 'coinmarketcap',
  name: 'CoinMarketCap',
  weight: 15_000_000,
  stalenessMs: 120_000,
  requiresApiKey: true,
  apiKeyEnv: 'CMC_API_KEY',
};

/** Returns the active provider list, including CMC if API key is present */
export function getActiveProviders(): ProviderConfig[] {
  const providers = [...PROVIDERS];
  const cmcKey = process.env['CMC_API_KEY'];
  if (cmcKey) {
    providers.push(CMC_PROVIDER);
    // Redistribute weights when CMC is active (total stays ~100M)
    // CoinGecko=25M, Binance=25M, CryptoCompare=17.5M, DeFi Llama=17.5M, CMC=15M
    providers[0].weight = 25_000_000;
    providers[1].weight = 25_000_000;
    providers[2].weight = 17_500_000;
    providers[3].weight = 17_500_000;
  }
  return providers;
}

// ── Individual Provider Fetchers ───────────────────────────────────────

async function fetchCoinGecko(synthIds: string[]): Promise<ProviderResult> {
  const venue = 'coingecko';
  try {
    const ids = synthIds.map(s => COINGECKO_IDS[s]).filter(Boolean).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json() as Record<string, { usd: number }>;

    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const cgId = COINGECKO_IDS[synthId];
      if (cgId && data[cgId]?.usd) {
        prices[synthId] = data[cgId].usd;
      }
    }
    return { venue, prices, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { venue, prices: {}, success: false, error: msg };
  }
}

async function fetchBinance(synthIds: string[]): Promise<ProviderResult> {
  const venue = 'binance';
  try {
    // Binance ticker/price supports a single symbol or all symbols
    // Fetch all at once for efficiency
    const url = 'https://api.binance.com/api/v3/ticker/price';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json() as Array<{ symbol: string; price: string }>;

    const priceMap = new Map<string, number>();
    for (const item of data) {
      priceMap.set(item.symbol, parseFloat(item.price));
    }

    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const symbol = BINANCE_SYMBOLS[synthId];
      if (symbol && priceMap.has(symbol)) {
        prices[synthId] = priceMap.get(symbol)!;
      }
    }
    return { venue, prices, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { venue, prices: {}, success: false, error: msg };
  }
}

async function fetchCryptoCompare(synthIds: string[]): Promise<ProviderResult> {
  const venue = 'cryptocompare';
  try {
    const fsyms = synthIds.map(s => CRYPTOCOMPARE_SYMBOLS[s]).filter(Boolean).join(',');
    const url = `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${fsyms}&tsyms=USD`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json() as Record<string, { USD: number }>;

    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const sym = CRYPTOCOMPARE_SYMBOLS[synthId];
      if (sym && data[sym]?.USD) {
        prices[synthId] = data[sym].USD;
      }
    }
    return { venue, prices, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { venue, prices: {}, success: false, error: msg };
  }
}

async function fetchDefiLlama(synthIds: string[]): Promise<ProviderResult> {
  const venue = 'defillama';
  try {
    const coins = synthIds.map(s => DEFILLAMA_IDS[s]).filter(Boolean).join(',');
    const url = `https://coins.llama.fi/prices/current/${coins}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json() as { coins: Record<string, { price: number }> };

    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const llamaId = DEFILLAMA_IDS[synthId];
      if (llamaId && data.coins[llamaId]?.price) {
        prices[synthId] = data.coins[llamaId].price;
      }
    }
    return { venue, prices, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { venue, prices: {}, success: false, error: msg };
  }
}

async function fetchCoinMarketCap(synthIds: string[]): Promise<ProviderResult> {
  const venue = 'coinmarketcap';
  const apiKey = process.env['CMC_API_KEY'];
  if (!apiKey) {
    return { venue, prices: {}, success: false, error: 'CMC_API_KEY not set' };
  }

  try {
    const symbols = synthIds.map(s => CMC_SYMBOLS[s]).filter(Boolean).join(',');
    const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${symbols}&convert=USD`;
    const res = await fetch(url, {
      headers: { 'X-CMC_PRO_API_KEY': apiKey },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const body = await res.json() as {
      data: Record<string, Array<{ quote: { USD: { price: number } } }>>;
    };

    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const sym = CMC_SYMBOLS[synthId];
      if (sym && body.data[sym]?.[0]?.quote?.USD?.price) {
        prices[synthId] = body.data[sym][0].quote.USD.price;
      }
    }
    return { venue, prices, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { venue, prices: {}, success: false, error: msg };
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────

const FETCHER_MAP: Record<string, (synthIds: string[]) => Promise<ProviderResult>> = {
  coingecko: fetchCoinGecko,
  binance: fetchBinance,
  cryptocompare: fetchCryptoCompare,
  defillama: fetchDefiLlama,
  coinmarketcap: fetchCoinMarketCap,
};

/**
 * Fetch prices from all active providers in parallel.
 * Returns results for each provider (including failures).
 */
export async function fetchAllProviderPrices(synthIds: string[]): Promise<ProviderResult[]> {
  const providers = getActiveProviders();

  const promises = providers.map(p => {
    const fetcher = FETCHER_MAP[p.venue];
    if (!fetcher) {
      return Promise.resolve({
        venue: p.venue,
        prices: {} as Record<string, number>,
        success: false,
        error: `No fetcher for venue: ${p.venue}`,
      } satisfies ProviderResult);
    }
    return fetcher(synthIds);
  });

  return Promise.all(promises);
}
