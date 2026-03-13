// ============================================================================
// redeploy-amm.ts — Redeploy SyntheticAMM.ride with real LP token support
// ============================================================================
//
// Usage:
//   DCC_SEED="..." pnpm --filter @dcc/contracts redeploy-amm
//
// Steps:
//   1. Compile updated SyntheticAMM.ride
//   2. Deploy to existing AMM account (nonce 6)
//   3. Re-grant admin to deployer
//   4. Delete stale pool data (old virtual LP pools)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { setScript, broadcast, waitForTx, invokeScript, libs } from '@waves/waves-transactions';

const { crypto } = libs;

const SEED = process.env['DCC_SEED'];
if (!SEED) {
  console.error('ERROR: DCC_SEED environment variable is required');
  process.exit(1);
}

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';
const AMM_NONCE = 6;

function deriveSeed(baseSeed: string, nonce: number): string {
  return `${baseSeed}#${nonce}`;
}

function getAddress(seed: string, chainId: string): string {
  return crypto.address(seed, chainId);
}

async function compileRide(source: string): Promise<string> {
  const rideJs = await import('@waves/ride-js');
  const compileFn = rideJs.compile ?? rideJs.default?.compile;
  if (!compileFn) throw new Error('Could not find compile function in @waves/ride-js');
  const result = compileFn(source);
  if ('error' in result) {
    throw new Error(`RIDE compilation error: ${result.error}`);
  }
  return result.result.base64;
}

async function main() {
  const ammSeed = deriveSeed(SEED!, AMM_NONCE);
  const ammAddr = getAddress(ammSeed, CHAIN_ID);
  const deployerAddr = getAddress(SEED!, CHAIN_ID);

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Redeploy SyntheticAMM (Real LP Tokens)  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  AMM Address:  ${ammAddr}`);
  console.log(`  Deployer:     ${deployerAddr}`);
  console.log(`  Node:         ${NODE_URL}`);
  console.log();

  // ── Step 1: Check AMM balance ─────────────────────────────────────
  const balRes = await fetch(`${NODE_URL}/addresses/balance/${ammAddr}`);
  const balData = await balRes.json() as { balance: number };
  console.log(`  AMM balance:  ${balData.balance} satoshis (${(balData.balance / 100_000_000).toFixed(3)} DCC)`);
  
  if (balData.balance < 1500000) {
    console.log('  WARNING: AMM needs at least 0.014 DCC for setScript fee');
    console.log('  Transferring 0.02 DCC from deployer...');
    const { transfer } = await import('@waves/waves-transactions');
    const txT = transfer({
      recipient: ammAddr,
      amount: 2000000,
      chainId: CHAIN_ID,
      fee: 500000,
    }, SEED!);
    await broadcast(txT, NODE_URL);
    await waitForTx(txT.id, { apiBase: NODE_URL, timeout: 60000 });
    console.log(`  ✓ Funded AMM: ${txT.id}\n`);
  }

  // ── Step 2: Compile ───────────────────────────────────────────────
  const rideFile = path.resolve(__dirname, '..', 'ride', 'SyntheticAMM.ride');
  const source = fs.readFileSync(rideFile, 'utf-8');
  console.log('Step 1: Compiling SyntheticAMM.ride...');
  console.log(`  Source: ${source.length} chars`);
  const compiledBase64 = await compileRide(source);
  console.log(`  Compiled: ${compiledBase64.length} chars (base64)\n`);

  // ── Step 3: Deploy ────────────────────────────────────────────────
  console.log('Step 2: Deploying to AMM account...');
  const tx = setScript(
    {
      script: `base64:${compiledBase64}`,
      chainId: CHAIN_ID,
      fee: 1400000,
    },
    ammSeed,
  );
  console.log(`  TxId: ${tx.id}`);
  await broadcast(tx, NODE_URL);
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120000 });
  console.log('  ✓ Deployed successfully\n');

  // ── Step 4: Re-grant admin to deployer ────────────────────────────
  console.log('Step 3: Re-granting admin to deployer...');
  const grantTx = invokeScript(
    {
      dApp: ammAddr,
      call: {
        function: 'grantAdmin',
        args: [{ type: 'string', value: deployerAddr }],
      },
      payment: [],
      chainId: CHAIN_ID,
      fee: 500000,
    } as any,
    ammSeed,
  );
  await broadcast(grantTx, NODE_URL);
  await waitForTx(grantTx.id, { apiBase: NODE_URL, timeout: 60000 });
  console.log(`  ✓ Admin granted: ${grantTx.id}\n`);

  // ── Step 5: Skip pool deletion (pools have real assets) ────────────
  console.log('Step 4: Skipping pool cleanup (live pools with real reserves).');

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  AMM Redeployment Complete                   ║');
  console.log('║  Real LP tokens: Issue/Reissue/Burn on-chain ║');
  console.log('║  LP tokens will now appear in user wallets   ║');
  console.log('╚══════════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
