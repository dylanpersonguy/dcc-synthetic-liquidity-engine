// ============================================================================
// setup-chain.ts — One-time on-chain setup for DCC Synthetic Liquidity Engine
// ============================================================================
//
// Run AFTER deploy.ts. Grants roles and creates synthetic assets on-chain.
//
// Usage:
//   DCC_SEED="your seed phrase" pnpm --filter @dcc/contracts setup-chain
//
// What it does:
//   1. Grants admin roles on Factory + Vault to the deployer address
//   2. Grants mint auth (Factory) + mint role (Vault) to the deployer
//   3. Creates sSOL, sETH, sBTC, sXRP as on-chain synthetic tokens
// ============================================================================

import { invokeScript, broadcast, waitForTx, libs } from '@waves/waves-transactions';
import * as fs from 'fs';
import * as path from 'path';

const { crypto } = libs;

const SEED = process.env['DCC_SEED'];
if (!SEED) { console.error('ERROR: DCC_SEED is required'); process.exit(1); }

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';

// Deployer address (protocol wallet)
const DEPLOYER_ADDR = crypto.address(SEED, CHAIN_ID);

// Load deployed addresses
const addrPath = path.resolve(__dirname, '..', 'deployed-addresses.json');
const ADDRS: Record<string, string> = JSON.parse(fs.readFileSync(addrPath, 'utf-8'));

const FACTORY_ADDR = ADDRS['SyntheticAssetFactory'];
const VAULT_ADDR = ADDRS['SyntheticVault'];

// Derive contract seeds (must match deploy.ts nonces)
function deriveSeed(nonce: number): string { return `${SEED}#${nonce}`; }
const FACTORY_SEED = deriveSeed(2); // SyntheticAssetFactory nonce=2
const VAULT_SEED = deriveSeed(3);   // SyntheticVault nonce=3

// ── Helpers ────────────────────────────────────────────────────────────

async function invoke(
  dAppAddress: string,
  func: string,
  args: Array<{ type: string; value: string | number | boolean }>,
  seed: string,
  payment?: Array<{ assetId: string | null; amount: number }>,
  fee = 500000,
): Promise<string> {
  const tx = invokeScript(
    {
      dApp: dAppAddress,
      call: { function: func, args },
      payment: payment ?? [],
      chainId: CHAIN_ID,
      fee,
    },
    seed,
  );
  await broadcast(tx, NODE_URL);
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120_000 });
  return tx.id;
}

