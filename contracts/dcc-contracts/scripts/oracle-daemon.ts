// ============================================================================
// oracle-daemon.ts — Persistent oracle price keeper + vault sync
// ============================================================================
//
// Runs continuously, updating on-chain oracle prices and syncing to vault.
//
// Every INTERVAL_MS (default 60s):
//   1. Fetch live prices from CoinGecko + Binance + CryptoCompare + DeFi Llama
//   2. Submit each provider's price to SyntheticOracleAdapter on-chain
//   3. Aggregate prices on-chain (weighted average + outlier detection)
//   4. Read aggregated price from oracle
//   5. Push aggregated price to SyntheticVault (updateMarkPrice)
//
// Usage:
//   DCC_SEED="..." pnpm --filter @dcc/contracts oracle-daemon
//   DCC_SEED="..." INTERVAL_MS=30000 pnpm --filter @dcc/contracts oracle-daemon
// ============================================================================

import { invokeScript, broadcast, waitForTx, libs } from '@waves/waves-transactions';
import { fetchAllProviderPrices } from './price-providers';
import type { ProviderResult } from './price-providers';

const { crypto } = libs;

// ── Configuration ──────────────────────────────────────────────────────

const SEED = process.env['DCC_SEED'];
if (!SEED) {
  console.error('ERROR: DCC_SEED environment variable is required');
  process.exit(1);
}

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';
const INTERVAL_MS = parseInt(process.env['INTERVAL_MS'] ?? '60000', 10);

const ORACLE_NONCE = 4;  // SyntheticOracleAdapter
const VAULT_NONCE = 3;   // SyntheticVault

const SYNTH_IDS = ['sSOL', 'sETH', 'sBTC', 'sBNB', 'sAVAX'];
const SCALE8 = 100_000_000;

function deriveSeed(baseSeed: string, nonce: number): string {
  return `${baseSeed}#${nonce}`;
}

function getAddress(seed: string, chainId: string): string {
  return crypto.address(seed, chainId);
}

const oracleSeed = deriveSeed(SEED, ORACLE_NONCE);
const oracleAddress = getAddress(oracleSeed, CHAIN_ID);
const vaultSeed = deriveSeed(SEED, VAULT_NONCE);
const vaultAddress = getAddress(vaultSeed, CHAIN_ID);

// ── Helpers ────────────────────────────────────────────────────────────

async function invoke(
  dAppAddress: string,
  callerSeed: string,
  functionName: string,
  args: Array<{ type: 'string' | 'integer' | 'boolean'; value: string | number | boolean }>,
  fee = 500_000,
): Promise<string | null> {
  try {
    const tx = invokeScript(
      {
        dApp: dAppAddress,
        call: { function: functionName, args },
        payment: [],
        chainId: CHAIN_ID,
        fee,
      },
      callerSeed,
    );
    await broadcast(tx, NODE_URL);
    await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 60_000 });
    return tx.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${functionName} failed: ${msg}`);
    return null;
  }
}

async function readOnChainPrice(synthId: string): Promise<number | null> {
  const key = `price_${synthId}`;
  try {
    const res = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json() as { value: number };
    return data.value ?? null;
  } catch {
    return null;
  }
}

// ── Price Update Cycle ─────────────────────────────────────────────────

let cycleCount = 0;

async function runPriceCycle(): Promise<void> {
  cycleCount++;
  const ts = new Date().toISOString();
  console.log(`\n── Cycle #${cycleCount} [${ts}] ──────────────────────────`);

  // Step 1: Fetch prices from all providers
  let results: ProviderResult[];
  try {
    results = await fetchAllProviderPrices(SYNTH_IDS);
  } catch (err) {
    console.error('  ✗ Price fetch failed:', err);
    return;
  }

  const successful = results.filter(r => r.success && Object.keys(r.prices).length > 0);
  console.log(`  Providers: ${successful.length}/${results.length} returned prices`);

  if (successful.length === 0) {
    console.error('  ✗ No providers returned prices, skipping cycle');
    return;
  }

  // Step 2: Submit prices on-chain from each provider
  for (const result of successful) {
    for (const synthId of SYNTH_IDS) {
      const usdPrice = result.prices[synthId];
      if (!usdPrice) continue;

      const priceScaled = Math.round(usdPrice * SCALE8);
      const txId = await invoke(oracleAddress, oracleSeed, 'submitPrice', [
        { type: 'string', value: synthId },
        { type: 'string', value: result.venue },
        { type: 'integer', value: priceScaled },
      ]);
      if (txId) {
        console.log(`  ✓ ${synthId} [${result.venue}] $${usdPrice.toFixed(2)}`);
      }
    }
  }

  // Step 3: Aggregate on-chain
  for (const synthId of SYNTH_IDS) {
    await invoke(oracleAddress, oracleSeed, 'aggregatePrice', [
      { type: 'string', value: synthId },
    ]);
  }

  // Step 4: Read aggregated price and sync to vault
  for (const synthId of SYNTH_IDS) {
    const onChainPrice = await readOnChainPrice(synthId);
    if (!onChainPrice || onChainPrice <= 0) {
      console.log(`  ○ ${synthId}: no aggregated price, skipping vault sync`);
      continue;
    }

    const txId = await invoke(vaultAddress, vaultSeed, 'updateMarkPrice', [
      { type: 'string', value: synthId },
      { type: 'integer', value: onChainPrice },
    ]);
    if (txId) {
      console.log(`  ✓ Vault ${synthId} markPrice → $${(onChainPrice / SCALE8).toFixed(2)}`);
    }
  }

  console.log(`  ── Cycle #${cycleCount} complete`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  DCC Oracle Price Daemon');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Oracle:    ${oracleAddress}`);
  console.log(`  Vault:     ${vaultAddress}`);
  console.log(`  Interval:  ${INTERVAL_MS / 1000}s`);
  console.log(`  Synthetics: ${SYNTH_IDS.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════');

  // Run first cycle immediately
  await runPriceCycle();

  // Then schedule recurring cycles
  setInterval(() => {
    runPriceCycle().catch(err => console.error('Cycle error:', err));
  }, INTERVAL_MS);

  console.log(`\nDaemon running. Press Ctrl+C to stop.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
