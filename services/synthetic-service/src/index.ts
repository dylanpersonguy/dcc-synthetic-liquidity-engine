// ============================================================================
// synthetic-service — Synthetic Asset Mint / Burn / Vault Orchestration
// ============================================================================
//
// RESPONSIBILITIES:
//   1. List synthetic assets with live pricing + supply info
//   2. Process mint requests (DUSD collateral → sSOL/sETH/sBTC)
//   3. Process burn requests (sSOL/sETH/sBTC → reclaim collateral)
//   4. Track vault state (backing ratio, per-asset exposure)
//   5. Provide position history per user
//
// V1: Inventory-backed model. Protocol holds DUSD reserves; synthetic supply
// is capped to what the reserves can cover at mark price.
// ============================================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseConfig, SyntheticServiceConfig } from '@dcc/config';
import { createPool, closePool, syntheticExposureRepo } from '@dcc/database';
import { createLogger } from '@dcc/metrics';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as chain from './chain.js';

const log = createLogger('synthetic-service');

// ── Live Price Fetching ─────────────────────────────────────────────────

/** Build CoinGecko ID map dynamically from SYNTH_ASSETS underlyingAssetId */
function getCoinGeckoIds(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of SYNTH_ASSETS) {
    if (a.underlyingAssetId) map[a.syntheticAssetId] = a.underlyingAssetId;
  }
  return map;
}

/** Build Binance symbol map dynamically from underlyingSymbol */
function getBinanceSymbols(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of SYNTH_ASSETS) {
    if (a.underlyingSymbol) map[a.syntheticAssetId] = `${a.underlyingSymbol}USDT`;
  }
  return map;
}

async function fetchCoinGeckoPrices(synthIds: string[]): Promise<Record<string, number>> {
  try {
    const cgIds = getCoinGeckoIds();
    const ids = synthIds.map(s => cgIds[s]).filter(Boolean).join(',');
    if (!ids) return {};
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    if (!res.ok) return {};
    const data = await res.json() as Record<string, { usd: number }>;
    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const cgId = cgIds[synthId];
      if (cgId && data[cgId]?.usd) prices[synthId] = data[cgId].usd;
    }
    return prices;
  } catch { return {}; }
}

async function fetchBinancePrices(synthIds: string[]): Promise<Record<string, number>> {
  try {
    const bnSymbols = getBinanceSymbols();
    const res = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (!res.ok) return {};
    const data = await res.json() as Array<{ symbol: string; price: string }>;
    const priceMap = new Map(data.map(d => [d.symbol, parseFloat(d.price)]));
    const prices: Record<string, number> = {};
    for (const synthId of synthIds) {
      const sym = bnSymbols[synthId];
      if (sym && priceMap.has(sym)) prices[synthId] = priceMap.get(sym)!;
    }
    return prices;
  } catch { return {}; }
}