async function tryInvoke(
  label: string,
  dAppAddress: string,
  func: string,
  args: Array<{ type: string; value: string | number | boolean }>,
  seed: string,
  payment?: Array<{ assetId: string | null; amount: number }>,
  fee = 500000,
): Promise<boolean> {
  try {
    const txId = await invoke(dAppAddress, func, args, seed, payment, fee);
    console.log(`  ✓ ${label} → ${txId}`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    if (msg.includes('already') || msg.includes('Already') || msg.includes('exists')) {
      console.log(`  ⊘ ${label} → already done`);
      return true;
    }
    console.log(`  ✗ ${label} → ${msg}`);
    return false;
  }
}

// ── Synthetic Asset Definitions ────────────────────────────────────────

const SYNTHS = [
  {
    synthId: 'sSOL', symbol: 'sSOL', name: 'Synthetic SOL',
    underlyingAssetId: 'solana', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 115_000_000, // 115% in SCALE8
    supplyCap: 200_000_000_000, // 2000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sETH', symbol: 'sETH', name: 'Synthetic ETH',
    underlyingAssetId: 'ethereum', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 122_000_000,
    supplyCap: 10_000_000_000, // 100 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sBTC', symbol: 'sBTC', name: 'Synthetic BTC',
    underlyingAssetId: 'bitcoin', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 118_000_000,
    supplyCap: 500_000_000, // 5 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sXRP', symbol: 'sXRP', name: 'Synthetic XRP',
    underlyingAssetId: 'ripple', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 115_000_000,
    supplyCap: 5_000_000_000_000, // 50000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sBNB', symbol: 'sBNB', name: 'Synthetic BNB',
    underlyingAssetId: 'binancecoin', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 118_000_000,
    supplyCap: 50_000_000_000, // 500 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sADA', symbol: 'sADA', name: 'Synthetic ADA',
    underlyingAssetId: 'cardano', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 115_000_000,
    supplyCap: 10_000_000_000_000, // 100000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sDOGE', symbol: 'sDOGE', name: 'Synthetic DOGE',
    underlyingAssetId: 'dogecoin', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 115_000_000,
    supplyCap: 50_000_000_000_000, // 500000 * 1e8
    isRedeemable: true, riskTier: 'tier_3',
  },
  {
    synthId: 'sAVAX', symbol: 'sAVAX', name: 'Synthetic AVAX',
    underlyingAssetId: 'avalanche-2', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 118_000_000,
    supplyCap: 100_000_000_000, // 1000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sLINK', symbol: 'sLINK', name: 'Synthetic LINK',
    underlyingAssetId: 'chainlink', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 118_000_000,
    supplyCap: 500_000_000_000, // 5000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
  {
    synthId: 'sDOT', symbol: 'sDOT', name: 'Synthetic DOT',
    underlyingAssetId: 'polkadot', decimals: 8, backingModel: 0,
    backingAssetId: 'DUSD', targetBackingRatio: 118_000_000,
    supplyCap: 500_000_000_000, // 5000 * 1e8
    isRedeemable: true, riskTier: 'tier_2',
  },
];

// ── Main ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  DCC Chain Setup — Roles & Synthetic Assets');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Node:     ${NODE_URL}`);
  console.log(`  Deployer: ${DEPLOYER_ADDR}`);
  console.log(`  Factory:  ${FACTORY_ADDR}`);
  console.log(`  Vault:    ${VAULT_ADDR}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Grant admin roles (must use contract seeds — owner-only)
  console.log('Step 1: Granting admin roles...');

  await tryInvoke(
    'Factory.grantAdmin(deployer)',
    FACTORY_ADDR, 'grantAdmin',
    [{ type: 'string', value: DEPLOYER_ADDR }],
    FACTORY_SEED,
  );

  await tryInvoke(
    'Vault.grantVaultAdmin(deployer)',
    VAULT_ADDR, 'grantVaultAdmin',
    [{ type: 'string', value: DEPLOYER_ADDR }],
    VAULT_SEED,
  );

  // Step 2: Grant mint auth (deployer is now admin, signs with deployer seed)
  console.log('\nStep 2: Granting mint auth...');

  await tryInvoke(
    'Factory.grantMintAuth(deployer)',
    FACTORY_ADDR, 'grantMintAuth',
    [{ type: 'string', value: DEPLOYER_ADDR }],
    SEED!,
  );

  await tryInvoke(
    'Vault.grantMintRole(deployer)',
    VAULT_ADDR, 'grantMintRole',
    [{ type: 'string', value: DEPLOYER_ADDR }],
    SEED!,
  );

  // Step 3: Create synthetic assets on-chain
  console.log('\nStep 3: Creating synthetic assets on-chain...');

  for (const s of SYNTHS) {
    await tryInvoke(
      `Factory.createSyntheticAsset(${s.synthId})`,
      FACTORY_ADDR, 'createSyntheticAsset',
      [
        { type: 'string',  value: s.synthId },
        { type: 'string',  value: s.symbol },
        { type: 'string',  value: s.name },
        { type: 'string',  value: s.underlyingAssetId },
        { type: 'integer', value: s.decimals },
        { type: 'integer', value: s.backingModel },
        { type: 'string',  value: s.backingAssetId },
        { type: 'integer', value: s.targetBackingRatio },
        { type: 'integer', value: s.supplyCap },
        { type: 'boolean', value: s.isRedeemable },
        { type: 'string',  value: s.riskTier },
      ],
      SEED!,
      undefined,
      100500000, // Issue fee: 1.005 DCC per token creation
    );
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Setup complete!');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
