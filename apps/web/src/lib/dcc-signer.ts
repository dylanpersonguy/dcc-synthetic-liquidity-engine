// ============================================================================
// DCC Signer — seed-phrase wallet with direct tx signing
// ============================================================================
//
// Uses @decentralchain/waves-transactions directly for key derivation and
// transaction signing. Bypasses the Signer class entirely to avoid its
// getNetworkByte() HTTP call which fails with CORS in the browser.
// ============================================================================

import {
  libs,
  invokeScript,
  broadcast,
} from '@decentralchain/waves-transactions';

const DCC_NODE_URL =
  import.meta.env['VITE_DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const DCC_CHAIN_ID = 63; // '?' character — addresses start with 3D

// ── Wallet Session ─────────────────────────────────────────────────────

let _seed: string | null = null;

export interface UserData {
  address: string;
  publicKey: string;
}

export function loginWithSeed(seedPhrase: string): UserData {
  const s = seedPhrase.trim();
  if (!s) throw new Error('Seed phrase must not be empty');
  _seed = s;
  return {
    address: libs.crypto.address(s, DCC_CHAIN_ID),
    publicKey: libs.crypto.publicKey(s),
  };
}

export function logoutSigner(): void {
  _seed = null;
}

function requireSeed(): string {
  if (!_seed) throw new Error('Wallet not connected — enter your seed phrase first');
  return _seed;
}

// ── AMM Contract Interaction ───────────────────────────────────────────

const AMM_ADDRESS =
  import.meta.env['VITE_AMM_ADDRESS'] ?? '3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo';

export { AMM_ADDRESS };

/**
 * Sign and broadcast addLiquidity via user wallet.
 * LP tokens go to the seed-phrase owner (i.caller on-chain).
 */
export async function signAddLiquidity(
  poolId: string,
  amountA: number,
  amountB: number,
  minLpTokens: number,
): Promise<string> {
  const seed = requireSeed();
  const tx = invokeScript(
    {
      dApp: AMM_ADDRESS,
      call: {
        function: 'addLiquidity',
        args: [
          { type: 'string', value: poolId },
          { type: 'integer', value: amountA },
          { type: 'integer', value: amountB },
          { type: 'integer', value: minLpTokens },
        ],
      },
      payment: [],
      fee: 500000,
      chainId: DCC_CHAIN_ID,
    },
    seed,
  );
  let result;
  try {
    result = await broadcast(tx, DCC_NODE_URL);
  } catch (e: any) {
    const msg = e?.data?.message || e?.message || 'Broadcast failed';
    throw new Error(msg);
  }
  return result.id;
}

/**
 * Sign and broadcast removeLiquidity via user wallet.
 * User must attach LP tokens as payment.
 */
export async function signRemoveLiquidity(
  poolId: string,
  lpTokens: number,
  lpAssetId: string,
  minAmountA: number,
  minAmountB: number,
): Promise<string> {
  const seed = requireSeed();
  const tx = invokeScript(
    {
      dApp: AMM_ADDRESS,
      call: {
        function: 'removeLiquidity',
        args: [
          { type: 'string', value: poolId },
          { type: 'integer', value: minAmountA },
          { type: 'integer', value: minAmountB },
        ],
      },
      payment: [{ assetId: lpAssetId, amount: lpTokens }],
      fee: 500000,
      chainId: DCC_CHAIN_ID,
    },
    seed,
  );
  let result;
  try {
    result = await broadcast(tx, DCC_NODE_URL);
  } catch (e: any) {
    const msg = e?.data?.message || e?.message || 'Broadcast failed';
    throw new Error(msg);
  }
  return result.id;
}

/**
 * Sign and broadcast swap via user wallet on the on-chain AMM.
 * RIDE function: swap(poolId, tokenIn, amountIn, minAmountOut)
 */
export async function signSwap(
  poolId: string,
  tokenIn: string,
  amountIn: number,
  minAmountOut: number,
): Promise<string> {
  const seed = requireSeed();
  const tx = invokeScript(
    {
      dApp: AMM_ADDRESS,
      call: {
        function: 'swap',
        args: [
          { type: 'string', value: poolId },
          { type: 'string', value: tokenIn },
          { type: 'integer', value: amountIn },
          { type: 'integer', value: minAmountOut },
        ],
      },
      payment: [],
      fee: 500000,
      chainId: DCC_CHAIN_ID,
    },
    seed,
  );
  let result;
  try {
    result = await broadcast(tx, DCC_NODE_URL);
  } catch (e: any) {
    const msg = e?.data?.message || e?.message || 'Broadcast failed';
    throw new Error(msg);
  }
  return result.id;
}
