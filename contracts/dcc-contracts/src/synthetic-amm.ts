// ============================================================================
// SyntheticAMM — On-Chain Contract Interface
// ============================================================================
//
// Local AMM pools for trading synthetic assets on DCC.
// Supports pools like DCC/sSOL, USDC/sETH, DCC/sBTC.
//
// PHASE: 4 (Synthetic AMM + Orderbook)
//
// ============================================================================
// STATE KEYS
// ============================================================================
//
// pool:{poolId}:tokenA              -> AssetId
// pool:{poolId}:tokenB              -> AssetId
// pool:{poolId}:reserveA            -> u128
// pool:{poolId}:reserveB            -> u128
// pool:{poolId}:totalLpSupply       -> u128
// pool:{poolId}:feeRateBps          -> u32
// pool:{poolId}:protocolFeeShareBps -> u32
// pool:{poolId}:virtualLiquidityA   -> u128 (optional: boosts apparent depth)
// pool:{poolId}:virtualLiquidityB   -> u128
// pool:{poolId}:status              -> PoolStatus (ACTIVE | PAUSED | DISABLED)
//
// pool:{poolId}:lp:{address}        -> u128 (LP token balance)
//
// ============================================================================
// ACCESS CONTROL
// ============================================================================
//
// PUBLIC:
//   - swap, addLiquidity, removeLiquidity, getQuote, getReserves
//
// POOL_ADMIN_ROLE:
//   - createPool, updatePoolConfig, setPoolStatus
//
// Note: Virtual liquidity params are admin-only to prevent manipulation.
//
// ============================================================================
// EVENTS
// ============================================================================
//
// PoolCreated(poolId, tokenA, tokenB, feeRateBps)
// Swap(poolId, user, tokenIn, amountIn, tokenOut, amountOut, fee)
// LiquidityAdded(poolId, user, amountA, amountB, lpMinted)
// LiquidityRemoved(poolId, user, amountA, amountB, lpBurned)
// PoolConfigUpdated(poolId, field, oldValue, newValue)
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
// 1. Constant product: reserveA * reserveB >= k (after fees).
// 2. Virtual liquidity does NOT generate real yield; it only smooths
//    price impact. The pool's real reserves are always the truth.
// 3. LP tokens are pro-rata on real reserves (virtual not included).
// 4. Fee is deducted from input amount before swap calculation.
// 5. If either tokenA or tokenB is a synthetic with PAUSED status,
//    the pool must auto-pause.
//
// ============================================================================

export type PoolStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export interface PoolInfo {
  poolId: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  totalLpSupply: string;
  feeRateBps: number;
  protocolFeeShareBps: number;
  virtualLiquidityA: string;
  virtualLiquidityB: string;
  status: PoolStatus;
}

export interface ISyntheticAMM {
  // ── Admin Methods ──────────────────────────────────────────────────────

  /** @access POOL_ADMIN_ROLE */
  createPool(params: {
    tokenA: string;
    tokenB: string;
    initialAmountA: string;
    initialAmountB: string;
    feeRateBps: number;
    protocolFeeShareBps: number;
    virtualLiquidityA?: string;
    virtualLiquidityB?: string;
  }): Promise<{ poolId: string; lpMinted: string; txId: string }>;

  /** @access POOL_ADMIN_ROLE */
  updatePoolConfig(poolId: string, params: {
    feeRateBps?: number;
    protocolFeeShareBps?: number;
    virtualLiquidityA?: string;
    virtualLiquidityB?: string;
  }): Promise<{ txId: string }>;

  /** @access POOL_ADMIN_ROLE */
  setPoolStatus(poolId: string, status: PoolStatus): Promise<{ txId: string }>;

  // ── Public Methods ─────────────────────────────────────────────────────

  /** Execute a swap. */
  swap(params: {
    poolId: string;
    tokenIn: string;
    amountIn: string;
    minAmountOut: string;
  }): Promise<{ amountOut: string; fee: string; txId: string }>;

  /** Add liquidity to pool. */
  addLiquidity(params: {
    poolId: string;
    amountA: string;
    amountB: string;
    minLpTokens: string;
  }): Promise<{ lpMinted: string; txId: string }>;

  /** Remove liquidity from pool. */
  removeLiquidity(params: {
    poolId: string;
    lpTokens: string;
    minAmountA: string;
    minAmountB: string;
  }): Promise<{ amountA: string; amountB: string; txId: string }>;

  // ── Read Methods ───────────────────────────────────────────────────────

  getPool(poolId: string): Promise<PoolInfo | null>;
  getQuote(poolId: string, tokenIn: string, amountIn: string): Promise<{ amountOut: string; fee: string; priceImpact: string }>;
  getReserves(poolId: string): Promise<{ reserveA: string; reserveB: string }>;
  getLpBalance(poolId: string, address: string): Promise<string>;
  listPools(filters?: { tokenA?: string; tokenB?: string; status?: PoolStatus }): Promise<PoolInfo[]>;
}
