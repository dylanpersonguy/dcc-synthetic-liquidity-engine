// ============================================================================
// SyntheticVault — On-Chain Contract Interface
// ============================================================================
//
// Global accounting for synthetic asset backing and liabilities.
// This is the protocol's balance sheet for synthetic exposure.
//
// PHASE: 3 (Synthetic Assets)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// vault:totalBackingValue                  -> u128 (hub asset denominated)
// vault:totalLiabilityValue                -> u128
// vault:backingRatio                       -> u128 (fixed-point)
//
// vault:asset:{synthId}:supply             -> u128
// vault:asset:{synthId}:markPrice          -> u128 (last oracle price)
// vault:asset:{synthId}:liabilityValue     -> u128
// vault:asset:{synthId}:backingAllocated   -> u128
//
// vault:reserves:{assetId}                 -> u128 (backing asset reserves)
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// VAULT_ADMIN_ROLE:
//   - depositReserves, withdrawReserves, updateMarkPrice
//
// MINT_ROLE (same as SyntheticAssetFactory):
//   - recordMint, recordBurn (called alongside factory mint/burn)
//
// TREASURY_ROLE:
//   - withdrawReserves (subject to limits)
//
// ============================================================================
// EVENTS
// ============================================================================
//
// ReservesDeposited(assetId, amount, newTotal, actor)
// ReservesWithdrawn(assetId, amount, newTotal, actor)
// MarkPriceUpdated(synthId, oldPrice, newPrice)
// MintRecorded(synthId, amount, newLiability)
// BurnRecorded(synthId, amount, newLiability)
// BackingRatioUpdated(oldRatio, newRatio)
// BackingRatioBreached(currentRatio, threshold)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. backingRatio = totalBackingValue / totalLiabilityValue (0 if no liability).
// 2. If backingRatio < target, emit BackingRatioBreached and alert risk system.
// 3. withdrawReserves cannot reduce backingRatio below a hard floor (e.g., 80%).
// 4. recordMint increases liability; recordBurn decreases it.
// 5. markPrice must come from a non-stale oracle; otherwise operations halt.
//
// ============================================================================

import type { SyntheticVaultState } from '@dcc/types';

export interface ISyntheticVault {
  // ── Admin Methods ──────────────────────────────────────────────────────

  /** Deposit backing reserves. @access VAULT_ADMIN_ROLE */
  depositReserves(assetId: string, amount: string): Promise<{ txId: string }>;

  /** Withdraw reserves (subject to backing ratio floor). @access TREASURY_ROLE */
  withdrawReserves(assetId: string, amount: string): Promise<{ txId: string }>;

  /** Update oracle mark price for a synthetic asset. @access VAULT_ADMIN_ROLE */
  updateMarkPrice(synthId: string, price: string): Promise<{ txId: string }>;

  // ── Accounting Methods ─────────────────────────────────────────────────

  /** Record synthetic mint — increases liability. @access MINT_ROLE */
  recordMint(synthId: string, amount: string, markPrice: string): Promise<{ txId: string }>;

  /** Record synthetic burn — decreases liability. @access MINT_ROLE */
  recordBurn(synthId: string, amount: string, markPrice: string): Promise<{ txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  getVaultState(): Promise<SyntheticVaultState>;
  getAssetLiability(synthId: string): Promise<{ supply: string; markPrice: string; liabilityValue: string }>;
  getReserveBalance(assetId: string): Promise<string>;
  getBackingRatio(): Promise<string>;
}
