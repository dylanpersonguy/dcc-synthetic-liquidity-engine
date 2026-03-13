// ============================================================================
// chain.ts — DCC Blockchain Interaction Module for Synthetic Service
// ============================================================================
//
// Provides on-chain read/write for:
//   - Reading contract storage (vault state, synth info)
//   - Minting/burning synthetic tokens via Factory contract
//   - Recording mint/burn in Vault contract
//   - Reading vault summary
//
// ============================================================================

import { invokeScript, broadcast, waitForTx, libs } from '@waves/waves-transactions';

const { crypto } = libs;

// ── Configuration ──────────────────────────────────────────────────────

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';
const PROTOCOL_SEED = process.env['DCC_SEED'] ?? '';

// Contract addresses (from deployed-addresses.json)
const FACTORY_ADDR = process.env['FACTORY_ADDRESS'] ?? '3Dkd7yNsoU1oj4tp6zaYGWyaHbRBPtZn8VB';
const VAULT_ADDR   = process.env['VAULT_ADDRESS']   ?? '3DZhXEqSzqxkrcGjbXQm8QTNw4tHSM9YaZ6';
const AMM_ADDR     = process.env['AMM_ADDRESS']     ?? '3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo';

let chainReady = false;

export function isChainConfigured(): boolean {
  return PROTOCOL_SEED.length > 0;
}

// ── Node API Helpers ───────────────────────────────────────────────────

