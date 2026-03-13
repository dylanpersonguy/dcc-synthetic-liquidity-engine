// ============================================================================
// SyntheticAssetFactory — On-Chain Contract Interface
// ============================================================================
//
// Defines and manages synthetic asset configurations. Mint/burn authority
// is restricted to approved protocol modules (SyntheticVault, SyntheticAMM).
//
// PHASE: 3 (Synthetic Assets)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// synth:{synthId}:symbol             -> string
// synth:{synthId}:name               -> string
// synth:{synthId}:underlying         -> AssetId
// synth:{synthId}:decimals           -> u8
// synth:{synthId}:dccTokenId         -> string (on-chain token)
// synth:{synthId}:backingModel       -> SyntheticBackingModel
// synth:{synthId}:backingAsset       -> AssetId
// synth:{synthId}:targetBackingRatio -> u128
// synth:{synthId}:totalSupply        -> u128
// synth:{synthId}:supplyCap          -> u128
// synth:{synthId}:isRedeemable       -> bool
// synth:{synthId}:status             -> SyntheticAssetStatus
//
// synth:{synthId}:oracle:{idx}       -> { sourceId, venueId, weight, maxStalenessMs }
// synth:{synthId}:oracleCount        -> u32
//
// synths:count                       -> u32
// synths:list:{index}                -> SyntheticAssetId
//
// mintAuth:{module}                  -> bool (approved minters)
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// SYNTH_ADMIN_ROLE:
//   - createSyntheticAsset, updateSyntheticConfig, setStatus
//
// MINT_ROLE:
//   - mint, burn (only modules in mintAuth)
//
// ============================================================================
// EVENTS
// ============================================================================
//
// SyntheticAssetCreated(synthId, symbol, underlying, backingModel)
// SyntheticAssetConfigUpdated(synthId, field, oldValue, newValue)
// SyntheticAssetStatusChanged(synthId, oldStatus, newStatus)
// SyntheticMinted(synthId, to, amount, totalSupply)
// SyntheticBurned(synthId, from, amount, totalSupply)
// MintAuthGranted(module)
// MintAuthRevoked(module)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. totalSupply <= supplyCap (hard limit, revert on breach).
// 2. Only modules in mintAuth can call mint/burn. No backdoors.
// 3. Burn can only destroy tokens the caller actually holds or is authorized over.
// 4. If status == WIND_DOWN, new mints are rejected; burns are allowed.
// 5. At least 1 oracle source must be configured before status can be ACTIVE.
//
// ============================================================================

import type { SyntheticAsset, SyntheticAssetStatus, SyntheticBackingModel } from '@dcc/types';

export interface ISyntheticAssetFactory {
  // ── Admin Methods ──────────────────────────────────────────────────────

  /** @access SYNTH_ADMIN_ROLE */
  createSyntheticAsset(params: {
    symbol: string;
    name: string;
    underlyingAssetId: string;
    decimals: number;
    backingModel: SyntheticBackingModel;
    backingAssetId: string;
    targetBackingRatio: string;
    supplyCap: string;
    isRedeemable: boolean;
    oracleSources: Array<{
      sourceId: string;
      venueId: string;
      weight: number;
      maxStalenessMs: number;
    }>;
  }): Promise<{ syntheticAssetId: string; dccTokenId: string; txId: string }>;

  /** @access SYNTH_ADMIN_ROLE */
  updateSyntheticConfig(synthId: string, params: {
    supplyCap?: string;
    targetBackingRatio?: string;
    isRedeemable?: boolean;
    oracleSources?: Array<{
      sourceId: string;
      venueId: string;
      weight: number;
      maxStalenessMs: number;
    }>;
  }): Promise<{ txId: string }>;

  /** @access SYNTH_ADMIN_ROLE */
  setStatus(synthId: string, status: SyntheticAssetStatus): Promise<{ txId: string }>;

  /** @access SYNTH_ADMIN_ROLE */
  grantMintAuth(moduleAddress: string): Promise<{ txId: string }>;

  /** @access SYNTH_ADMIN_ROLE */
  revokeMintAuth(moduleAddress: string): Promise<{ txId: string }>;

  // ── Mint/Burn Methods ──────────────────────────────────────────────────

  /** @access MINT_ROLE */
  mint(synthId: string, to: string, amount: string): Promise<{ txId: string; newTotalSupply: string }>;

  /** @access MINT_ROLE */
  burn(synthId: string, from: string, amount: string): Promise<{ txId: string; newTotalSupply: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  getSyntheticAsset(synthId: string): Promise<SyntheticAsset | null>;
  listSyntheticAssets(): Promise<SyntheticAsset[]>;
  getTotalSupply(synthId: string): Promise<string>;
  getSupplyCap(synthId: string): Promise<string>;
  isMintAuthorized(moduleAddress: string): Promise<boolean>;
}