/** Merge prices from multiple sources — average when both available */
function mergePrices(...sources: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  const allKeys = new Set(sources.flatMap(s => Object.keys(s)));
  for (const key of allKeys) {
    const values = sources.map(s => s[key]).filter((v): v is number => v != null && v > 0);
    if (values.length > 0) merged[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return merged;
}

// Store previous prices for 24h change approximation
const previousPrices: Record<string, number> = {};
let lastPriceUpdate = 0;

async function updateLivePrices(): Promise<void> {
  const synthIds = SYNTH_ASSETS.map(a => a.syntheticAssetId);
  if (synthIds.length === 0) return;

  const [cgPrices, bnPrices] = await Promise.all([
    fetchCoinGeckoPrices(synthIds),
    fetchBinancePrices(synthIds),
  ]);

  const merged = mergePrices(cgPrices, bnPrices);
  const now = Date.now();

  for (const asset of SYNTH_ASSETS) {
    const newPrice = merged[asset.syntheticAssetId];
    if (newPrice && newPrice > 0) {
      // Snapshot previous price for change calculation (first run stores initial)
      if (lastPriceUpdate === 0) {
        previousPrices[asset.syntheticAssetId] = newPrice;
      } else if (!previousPrices[asset.syntheticAssetId]) {
        previousPrices[asset.syntheticAssetId] = asset.markPrice;
      }

      const prev = previousPrices[asset.syntheticAssetId] || newPrice;
      asset.markPrice = newPrice;
      asset.change24h = prev > 0 ? parseFloat((((newPrice - prev) / prev) * 100).toFixed(2)) : 0;
    }
  }

  lastPriceUpdate = now;
  const priceStr = SYNTH_ASSETS.map(a => `${a.symbol}=$${a.markPrice.toFixed(2)}`).join(', ');
  log.info(`Prices updated: ${priceStr}`);
}

function startPriceUpdater(): void {
  // Initial fetch
  updateLivePrices().catch(err => log.warn(`Price update failed: ${err}`));
  // Then every 30 seconds
  setInterval(() => {
    updateLivePrices().catch(err => log.warn(`Price update failed: ${err}`));
  }, 30_000);
}

// ── In-Memory State (paper-mode) ────────────────────────────────────────

interface SyntheticAssetInfo {
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
  backingModel: 'INVENTORY_BACKED' | 'OVERCOLLATERALIZED';
  underlyingAssetId: string;
  backingAssetId: string;
  decimals: number;
  isRedeemable: boolean;
  riskTier: string;
  dccTokenId: string | null;
  oracleSources: Array<{ providerId: string; providerName: string; coinId: string; weight: number; maxStalenessMs: number }>;
  createdAt: number;
}

interface VaultState {
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

interface MintRecord {
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

interface BurnRecord {
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

// ── Seed Data ───────────────────────────────────────────────────────────

const SYNTH_ASSETS: SyntheticAssetInfo[] = [
  {
    syntheticAssetId: 'sSOL',
    symbol: 'sSOL',
    name: 'Synthetic SOL',
    underlyingSymbol: 'SOL',
    markPrice: 135.50,
    change24h: -1.2,
    totalSupply: 458.3,
    supplyCap: 2000,
    backingRatio: 1.15,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'solana',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sETH',
    symbol: 'sETH',
    name: 'Synthetic ETH',
    underlyingSymbol: 'ETH',
    markPrice: 3540.0,
    change24h: 2.3,
    totalSupply: 12.8,
    supplyCap: 100,
    backingRatio: 1.22,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'ethereum',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sBTC',
    symbol: 'sBTC',
    name: 'Synthetic BTC',
    underlyingSymbol: 'BTC',
    markPrice: 67200.0,
    change24h: 0.8,
    totalSupply: 0.95,
    supplyCap: 5,
    backingRatio: 1.18,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'bitcoin',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sXRP',
    symbol: 'sXRP',
    name: 'Synthetic XRP',
    underlyingSymbol: 'XRP',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 50000,
    backingRatio: 1.15,
    mintFee: 0.003,
    burnFee: 0.002,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'ripple',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sBNB',
    symbol: 'sBNB',
    name: 'Synthetic BNB',
    underlyingSymbol: 'BNB',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 500,
    backingRatio: 1.18,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'binancecoin',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sADA',
    symbol: 'sADA',
    name: 'Synthetic ADA',
    underlyingSymbol: 'ADA',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 100000,
    backingRatio: 1.15,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'cardano',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sDOGE',
    symbol: 'sDOGE',
    name: 'Synthetic DOGE',
    underlyingSymbol: 'DOGE',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 500000,
    backingRatio: 1.15,
    mintFee: 0.003,
    burnFee: 0.002,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'dogecoin',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_3',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sAVAX',
    symbol: 'sAVAX',
    name: 'Synthetic AVAX',
    underlyingSymbol: 'AVAX',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 1000,
    backingRatio: 1.18,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'avalanche-2',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sLINK',
    symbol: 'sLINK',
    name: 'Synthetic LINK',
    underlyingSymbol: 'LINK',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 5000,
    backingRatio: 1.18,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'chainlink',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
  {
    syntheticAssetId: 'sDOT',
    symbol: 'sDOT',
    name: 'Synthetic DOT',
    underlyingSymbol: 'DOT',
    markPrice: 0,
    change24h: 0,
    totalSupply: 0,
    supplyCap: 5000,
    backingRatio: 1.18,
    mintFee: 0.002,
    burnFee: 0.001,
    status: 'ACTIVE',
    backingModel: 'INVENTORY_BACKED',
    underlyingAssetId: 'polkadot',
    backingAssetId: 'DUSD',
    decimals: 8,
    isRedeemable: true,
    riskTier: 'tier_2',
    dccTokenId: null,
    oracleSources: [],
    createdAt: Date.now() - 86_400_000,
  },
];

function buildVaultState(): VaultState {
  const assets: VaultState['assets'] = {};
  let totalLiability = 0;
  let totalBacking = 0;

  for (const a of SYNTH_ASSETS) {
    const liability = a.totalSupply * a.markPrice;
    const backing = liability * a.backingRatio;
    totalLiability += liability;
    totalBacking += backing;
    assets[a.syntheticAssetId] = {
      supply: a.totalSupply,
      markPrice: a.markPrice,
      liabilityUsd: liability,
      backingAllocatedUsd: backing,
      utilization: a.totalSupply / a.supplyCap,
    };
  }

  return {
    totalBackingUsd: totalBacking,
    totalLiabilityUsd: totalLiability,
    backingRatio: totalLiability > 0 ? totalBacking / totalLiability : 0,
    assets,
    lastUpdated: Date.now(),
  };
}

const mintHistory: MintRecord[] = [];
const burnHistory: BurnRecord[] = [];

// ── Validation Schemas ──────────────────────────────────────────────────

const MintRequestSchema = z.object({
  syntheticAssetId: z.string(),
  collateralAmount: z.number().positive(),
  collateralAsset: z.enum(['DUSD']),
  userAddress: z.string().min(1),
});

const BurnRequestSchema = z.object({
  syntheticAssetId: z.string(),
  burnAmount: z.number().positive(),
  userAddress: z.string().min(1),
});

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig(SyntheticServiceConfig);  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // Try to connect to database (non-fatal if unavailable)
  try {
    createPool({ connectionString: config.DATABASE_URL });
    log.info('Database connected');
  } catch {
    log.warn('Database unavailable — running with in-memory state only');
  }

  // ── GET /synthetics — List all synthetic assets ─────────────────────

  app.get('/synthetics', async () => {
    return { assets: SYNTH_ASSETS };
  });

  // ── GET /synthetics/:id — Single synthetic asset detail ─────────────

  app.get<{ Params: { id: string } }>('/synthetics/:id', async (req, reply) => {
    const asset = SYNTH_ASSETS.find((a) => a.syntheticAssetId === req.params.id);
    if (!asset) return reply.status(404).send({ error: 'Synthetic asset not found' });
    return { asset };
  });

  // ── GET /vault — Vault state snapshot ───────────────────────────────

  app.get('/vault', async () => {
    return { vault: buildVaultState() };
  });

  // ── POST /synthetics/mint — Mint synthetic tokens ───────────────────

  app.post('/synthetics/mint', async (req, reply) => {
    const parsed = MintRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { syntheticAssetId, collateralAmount, collateralAsset, userAddress } = parsed.data;
    const asset = SYNTH_ASSETS.find((a) => a.syntheticAssetId === syntheticAssetId);
    if (!asset) return reply.status(404).send({ error: 'Synthetic asset not found' });
    if (asset.status !== 'ACTIVE') return reply.status(400).send({ error: `Asset is ${asset.status}, minting disabled` });
    if (asset.markPrice <= 0) return reply.status(400).send({ error: 'Price feed unavailable — cannot mint until oracle provides a price' });

    // Convert collateral to USD value (DUSD is 1:1 with USD)
    const collateralUsd = collateralAmount;

    // Calculate mint amount
    const fee = collateralUsd * asset.mintFee;
    const netCollateral = collateralUsd - fee;
    const mintAmount = netCollateral / asset.markPrice;

    // Check supply cap
    if (asset.totalSupply + mintAmount > asset.supplyCap) {
      const remaining = asset.supplyCap - asset.totalSupply;
      return reply.status(400).send({
        error: 'Supply cap exceeded',
        maxMintable: remaining,
        requestedMint: mintAmount,
      });
    }

    // Execute mint (update in-memory state)
    asset.totalSupply += mintAmount;

    // On-chain mint (non-blocking — best effort)
    let chainTxIds: { factoryTxId?: string; vaultTxId?: string } = {};
    if (chain.isChainReady()) {
      try {
        const rawAmount = Math.round(mintAmount * chain.SCALE8);
        const rawPrice = Math.round(asset.markPrice * chain.SCALE8);
        const result = await chain.mintOnChain(syntheticAssetId, userAddress, rawAmount, rawPrice);
        chainTxIds = result;
        log.info(`On-chain mint: factory=${result.factoryTxId}, vault=${result.vaultTxId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`On-chain mint failed (paper mode continues): ${msg}`);
      }
    }

    const record: MintRecord = {
      mintId: chainTxIds.factoryTxId ? chainTxIds.factoryTxId.slice(0, 16) : `mint-${randomUUID().slice(0, 8)}`,
      userAddress,
      syntheticAssetId,
      symbol: asset.symbol,
      collateralAmount,
      collateralAsset,
      mintedAmount: mintAmount,
      markPriceAtMint: asset.markPrice,
      feeAmount: fee,
      status: 'completed',
      createdAt: Date.now(),
    };
    mintHistory.push(record);

    log.info(`Mint completed: ${record.mintId} ${asset.symbol} amount=${mintAmount}`);
    return reply.status(201).send({ mint: record });
  });

  // ── POST /synthetics/burn — Burn synthetic tokens ───────────────────

  app.post('/synthetics/burn', async (req, reply) => {
    const parsed = BurnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { syntheticAssetId, burnAmount, userAddress } = parsed.data;
    const asset = SYNTH_ASSETS.find((a) => a.syntheticAssetId === syntheticAssetId);
    if (!asset) return reply.status(404).send({ error: 'Synthetic asset not found' });

    if (burnAmount > asset.totalSupply) {
      return reply.status(400).send({ error: 'Insufficient supply to burn' });
    }

    // Calculate collateral return
    const collateralUsd = burnAmount * asset.markPrice;
    const fee = collateralUsd * asset.burnFee;
    const netReturn = collateralUsd - fee;

    // Execute burn
    asset.totalSupply -= burnAmount;

    // On-chain burn (non-blocking — best effort)
    let chainTxIds: { factoryTxId?: string; vaultTxId?: string } = {};
    if (chain.isChainReady() && asset.dccTokenId) {
      try {
        const rawAmount = Math.round(burnAmount * chain.SCALE8);
        const rawPrice = Math.round(asset.markPrice * chain.SCALE8);
        const result = await chain.burnOnChain(syntheticAssetId, rawAmount, rawPrice, asset.dccTokenId);
        chainTxIds = result;
        log.info(`On-chain burn: factory=${result.factoryTxId}, vault=${result.vaultTxId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`On-chain burn failed (paper mode continues): ${msg}`);
      }
    }

    const record: BurnRecord = {
      burnId: chainTxIds.factoryTxId ? chainTxIds.factoryTxId.slice(0, 16) : `burn-${randomUUID().slice(0, 8)}`,
      userAddress,
      syntheticAssetId,
      symbol: asset.symbol,
      burnedAmount: burnAmount,
      collateralReturned: netReturn,
      collateralAsset: 'DUSD',
      markPriceAtBurn: asset.markPrice,
      feeAmount: fee,
      status: 'completed',
      createdAt: Date.now(),
    };
    burnHistory.push(record);

    log.info(`Burn completed: ${record.burnId} ${asset.symbol} amount=${burnAmount}`);
    return reply.status(201).send({ burn: record });
  });

  // ── GET /synthetics/history — User mint/burn history ────────────────

  app.get<{ Querystring: { userAddress?: string } }>('/synthetics/history', async (req) => {
    const addr = req.query.userAddress;
    const mints = addr ? mintHistory.filter((m) => m.userAddress === addr) : mintHistory;
    const burns = addr ? burnHistory.filter((b) => b.userAddress === addr) : burnHistory;
    return { mints, burns };
  });

  // ── Health ──────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    service: 'synthetic-service',
    uptime: process.uptime(),
    assetsTracked: SYNTH_ASSETS.length,
    chainConnected: chain.isChainReady(),
    chainNode: chain.NODE_URL,
    protocolAddress: chain.getProtocolAddress() || undefined,
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /admin/synthetics ─────────────────────────────────────────────

  app.get('/admin/synthetics', async () => {
    return { assets: SYNTH_ASSETS.map((a) => ({
      ...a,
      targetBackingRatio: a.backingRatio,
    })) };
  });

  // ── POST /admin/synthetics ────────────────────────────────────────────

  const createSyntheticSchema = z.object({
    symbol: z.string().min(1),
    name: z.string().min(1),
    underlyingSymbol: z.string().min(1),
    underlyingAssetId: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
    backingModel: z.enum(['INVENTORY_BACKED', 'OVERCOLLATERALIZED']),
    backingAssetId: z.string().min(1),
    targetBackingRatio: z.number().min(0),
    supplyCap: z.number().min(0),
    isRedeemable: z.boolean(),
    riskTier: z.string(),
    mintFee: z.number().min(0).max(1),
    burnFee: z.number().min(0).max(1),
    oracleSources: z.array(z.object({
      providerId: z.string(),
      providerName: z.string(),
      coinId: z.string(),
      weight: z.number().min(0).max(1),
      maxStalenessMs: z.number().min(1000),
    })),
  });

  app.post('/admin/synthetics', async (req, reply) => {
    const parsed = createSyntheticSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const newAsset: SyntheticAssetInfo = {
      syntheticAssetId: body.symbol,
      symbol: body.symbol,
      name: body.name,
      underlyingSymbol: body.underlyingSymbol,
      markPrice: 0,
      change24h: 0,
      totalSupply: 0,
      supplyCap: body.supplyCap,
      backingRatio: body.targetBackingRatio,
      mintFee: body.mintFee,
      burnFee: body.burnFee,
      status: 'ACTIVE',
      backingModel: body.backingModel,
      underlyingAssetId: body.underlyingAssetId,
      backingAssetId: body.backingAssetId,
      decimals: body.decimals,
      isRedeemable: body.isRedeemable,
      riskTier: body.riskTier,
      dccTokenId: null,
      oracleSources: body.oracleSources,
      createdAt: Date.now(),
    };
    SYNTH_ASSETS.push(newAsset);
    return { asset: newAsset };
  });

  // ── GET /admin/oracle-providers ───────────────────────────────────────

  app.get('/admin/oracle-providers', async () => {
    // Supported coins for the "Select Underlying Asset" search
    const commonCoins = [
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

    return {
      providers: [
        { providerId: 'coingecko', providerName: 'CoinGecko', apiType: 'rest', requiresApiKey: false, freeRateLimit: '10-30 req/min', description: 'Free tier', coins: commonCoins },
        { providerId: 'binance', providerName: 'Binance', apiType: 'rest', requiresApiKey: false, freeRateLimit: '1200 req/min', description: 'Public API', coins: commonCoins },
        { providerId: 'cryptocompare', providerName: 'CryptoCompare', apiType: 'rest', requiresApiKey: false, freeRateLimit: '100K/month', description: 'Free tier', coins: commonCoins },
        { providerId: 'defillama', providerName: 'DeFi Llama', apiType: 'rest', requiresApiKey: false, freeRateLimit: 'Unlimited', description: 'Free', coins: commonCoins },
        { providerId: 'coinmarketcap', providerName: 'CoinMarketCap', apiType: 'rest', requiresApiKey: true, freeRateLimit: '333 req/day', description: 'Free key', coins: commonCoins },
        { providerId: 'pyth', providerName: 'Pyth Network', apiType: 'on-chain', requiresApiKey: false, freeRateLimit: 'No limit', description: 'On-chain', coins: commonCoins },
      ],
    };
  });

  // ── PUT /admin/synthetics/:id ─────────────────────────────────────────

  app.put<{ Params: { id: string } }>('/admin/synthetics/:id', async (req) => {
    const asset = SYNTH_ASSETS.find((a) => a.syntheticAssetId === req.params.id);
    if (!asset) throw { statusCode: 404, message: 'Not found' };
    const updates = req.body as Record<string, unknown>;
    if (typeof updates['supplyCap'] === 'number') asset.supplyCap = updates['supplyCap'];
    if (typeof updates['targetBackingRatio'] === 'number') asset.backingRatio = updates['targetBackingRatio'];
    if (typeof updates['mintFee'] === 'number') asset.mintFee = updates['mintFee'];
    if (typeof updates['burnFee'] === 'number') asset.burnFee = updates['burnFee'];
    return asset;
  });

  // ── PUT /admin/synthetics/:id/status ──────────────────────────────────

  const statusSchema = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'WIND_DOWN', 'DISABLED']) });

  app.put<{ Params: { id: string } }>('/admin/synthetics/:id/status', async (req) => {
    const asset = SYNTH_ASSETS.find((a) => a.syntheticAssetId === req.params.id);
    if (!asset) throw { statusCode: 404, message: 'Not found' };
    const { status } = statusSchema.parse(req.body);
    asset.status = status === 'DISABLED' ? 'WIND_DOWN' : status;
    return asset;
  });

  // ── POST /admin/synthetics/:id/oracles ────────────────────────────────

  app.post<{ Params: { id: string } }>('/admin/synthetics/:id/oracles', async (req) => {
    // In production, persists oracle source config
    return { ok: true, syntheticAssetId: req.params.id, oracle: req.body };
  });

  // ── DELETE /admin/synthetics/:id/oracles/:sourceId ────────────────────

  app.delete<{ Params: { id: string; sourceId: string } }>('/admin/synthetics/:id/oracles/:sourceId', async (req) => {
    return { ok: true, syntheticAssetId: req.params.id, removedSourceId: req.params.sourceId };
  });

  // ══════════════════════════════════════════════════════════════════════
  // POOL / AMM ADMIN ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════

  interface PoolRecord {
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
    status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
    tvlUsd: number;
    volume24hUsd: number;
    fees24hUsd: number;
    apr: number;
    lpPositions: { address: string; lpTokens: string; sharePercent: number; seedAmountA: string; seedAmountB: string; seedTimestamp: number }[];
    createdAt: number;
    chainTxId?: string;
  }

  const POOLS: PoolRecord[] = [];

  // ── Pool Stats: TVL, Volume, Fees, APR ──────────────────────────────────

  const AMM_CONTRACT = '3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo';
  const SCALE8 = 1e8;

  /** Get USD price for a synthetic symbol from live price data */
  function getTokenPriceUsd(symbol: string): number {
    const asset = SYNTH_ASSETS.find(a => a.symbol === symbol);
    return asset?.markPrice ?? 0;
  }

  /** Compute TVL for a pool from reserves × live prices */
  function computePoolTvl(pool: PoolRecord): number {
    const priceA = getTokenPriceUsd(pool.tokenASymbol);
    const priceB = getTokenPriceUsd(pool.tokenBSymbol);
    const valA = (Number(pool.reserveA) / SCALE8) * priceA;
    const valB = (Number(pool.reserveB) / SCALE8) * priceB;
    return valA + valB;
  }

  interface SwapTxParsed {
    poolId: string;
    tokenIn: string;
    amountIn: number;
    timestamp: number;
  }

  /** Fetch recent swap transactions from the AMM contract */
  async function fetchRecentSwaps(limit: number = 100): Promise<SwapTxParsed[]> {
    const nodeUrl = chain.NODE_URL;
    try {
      const url = `${nodeUrl}/transactions/address/${AMM_CONTRACT}/limit/${limit}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as Array<Array<{
        type: number;
        call?: { function: string; args: Array<{ type: string; value: string | number }> };
        timestamp: number;
      }>>;
      const txs = data[0] ?? [];
      const swaps: SwapTxParsed[] = [];
      for (const tx of txs) {
        if (tx.type === 16 && tx.call?.function === 'swap' && tx.call.args.length >= 3) {
          swaps.push({
            poolId: String(tx.call.args[0]?.value ?? ''),
            tokenIn: String(tx.call.args[1]?.value ?? ''),
            amountIn: typeof tx.call.args[2]?.value === 'number' ? tx.call.args[2].value : 0,
            timestamp: tx.timestamp,
          });
        }
      }
      return swaps;
    } catch {
      return [];
    }
  }

  /** Update all pool stats: TVL, 24h volume, 24h fees, APR */
  async function updatePoolStats(): Promise<void> {
    if (POOLS.length === 0) return;

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const recentSwaps = await fetchRecentSwaps(100);

    for (const pool of POOLS) {
      // TVL
      pool.tvlUsd = parseFloat(computePoolTvl(pool).toFixed(2));

      // 24h Volume (sum amountIn in USD for this pool)
      let volumeUsd = 0;
      let feesRaw = 0;
      for (const swap of recentSwaps) {
        if (swap.poolId === pool.poolId && swap.timestamp >= oneDayAgo) {
          const priceUsd = getTokenPriceUsd(swap.tokenIn);
          const amountDecimal = swap.amountIn / SCALE8;
          volumeUsd += amountDecimal * priceUsd;
          // Fee = amountIn * feeRateBps / 10000
          feesRaw += (swap.amountIn * pool.feeRateBps) / 10000;
        }
      }

      pool.volume24hUsd = parseFloat(volumeUsd.toFixed(2));

      // 24h Fees (fee amounts in the tokenIn, converted to USD)
      // Re-compute from individual swaps for accuracy
      let feesUsd = 0;
      for (const swap of recentSwaps) {
        if (swap.poolId === pool.poolId && swap.timestamp >= oneDayAgo) {
          const feeAmount = (swap.amountIn * pool.feeRateBps) / 10000;
          const priceUsd = getTokenPriceUsd(swap.tokenIn);
          feesUsd += (feeAmount / SCALE8) * priceUsd;
        }
      }
      pool.fees24hUsd = parseFloat(feesUsd.toFixed(2));

      // APR = (fees24h * 365 / tvl) * 100
      pool.apr = pool.tvlUsd > 0
        ? parseFloat(((pool.fees24hUsd * 365 / pool.tvlUsd) * 100).toFixed(2))
        : 0;
    }

    log.info(`Pool stats updated: ${POOLS.map(p => `${p.poolId} TVL=$${p.tvlUsd} Vol=$${p.volume24hUsd} Fees=$${p.fees24hUsd} APR=${p.apr}%`).join(', ')}`);
  }

  // ── GET /pools (public) ────────────────────────────────────────────────

  app.get('/pools', async () => POOLS.filter(p => p.status === 'ACTIVE'));

  // ── GET /admin/pools ──────────────────────────────────────────────────

  app.get('/admin/pools', async () => POOLS);

  // ── POST /admin/pools ─────────────────────────────────────────────────

  const createPoolSchema = z.object({
    tokenA: z.string().min(1),
    tokenASymbol: z.string().min(1),
    tokenB: z.string().min(1),
    tokenBSymbol: z.string().min(1),
    initialAmountA: z.string(),
    initialAmountB: z.string(),
    feeRateBps: z.number().int().min(1).max(10000),
    protocolFeeShareBps: z.number().int().min(0).max(10000),
    virtualLiquidityA: z.string(),
    virtualLiquidityB: z.string(),
  });

  app.post('/admin/pools', async (req, reply) => {
    const body = createPoolSchema.parse(req.body);
    const amountA = parseFloat(body.initialAmountA);
    const amountB = parseFloat(body.initialAmountB);
    const poolId = `pool-${body.tokenASymbol.toLowerCase()}-${body.tokenBSymbol.toLowerCase()}`;
    const lpMinted = Math.sqrt(amountA * amountB).toFixed(2);

    // On-chain AMM createPool
    let chainTxId: string | undefined;
    if (chain.isChainReady()) {
      try {
        const rawA = Math.round(amountA);
        const rawB = Math.round(amountB);
        const rawVA = Math.round(parseFloat(body.virtualLiquidityA));
        const rawVB = Math.round(parseFloat(body.virtualLiquidityB));
        const result = await chain.createPoolOnChain(
          poolId, body.tokenA, body.tokenB,
          rawA, rawB, body.feeRateBps, body.protocolFeeShareBps, rawVA, rawVB,
        );
        chainTxId = result.txId;
        log.info(`On-chain createPool: ${poolId} → ${result.txId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`On-chain createPool FAILED: ${msg}`);
        return reply.status(500).send({ error: `On-chain pool creation failed: ${msg}` });
      }
    }

    const protocolAddr = chain.getProtocolAddress() || '3DAdm1n...pool';
    const pool: PoolRecord = {
      poolId,
      tokenA: body.tokenA,
      tokenASymbol: body.tokenASymbol,
      tokenB: body.tokenB,
      tokenBSymbol: body.tokenBSymbol,
      reserveA: body.initialAmountA,
      reserveB: body.initialAmountB,
      totalLpSupply: lpMinted,
      feeRateBps: body.feeRateBps,
      protocolFeeShareBps: body.protocolFeeShareBps,
      virtualLiquidityA: body.virtualLiquidityA,
      virtualLiquidityB: body.virtualLiquidityB,
      status: 'ACTIVE',
      tvlUsd: 0,
      volume24hUsd: 0,
      fees24hUsd: 0,
      apr: 0,
      lpPositions: [{
        address: protocolAddr,
        lpTokens: lpMinted,
        sharePercent: 100,
        seedAmountA: body.initialAmountA,
        seedAmountB: body.initialAmountB,
        seedTimestamp: Date.now(),
      }],
      createdAt: Date.now(),
      chainTxId,
    };
    POOLS.push(pool);
    log.info(`Pool created: ${pool.poolId} (${body.tokenASymbol}/${body.tokenBSymbol}), LP minted: ${lpMinted}${chainTxId ? `, chain tx: ${chainTxId}` : ''}`);    return pool;
  });

  // ── POST /admin/pools/:id/liquidity ───────────────────────────────────
  // State sync endpoint — the on-chain tx is signed by the user's wallet directly.
  // This endpoint updates the backend's in-memory pool state to match.

  app.post<{ Params: { id: string } }>('/admin/pools/:id/liquidity', async (req) => {
    const pool = POOLS.find((p) => p.poolId === req.params.id);
    if (!pool) throw { statusCode: 404, message: 'Pool not found' };
    const body = req.body as { amountA: string; amountB: string; providerAddress: string };
    const ratioA = parseFloat(body.amountA) / parseFloat(pool.reserveA);
    const lpMinted = (parseFloat(pool.totalLpSupply) * ratioA).toFixed(2);

    pool.reserveA = (parseFloat(pool.reserveA) + parseFloat(body.amountA)).toString();
    pool.reserveB = (parseFloat(pool.reserveB) + parseFloat(body.amountB)).toString();
    pool.totalLpSupply = (parseFloat(pool.totalLpSupply) + parseFloat(lpMinted)).toString();
    pool.lpPositions.push({
      address: body.providerAddress,
      lpTokens: lpMinted,
      sharePercent: 0,
      seedAmountA: body.amountA,
      seedAmountB: body.amountB,
      seedTimestamp: Date.now(),
    });
    const totalLp = parseFloat(pool.totalLpSupply);
    for (const lp of pool.lpPositions) {
      lp.sharePercent = parseFloat(((parseFloat(lp.lpTokens) / totalLp) * 100).toFixed(2));
    }
    log.info(`Liquidity state synced for ${pool.poolId}: ${lpMinted} LP to ${body.providerAddress}`);
    return { lpMinted };
  });

  // ── PUT /admin/pools/:id ──────────────────────────────────────────────

  app.put<{ Params: { id: string } }>('/admin/pools/:id', async (req) => {
    const pool = POOLS.find((p) => p.poolId === req.params.id);
    if (!pool) throw { statusCode: 404, message: 'Pool not found' };
    const updates = req.body as Record<string, unknown>;
    if (typeof updates['feeRateBps'] === 'number') pool.feeRateBps = updates['feeRateBps'];
    if (typeof updates['protocolFeeShareBps'] === 'number') pool.protocolFeeShareBps = updates['protocolFeeShareBps'];
    if (typeof updates['virtualLiquidityA'] === 'string') pool.virtualLiquidityA = updates['virtualLiquidityA'];
    if (typeof updates['virtualLiquidityB'] === 'string') pool.virtualLiquidityB = updates['virtualLiquidityB'];
    return pool;
  });

  // ── PUT /admin/pools/:id/status ───────────────────────────────────────

  const poolStatusSchema = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']) });

  app.put<{ Params: { id: string } }>('/admin/pools/:id/status', async (req) => {
    const pool = POOLS.find((p) => p.poolId === req.params.id);
    if (!pool) throw { statusCode: 404, message: 'Pool not found' };
    const { status } = poolStatusSchema.parse(req.body);
    pool.status = status;
    return pool;
  });

  // ── Start ─────────────────────────────────────────────────────────────

  // Start live price updater (CoinGecko + Binance every 30s)
  startPriceUpdater();

  // Initialize blockchain connection
  await chain.initChain();

  // Try to load on-chain dccTokenIds for existing synths
  if (chain.isChainReady()) {
    for (const asset of SYNTH_ASSETS) {
      try {
        const tokenId = await chain.readSynthDccTokenId(asset.syntheticAssetId);
        if (tokenId) {
          asset.dccTokenId = tokenId;
          log.info(`Loaded dccTokenId for ${asset.symbol}: ${tokenId.slice(0, 12)}...`);
        }
      } catch { /* not created on-chain yet */ }
    }
  }

  // ── Hydrate pools from on-chain state ──────────────────────────────────
  async function hydratePoolsFromChain() {
    if (!chain.isChainReady()) return;
    try {
      const data = await chain.readAllData('3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo');
      const count = typeof data['pools:count'] === 'number' ? data['pools:count'] : 0;
      const poolIds = new Set<string>();
      for (let i = 0; i < count; i++) {
        const id = data[`pools:list:${i}`];
        if (typeof id === 'string') poolIds.add(id);
      }
      for (const poolId of poolIds) {
        const onChain = await chain.readPool(poolId);
        if (!onChain) continue;
        const existing = POOLS.find(p => p.poolId === poolId);
        if (existing) {
          // Update reserves & state from chain
          existing.reserveA = String(onChain.reserveA);
          existing.reserveB = String(onChain.reserveB);
          existing.totalLpSupply = String(onChain.totalLpSupply);
          existing.feeRateBps = onChain.feeRateBps;
          existing.protocolFeeShareBps = onChain.protocolFeeShareBps;
          existing.virtualLiquidityA = String(onChain.virtualLiquidityA);
          existing.virtualLiquidityB = String(onChain.virtualLiquidityB);
          existing.status = onChain.status === 0 ? 'ACTIVE' : 'PAUSED';
        } else {
          // New pool discovered on chain — add it
          POOLS.push({
            poolId,
            tokenA: onChain.tokenA,
            tokenASymbol: onChain.tokenA,
            tokenB: onChain.tokenB,
            tokenBSymbol: onChain.tokenB,
            reserveA: String(onChain.reserveA),
            reserveB: String(onChain.reserveB),
            totalLpSupply: String(onChain.totalLpSupply),
            feeRateBps: onChain.feeRateBps,
            protocolFeeShareBps: onChain.protocolFeeShareBps,
            virtualLiquidityA: String(onChain.virtualLiquidityA),
            virtualLiquidityB: String(onChain.virtualLiquidityB),
            status: onChain.status === 0 ? 'ACTIVE' : 'PAUSED',
            tvlUsd: 0,
            volume24hUsd: 0,
            fees24hUsd: 0,
            apr: 0,
            lpPositions: [],
            createdAt: onChain.createdAt,
          });
          log.info(`Hydrated pool from chain: ${poolId} (${onChain.tokenA}/${onChain.tokenB})`);
        }
      }
      log.info(`Pool hydration complete — ${POOLS.length} pool(s) loaded`);
    } catch (err) {
      log.error(`Pool hydration failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Update TVL, volume, fees, APR after reserves are fresh
    await updatePoolStats().catch(err => log.warn(`Pool stats update failed: ${err}`));
  }

  await hydratePoolsFromChain();

  // Refresh pool reserves from chain every 15 seconds
  setInterval(() => { hydratePoolsFromChain().catch(() => {}); }, 15_000);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  log.info(`synthetic-service listening on :${config.PORT} — live prices enabled`);

  const shutdown = async () => {
    log.info('Shutting down...');
    await app.close();
    try { await closePool(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[synthetic-service] Fatal error:', err);
  process.exit(1);
});