/** Read a single data entry from a contract's storage */
export async function readData(address: string, key: string): Promise<string | number | boolean | null> {
  try {
    const res = await fetch(`${NODE_URL}/addresses/data/${address}/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const entry = await res.json() as { key: string; type: string; value: string | number | boolean };
    return entry.value;
  } catch {
    return null;
  }
}

/** Read all data entries from a contract's storage */
export async function readAllData(address: string): Promise<Record<string, string | number | boolean>> {
  try {
    const res = await fetch(`${NODE_URL}/addresses/data/${address}`);
    if (!res.ok) return {};
    const entries = await res.json() as Array<{ key: string; type: string; value: string | number | boolean }>;
    const result: Record<string, string | number | boolean> = {};
    for (const e of entries) result[e.key] = e.value;
    return result;
  } catch {
    return {};
  }
}

/** Get DCC balance for an address */
export async function getBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`${NODE_URL}/addresses/balance/${address}`);
    if (!res.ok) return 0;
    const data = await res.json() as { address: string; balance: number };
    return data.balance;
  } catch {
    return 0;
  }
}

/** Get asset balance for an address */
export async function getAssetBalance(address: string, assetId: string): Promise<number> {
  try {
    const res = await fetch(`${NODE_URL}/assets/balance/${address}/${assetId}`);
    if (!res.ok) return 0;
    const data = await res.json() as { address: string; assetId: string; balance: number };
    return data.balance;
  } catch {
    return 0;
  }
}

// ── Contract Invoke Helper ─────────────────────────────────────────────

interface InvokeArg {
  type: 'string' | 'integer' | 'boolean' | 'binary';
  value: string | number | boolean;
}

async function invokeContract(
  dApp: string,
  func: string,
  args: InvokeArg[],
  seed: string,
  payment?: Array<{ assetId: string | null; amount: number }>,
  fee = 500000,
): Promise<{ txId: string }> {
  const tx = invokeScript(
    {
      dApp,
      call: { function: func, args: args as any },
      payment: payment ?? [],
      chainId: CHAIN_ID,
      fee,
    },
    seed,
  );
  try {
    await broadcast(tx, NODE_URL);
  } catch (e: any) {
    // broadcast rejects with the node's JSON error body
    const msg = e?.message || (typeof e === 'object' ? JSON.stringify(e) : String(e));
    throw new Error(`broadcast ${func}: ${msg}`);
  }
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 60_000 });
  return { txId: tx.id };
}

// ── Vault Read Functions ───────────────────────────────────────────────

export interface OnChainVaultState {
  totalBackingUsd: number;
  totalLiabilityUsd: number;
  backingRatio: number;
}

const SCALE8 = 100_000_000;

export async function readVaultSummary(): Promise<OnChainVaultState> {
  const [totalBacking, totalLiability, ratio] = await Promise.all([
    readData(VAULT_ADDR, 'vault:totalBacking'),
    readData(VAULT_ADDR, 'vault:totalLiability'),
    readData(VAULT_ADDR, 'vault:backingRatio'),
  ]);

  return {
    totalBackingUsd: typeof totalBacking === 'number' ? totalBacking / SCALE8 : 0,
    totalLiabilityUsd: typeof totalLiability === 'number' ? totalLiability / SCALE8 : 0,
    backingRatio: typeof ratio === 'number' ? ratio / SCALE8 : 0,
  };
}

export async function readSynthSupply(synthId: string): Promise<number> {
  const val = await readData(FACTORY_ADDR, `synth:${synthId}:totalSupply`);
  return typeof val === 'number' ? val / SCALE8 : 0;
}

export async function readSynthDccTokenId(synthId: string): Promise<string | null> {
  const val = await readData(FACTORY_ADDR, `synth:${synthId}:dccTokenId`);
  return typeof val === 'string' ? val : null;
}

// ── Mint on-chain ──────────────────────────────────────────────────────

export interface MintResult {
  factoryTxId: string;
  vaultTxId: string;
}

/**
 * Mint synthetic tokens on-chain:
 * 1. Factory.mint(synthId, recipient, amount) — reissues & transfers tokens
 * 2. Vault.recordMint(synthId, amount, markPrice) — updates vault accounting
 */
export async function mintOnChain(
  synthId: string,
  recipient: string,
  amount: number,     // in SCALE8 (raw integer)
  markPrice: number,  // in SCALE8 (raw integer)
): Promise<MintResult> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured — cannot sign transactions');

  // 1. Factory.mint
  const factoryResult = await invokeContract(
    FACTORY_ADDR,
    'mint',
    [
      { type: 'string',  value: synthId },
      { type: 'string',  value: recipient },
      { type: 'integer', value: amount },
    ],
    PROTOCOL_SEED,
  );

  // 2. Vault.recordMint
  const vaultResult = await invokeContract(
    VAULT_ADDR,
    'recordMint',
    [
      { type: 'string',  value: synthId },
      { type: 'integer', value: amount },
      { type: 'integer', value: markPrice },
    ],
    PROTOCOL_SEED,
  );

  return { factoryTxId: factoryResult.txId, vaultTxId: vaultResult.txId };
}

// ── Burn on-chain ──────────────────────────────────────────────────────

export interface BurnResult {
  factoryTxId: string;
  vaultTxId: string;
}

/**
 * Burn synthetic tokens on-chain:
 * 1. Factory.burn(synthId, amount) — burns tokens (caller must attach payment)
 * 2. Vault.recordBurn(synthId, amount, markPrice) — updates vault accounting
 *
 * NOTE: For Factory.burn, the protocol must hold the synthetic tokens.
 * In the current flow, the backend burns on behalf of the user.
 */
export async function burnOnChain(
  synthId: string,
  amount: number,    // in SCALE8
  markPrice: number, // in SCALE8
  tokenAssetId: string,
): Promise<BurnResult> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured — cannot sign transactions');

  // 1. Factory.burn (with payment of synthetic tokens)
  const factoryResult = await invokeContract(
    FACTORY_ADDR,
    'burn',
    [
      { type: 'string',  value: synthId },
      { type: 'integer', value: amount },
    ],
    PROTOCOL_SEED,
    [{ assetId: tokenAssetId, amount }],
  );

  // 2. Vault.recordBurn
  const vaultResult = await invokeContract(
    VAULT_ADDR,
    'recordBurn',
    [
      { type: 'string',  value: synthId },
      { type: 'integer', value: amount },
      { type: 'integer', value: markPrice },
    ],
    PROTOCOL_SEED,
  );

  return { factoryTxId: factoryResult.txId, vaultTxId: vaultResult.txId };
}

// ── Initialize ─────────────────────────────────────────────────────────

export async function initChain(): Promise<void> {
  if (!PROTOCOL_SEED) {
    console.warn('[chain] DCC_SEED not set — running in paper mode only');
    return;
  }

  const protocolAddr = crypto.address(PROTOCOL_SEED, CHAIN_ID);
  console.log(`[chain] Protocol address: ${protocolAddr}`);
  console.log(`[chain] Factory: ${FACTORY_ADDR}`);
  console.log(`[chain] Vault:   ${VAULT_ADDR}`);
  console.log(`[chain] Node:    ${NODE_URL}`);

  // Verify node connectivity
  try {
    const res = await fetch(`${NODE_URL}/blocks/height`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { height: number };
    console.log(`[chain] Connected — block height: ${data.height}`);
    chainReady = true;
  } catch (err) {
    console.warn(`[chain] Cannot reach DCC node at ${NODE_URL}: ${err}`);
    console.warn('[chain] On-chain operations will be skipped');
  }

  // Check if deploy has been set up
  if (chainReady) {
    const mintAuth = await readData(FACTORY_ADDR, `mintAuth:${protocolAddr}`);
    if (mintAuth === true) {
      console.log('[chain] Mint authority confirmed ✓');
    } else {
      console.warn('[chain] WARNING: Protocol address does not have mint authority on Factory');
      console.warn('[chain] Run: DCC_SEED="..." pnpm --filter @dcc/contracts setup-chain');
    }

    // Read on-chain vault summary
    const vault = await readVaultSummary();
    console.log(`[chain] Vault — Backing: $${vault.totalBackingUsd.toFixed(2)}, Liability: $${vault.totalLiabilityUsd.toFixed(2)}`);

    // Check AMM admin
    const ammAdmin = await readData(AMM_ADDR, `admin:${protocolAddr}`);
    if (ammAdmin === true) {
      console.log('[chain] AMM admin confirmed ✓');
    } else {
      console.warn('[chain] WARNING: Protocol address does not have admin on AMM');
    }
  }
}

export function isChainReady(): boolean {
  return chainReady;
}

export function getProtocolAddress(): string {
  return PROTOCOL_SEED ? crypto.address(PROTOCOL_SEED, CHAIN_ID) : '';
}

// ── AMM On-Chain Functions ──────────────────────────────────────────────

export interface AmmPoolOnChain {
  poolId: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalLpSupply: number;
  feeRateBps: number;
  protocolFeeShareBps: number;
  virtualLiquidityA: number;
  virtualLiquidityB: number;
  status: number;
  createdAt: number;
  lpAssetId: string | null;
}

export async function readPool(poolId: string): Promise<AmmPoolOnChain | null> {
  const status = await readData(AMM_ADDR, `pool:${poolId}:status`);
  if (status === null || status === undefined) return null;
  const [tokenA, tokenB, reserveA, reserveB, totalLp, feeRate, protoFee, vA, vB, createdAt, lpAssetId] = await Promise.all([
    readData(AMM_ADDR, `pool:${poolId}:tokenA`),
    readData(AMM_ADDR, `pool:${poolId}:tokenB`),
    readData(AMM_ADDR, `pool:${poolId}:reserveA`),
    readData(AMM_ADDR, `pool:${poolId}:reserveB`),
    readData(AMM_ADDR, `pool:${poolId}:totalLpSupply`),
    readData(AMM_ADDR, `pool:${poolId}:feeRateBps`),
    readData(AMM_ADDR, `pool:${poolId}:protocolFeeShareBps`),
    readData(AMM_ADDR, `pool:${poolId}:virtualLiquidityA`),
    readData(AMM_ADDR, `pool:${poolId}:virtualLiquidityB`),
    readData(AMM_ADDR, `pool:${poolId}:createdAt`),
    readData(AMM_ADDR, `pool:${poolId}:lpAssetId`),
  ]);
  return {
    poolId,
    tokenA: String(tokenA ?? ''),
    tokenB: String(tokenB ?? ''),
    reserveA: typeof reserveA === 'number' ? reserveA : 0,
    reserveB: typeof reserveB === 'number' ? reserveB : 0,
    totalLpSupply: typeof totalLp === 'number' ? totalLp : 0,
    feeRateBps: typeof feeRate === 'number' ? feeRate : 30,
    protocolFeeShareBps: typeof protoFee === 'number' ? protoFee : 0,
    virtualLiquidityA: typeof vA === 'number' ? vA : 0,
    virtualLiquidityB: typeof vB === 'number' ? vB : 0,
    status: typeof status === 'number' ? status : -1,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    lpAssetId: typeof lpAssetId === 'string' ? lpAssetId : null,
  };
}

export async function readPoolLpAssetId(poolId: string): Promise<string | null> {
  const val = await readData(AMM_ADDR, `pool:${poolId}:lpAssetId`);
  return typeof val === 'string' ? val : null;
}

export async function createPoolOnChain(
  poolId: string,
  tokenA: string,
  tokenB: string,
  initialAmountA: number,
  initialAmountB: number,
  feeRateBps: number,
  protocolFeeShareBps: number,
  virtualLiquidityA: number,
  virtualLiquidityB: number,
): Promise<{ txId: string }> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured');
  // createPool issues an LP token → extra 1 DCC fee
  return invokeContract(
    AMM_ADDR,
    'createPool',
    [
      { type: 'string',  value: poolId },
      { type: 'string',  value: tokenA },
      { type: 'string',  value: tokenB },
      { type: 'integer', value: initialAmountA },
      { type: 'integer', value: initialAmountB },
      { type: 'integer', value: feeRateBps },
      { type: 'integer', value: protocolFeeShareBps },
      { type: 'integer', value: virtualLiquidityA },
      { type: 'integer', value: virtualLiquidityB },
    ],
    PROTOCOL_SEED,
    [],
    100500000,
  );
}

export async function addLiquidityOnChain(
  poolId: string,
  amountA: number,
  amountB: number,
  minLpTokens: number,
): Promise<{ txId: string }> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured');
  return invokeContract(
    AMM_ADDR,
    'addLiquidity',
    [
      { type: 'string',  value: poolId },
      { type: 'integer', value: amountA },
      { type: 'integer', value: amountB },
      { type: 'integer', value: minLpTokens },
    ],
    PROTOCOL_SEED,
  );
}

export async function removeLiquidityOnChain(
  poolId: string,
  lpTokens: number,
  minAmountA: number,
  minAmountB: number,
  lpAssetId: string,
): Promise<{ txId: string }> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured');
  return invokeContract(
    AMM_ADDR,
    'removeLiquidity',
    [
      { type: 'string',  value: poolId },
      { type: 'integer', value: minAmountA },
      { type: 'integer', value: minAmountB },
    ],
    PROTOCOL_SEED,
    [{ assetId: lpAssetId, amount: lpTokens }],
  );
}

export async function deletePoolOnChain(poolId: string): Promise<{ txId: string }> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured');
  return invokeContract(
    AMM_ADDR,
    'deletePool',
    [{ type: 'string', value: poolId }],
    PROTOCOL_SEED,
  );
}

export async function swapOnChain(
  poolId: string,
  tokenIn: string,
  amountIn: number,
  minAmountOut: number,
): Promise<{ txId: string }> {
  if (!PROTOCOL_SEED) throw new Error('DCC_SEED not configured');
  return invokeContract(
    AMM_ADDR,
    'swap',
    [
      { type: 'string',  value: poolId },
      { type: 'string',  value: tokenIn },
      { type: 'integer', value: amountIn },
      { type: 'integer', value: minAmountOut },
    ],
    PROTOCOL_SEED,
  );
}

export { SCALE8, NODE_URL, CHAIN_ID, FACTORY_ADDR, VAULT_ADDR, AMM_ADDR };
