// ============================================================================
// deploy.ts — Compile & Deploy RIDE Contracts to DCC Chain
// ============================================================================
//
// Usage:
//   DCC_SEED="your seed phrase" DCC_NODE_URL="https://mainnet-node.decentralchain.io" pnpm --filter @dcc/contracts deploy
//
// Environment variables:
//   DCC_SEED             — Wallet seed phrase (REQUIRED)
//   DCC_NODE_URL         — Node API URL  (default: https://mainnet-node.decentralchain.io)
//   DCC_CHAIN_ID         — Chain ID char (default: ?)
//
// Each contract is deployed to a separate account derived from the seed
// using nonce-based derivation to create unique addresses.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { setScript, broadcast, waitForTx, libs, transfer } from '@waves/waves-transactions';

const { crypto } = libs;

// ── Configuration ──────────────────────────────────────────────────────

const SEED = process.env['DCC_SEED'];
if (!SEED) {
  console.error('ERROR: DCC_SEED environment variable is required');
  process.exit(1);
}

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';

// ── Contract manifest ──────────────────────────────────────────────────
// Each contract gets its own account via seed + nonce derivation.

interface ContractDef {
  name: string;
  rideFile: string;
  nonce: number;
}

const CONTRACTS: ContractDef[] = [
  { name: 'PairRegistry',              rideFile: 'PairRegistry.ride',              nonce: 0 },
  { name: 'RiskConfig',                rideFile: 'RiskConfig.ride',                nonce: 1 },
  { name: 'SyntheticAssetFactory',     rideFile: 'SyntheticAssetFactory.ride',     nonce: 2 },
  { name: 'SyntheticVault',            rideFile: 'SyntheticVault.ride',            nonce: 3 },
  { name: 'SyntheticOracleAdapter',    rideFile: 'SyntheticOracleAdapter.ride',    nonce: 4 },
  { name: 'SyntheticLiquidationEngine',rideFile: 'SyntheticLiquidationEngine.ride',nonce: 5 },
  { name: 'SyntheticAMM',             rideFile: 'SyntheticAMM.ride',              nonce: 6 },
  { name: 'ExecutionEscrow',          rideFile: 'ExecutionEscrow.ride',            nonce: 7 },
];

// ── Helpers ────────────────────────────────────────────────────────────

function deriveSeed(baseSeed: string, nonce: number): string {
  return `${baseSeed}#${nonce}`;
}

function getAddress(seed: string, chainId: string): string {
  return crypto.address(seed, chainId);
}

async function compileRide(source: string): Promise<string> {
  // Dynamic import — @waves/ride-js is CJS
  const rideJs = await import('@waves/ride-js');
  const compileFn = rideJs.compile ?? rideJs.default?.compile;
  if (!compileFn) throw new Error('Could not find compile function in @waves/ride-js');

  const result = compileFn(source);
  if ('error' in result) {
    throw new Error(`RIDE compilation error: ${result.error}`);
  }
  return result.result.base64;
}

// ── Main ═══════════════════════════════════════════════════════════════

async function main() {
  const rideDir = path.resolve(__dirname, '..', 'ride');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  DCC RIDE Contract Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Node:     ${NODE_URL}`);
  console.log(`  Chain ID: ${CHAIN_ID}`);
  console.log(`  Deployer: ${getAddress(SEED!, CHAIN_ID)}`);
  console.log(`  Contracts: ${CONTRACTS.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const results: { name: string; address: string; txId?: string; error?: string }[] = [];

  // ── Step 1: Fund derived accounts ──────────────────────────────────
  // Each contract account needs DCC to pay the setScript fee (0.014 DCC).
  // Transfer 0.02 DCC per account from the master seed as a buffer.

  console.log('Step 1: Funding contract accounts...\n');
  for (const contract of CONTRACTS) {
    const contractSeed = deriveSeed(SEED!, contract.nonce);
    const address = getAddress(contractSeed, CHAIN_ID);

    try {
      const tx = transfer(
        {
          recipient: address,
          amount: 2000000, // 0.02 DCC (8 decimals)
          chainId: CHAIN_ID,
          fee: 100000,
        },
        SEED!,
      );
      await broadcast(tx, NODE_URL);
      await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120000 });
      console.log(`  ✓ Funded ${contract.name} → ${address}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.log(`  ✗ Fund failed for ${contract.name}: ${msg}`);
    }
  }

  console.log('\nStep 2: Deploying contracts...\n');

  for (const contract of CONTRACTS) {
    const seed = deriveSeed(SEED!, contract.nonce);
    const address = getAddress(seed, CHAIN_ID);

    console.log(`[${contract.name}]`);
    console.log(`  Address: ${address}`);

    try {
      // 1. Read RIDE source
      const ridePath = path.join(rideDir, contract.rideFile);
      if (!fs.existsSync(ridePath)) {
        throw new Error(`RIDE file not found: ${ridePath}`);
      }
      const source = fs.readFileSync(ridePath, 'utf-8');
      console.log(`  Source:  ${source.length} chars`);

      // 2. Compile
      console.log('  Compiling...');
      const compiledBase64 = await compileRide(source);
      console.log(`  Compiled: ${compiledBase64.length} chars (base64)`);

      // 3. Create setScript transaction
      const tx = setScript(
        {
          script: `base64:${compiledBase64}`,
          chainId: CHAIN_ID,
          fee: 1400000,
        },
        seed,
      );
      console.log(`  TxId: ${tx.id}`);

      // 4. Broadcast
      console.log('  Broadcasting...');
      await broadcast(tx, NODE_URL);
      console.log('  Waiting for confirmation...');
      await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120000 });
      console.log('  ✓ Deployed successfully\n');

      results.push({ name: contract.name, address, txId: tx.id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.log(`  ✗ Failed: ${msg}\n`);
      results.push({ name: contract.name, address, error: msg });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  DEPLOYMENT SUMMARY');
  console.log('═══════════════════════════════════════════════════════');

  const deployed: Record<string, string> = {};
  for (const r of results) {
    const status = r.txId ? '✓' : '✗';
    console.log(`  ${status} ${r.name.padEnd(28)} ${r.address}`);
    if (r.txId) {
      console.log(`    txId: ${r.txId}`);
      deployed[r.name] = r.address;
    }
    if (r.error) {
      console.log(`    error: ${r.error}`);
    }
  }

  // Write deployed addresses to JSON for other services to consume
  const outputPath = path.resolve(__dirname, '..', 'deployed-addresses.json');
  fs.writeFileSync(outputPath, JSON.stringify(deployed, null, 2));
  console.log(`\n  Addresses written to: ${outputPath}`);
  console.log('═══════════════════════════════════════════════════════');

  const failCount = results.filter(r => r.error).length;
  if (failCount > 0) {
    console.log(`\n  WARNING: ${failCount}/${results.length} contracts failed to deploy`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal deployment error:', err);
  process.exit(1);
});
