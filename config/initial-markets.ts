// ============================================================================
// Initial Market Configuration — Seed Data
// ============================================================================
//
// This file defines the first markets to register in PairRegistry at launch.
// Each entry includes recommended mode, risk tier, and justification.
// ============================================================================

import type { MarketMode, RiskTier, MarketStatus } from '@dcc/types';

export interface MarketSeedEntry {
  baseSymbol: string;
  quoteSymbol: string;
  primaryMode: MarketMode;
  initialStatus: MarketStatus;
  riskTier: RiskTier;
  maxTradeSizeUsd: number;
  maxDailyVolumeUsd: number;
  externalVenues: string[];
  notes: string;
}

export const INITIAL_MARKETS: MarketSeedEntry[] = [
  // ── DCC/USDC — native, local liquidity ─────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'USDC',
    primaryMode: 'NATIVE',
    initialStatus: 'ACTIVE',
    riskTier: 'TIER_1',
    maxTradeSizeUsd: 50_000,
    maxDailyVolumeUsd: 1_000_000,
    externalVenues: [],
    notes: 'Anchor pair. Both assets native on DCC. Local AMM pool. Phase 0.',
  },

  // ── DCC/SOL — teleport, Jupiter-routed ─────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'SOL',
    primaryMode: 'TELEPORT',
    initialStatus: 'QUOTE_ONLY', // Phase 1: quote only; Phase 2: live
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 10_000,
    maxDailyVolumeUsd: 200_000,
    externalVenues: ['jupiter', 'raydium'],
    notes: 'Teleport via DCC→USDC(local)→SOL(Jupiter). Requires relayer. Phase 1 quote, Phase 2 live.',
  },

  // ── DCC/ETH — teleport, Uniswap-routed ────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'ETH',
    primaryMode: 'TELEPORT',
    initialStatus: 'QUOTE_ONLY',
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 10_000,
    maxDailyVolumeUsd: 200_000,
    externalVenues: ['uniswap'],
    notes: 'Teleport via DCC→USDC(local)→ETH(Uniswap). Phase 1 quote, Phase 2 live.',
  },

  // ── DCC/BTC — synthetic only initially ─────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'BTC',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'QUOTE_ONLY',
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 5_000,
    maxDailyVolumeUsd: 100_000,
    externalVenues: ['uniswap'], // price reference from Uniswap WBTC
    notes: 'sBTC synthetic. No direct BTC bridge initially. Quote from Uniswap WBTC. Phase 3.',
  },

  // ── USDC/SOL — teleport, Jupiter-routed ────────────────────────────────
  {
    baseSymbol: 'USDC',
    quoteSymbol: 'SOL',
    primaryMode: 'TELEPORT',
    initialStatus: 'QUOTE_ONLY',
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 25_000,
    maxDailyVolumeUsd: 500_000,
    externalVenues: ['jupiter', 'raydium'],
    notes: 'Direct hub→SOL. Single-leg teleport. High demand pair. Phase 1 quote, Phase 2 live.',
  },

  // ── USDC/ETH — teleport, Uniswap-routed ───────────────────────────────
  {
    baseSymbol: 'USDC',
    quoteSymbol: 'ETH',
    primaryMode: 'TELEPORT',
    initialStatus: 'QUOTE_ONLY',
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 25_000,
    maxDailyVolumeUsd: 500_000,
    externalVenues: ['uniswap'],
    notes: 'Direct hub→ETH. Single-leg teleport. Phase 1 quote, Phase 2 live.',
  },

  // ── DCC/sSOL — synthetic ──────────────────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'sSOL',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'DISABLED', // Phase 3
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 10_000,
    maxDailyVolumeUsd: 200_000,
    externalVenues: ['jupiter'],
    notes: 'Synthetic SOL on DCC. Local AMM pool Phase 4. Redeemable Phase 5.',
  },

  // ── DCC/sETH — synthetic ──────────────────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'sETH',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'DISABLED', // Phase 3
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 10_000,
    maxDailyVolumeUsd: 200_000,
    externalVenues: ['uniswap'],
    notes: 'Synthetic ETH on DCC. Price from Uniswap.',
  },

  // ── DCC/sBTC — synthetic ──────────────────────────────────────────────
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'sBTC',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'DISABLED', // Phase 3
    riskTier: 'TIER_2',
    maxTradeSizeUsd: 5_000,
    maxDailyVolumeUsd: 100_000,
    externalVenues: ['uniswap'],
    notes: 'Synthetic BTC on DCC. Price from Uniswap WBTC.',
  },

  // ── Long-tail (Phase 5+) ──────────────────────────────────────────────
  // sBONK, sWIF — listed here as placeholders; DISABLED until Phase 5.
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'sBONK',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'DISABLED',
    riskTier: 'TIER_3',
    maxTradeSizeUsd: 2_000,
    maxDailyVolumeUsd: 50_000,
    externalVenues: ['jupiter'],
    notes: 'Long-tail Solana memecoin. Synthetic-only. Phase 5.',
  },
  {
    baseSymbol: 'DCC',
    quoteSymbol: 'sWIF',
    primaryMode: 'SYNTHETIC',
    initialStatus: 'DISABLED',
    riskTier: 'TIER_3',
    maxTradeSizeUsd: 2_000,
    maxDailyVolumeUsd: 50_000,
    externalVenues: ['jupiter'],
    notes: 'Long-tail Solana memecoin. Synthetic-only. Phase 5.',
  },
];
