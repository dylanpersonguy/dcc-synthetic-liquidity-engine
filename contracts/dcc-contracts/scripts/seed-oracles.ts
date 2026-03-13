// ============================================================================
// seed-oracles.ts — Initialize oracle, add multi-source feeds, push prices
// ============================================================================
//
// Seeds 5 oracle price feeds with MULTIPLE sources per synthetic:
//   sSOL, sETH, sBTC, sBNB, sAVAX
//
// Providers (all free, no API key):
//   1. CoinGecko      — weight 30%
//   2. Binance         — weight 30%
//   3. CryptoCompare   — weight 20%
//   4. DeFi Llama      — weight 20%
//   5. CoinMarketCap   — (optional, requires CMC_API_KEY env)
//
// With 4+ sources per synth, the oracle contract's confidence scoring
// reaches 90 (HIGH), up from 40 (LOW) with a single source.
//
// Usage:
//   DCC_SEED="..." pnpm --filter @dcc/contracts seed-oracles
//   DCC_SEED="..." CMC_API_KEY="..." pnpm --filter @dcc/contracts seed-oracles
// ============================================================================

import { invokeScript, broadcast, waitForTx, libs, transfer } from '@waves/waves-transactions';
import { getActiveProviders, fetchAllProviderPrices } from './price-providers';
import type { ProviderConfig, ProviderResult } from './price-providers';

const { crypto } = libs;

// ── Configuration ──────────────────────────────────────────────────────

const SEED = process.env['DCC_SEED'];
if (!SEED) {
  console.error('ERROR: DCC_SEED environment variable is required');
  process.exit(1);
}

const NODE_URL = process.env['DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = process.env['DCC_CHAIN_ID'] ?? '?';
const ORACLE_NONCE = 4; // SyntheticOracleAdapter is nonce 4 in deploy manifest

const SYNTH_IDS = ['sSOL', 'sETH', 'sBTC', 'sBNB', 'sAVAX'];

function deriveSeed(baseSeed: string, nonce: number): string {
  return `${baseSeed}#${nonce}`;
}

function getAddress(seed: string, chainId: string): string {
  return crypto.address(seed, chainId);
}

const SCALE8 = 100_000_000;

// ── Helpers ────────────────────────────────────────────────────────────

async function invoke(
  dAppAddress: string,
  callerSeed: string,
  functionName: string,
  args: Array<{ type: 'string' | 'integer' | 'boolean'; value: string | number | boolean }>,
  fee = 500_000,
) {
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
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120_000 });
  return tx.id;
}

/** Read the current source count for a synth from on-chain state */
async function getOnChainSourceCount(oracleAddress: string, synthId: string): Promise<number> {
  const key = `oracle_${synthId}_sourceCount`;
  const res = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(key)}`);
  if (!res.ok) return 0;
  const data = await res.json() as { value: number };
  return data.value ?? 0;
}

/** Read the venue name at a given source index from on-chain state */
async function getOnChainSourceVenue(oracleAddress: string, synthId: string, idx: number): Promise<string | null> {
  const key = `oracle_${synthId}_source_${idx}_venue`;
  const res = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  const data = await res.json() as { value: string };
  return data.value ?? null;
}

// ── Main ═══════════════════════════════════════════════════════════════

async function main() {
  const oracleSeed = deriveSeed(SEED!, ORACLE_NONCE);
  const oracleAddress = getAddress(oracleSeed, CHAIN_ID);
  const deployerAddress = getAddress(SEED!, CHAIN_ID);
  const providers = getActiveProviders();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  DCC Multi-Source Oracle Feed Seeder');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Oracle Contract: ${oracleAddress}`);
  console.log(`  Deployer:        ${deployerAddress}`);
  console.log(`  Synthetics:      ${SYNTH_IDS.join(', ')}`);
  console.log(`  Providers:       ${providers.map(p => p.name).join(', ')}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Step 0: Fund oracle account from master wallet ──────────────────
  console.log('Step 0: Funding oracle account...\n');
  try {
    // Check master wallet balance first
    const balRes = await fetch(`${NODE_URL}/addresses/balance/${deployerAddress}`);
    const balData = await balRes.json() as { balance: number };
    const masterBalance = balData.balance;
    console.log(`  Master wallet balance: ${(masterBalance / SCALE8).toFixed(4)} DCC`);

    // Reserve 0.002 DCC for the master, send the rest
    const reserve = 200_000;
    const fee = 100_000;
    const sendAmount = masterBalance - reserve - fee;

    if (sendAmount > 0) {
      const tx = transfer(
        {
          recipient: oracleAddress,
          amount: sendAmount,
          chainId: CHAIN_ID,
          fee,
        },
        SEED!,
      );
      await broadcast(tx, NODE_URL);
      await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 120_000 });
      console.log(`  ✓ Funded oracle with ${(sendAmount / SCALE8).toFixed(4)} DCC — txId: ${tx.id}\n`);
    } else {
      console.log(`  ○ Insufficient master balance to fund (need > ${((reserve + fee) / SCALE8).toFixed(4)} DCC)\n`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    console.log(`  ✗ Funding failed: ${msg}\n`);
  }

  // ── Step 1: Initialize oracle (set deployer as admin) ──────────────
  console.log('Step 1: Initializing oracle contract...\n');
  try {
    const txId = await invoke(oracleAddress, oracleSeed, 'initialize', []);
    console.log(`  ✓ Initialized — txId: ${txId}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    if (msg.includes('already initialized')) {
      console.log('  ○ Already initialized (skipping)\n');
    } else {
      console.log(`  ✗ Initialize failed: ${msg}\n`);
    }
  }

  // ── Step 2: Grant admin to deployer ────────────────────────────────
  console.log('Step 2: Granting admin to deployer...\n');
  try {
    const txId = await invoke(oracleAddress, oracleSeed, 'grantAdmin', [
      { type: 'string', value: deployerAddress },
    ]);
    console.log(`  ✓ Admin granted to ${deployerAddress} — txId: ${txId}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    console.log(`  ○ Grant admin: ${msg}\n`);
  }

  // ── Step 3: Update existing sources & add new ones ─────────────────
  console.log('Step 3: Configuring oracle sources (multi-provider)...\n');

  for (const synthId of SYNTH_IDS) {
    const existingCount = await getOnChainSourceCount(oracleAddress, synthId);
    const existingVenues: string[] = [];

    // Read existing venue names
    for (let i = 0; i < existingCount; i++) {
      const venue = await getOnChainSourceVenue(oracleAddress, synthId, i);
      existingVenues.push(venue ?? '');
    }

    console.log(`  ${synthId}: ${existingCount} existing source(s) [${existingVenues.join(', ')}]`);

    for (const provider of providers) {
      const existingIdx = existingVenues.indexOf(provider.venue);

      if (existingIdx >= 0) {
        // Source already registered — update its weight
        try {
          const txId = await invoke(oracleAddress, oracleSeed, 'updateOracleSource', [
            { type: 'string', value: synthId },
            { type: 'integer', value: existingIdx },
            { type: 'integer', value: provider.weight },
            { type: 'integer', value: provider.stalenessMs },
            { type: 'boolean', value: true },
          ]);
          console.log(`    ✓ ${provider.venue} updated (idx=${existingIdx}, weight=${provider.weight}) — txId: ${txId}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          console.log(`    ✗ ${provider.venue} update failed: ${msg}`);
        }
      } else {
        // New source — add it
        try {
          const txId = await invoke(oracleAddress, oracleSeed, 'addOracleSource', [
            { type: 'string', value: synthId },
            { type: 'string', value: provider.venue },
            { type: 'integer', value: provider.weight },
            { type: 'integer', value: provider.stalenessMs },
          ]);
          console.log(`    ✓ ${provider.venue} added (weight=${provider.weight}) — txId: ${txId}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          console.log(`    ✗ ${provider.venue} addOracleSource failed: ${msg}`);
        }
      }
    }
    console.log();
  }

  // ── Step 4: Fetch prices from ALL providers in parallel ────────────
  console.log('Step 4: Fetching prices from all providers...\n');

  let providerResults: ProviderResult[];
  try {
    providerResults = await fetchAllProviderPrices(SYNTH_IDS);
    for (const result of providerResults) {
      if (result.success) {
        const priceStr = Object.entries(result.prices)
          .map(([s, p]) => `${s}=$${p}`)
          .join(', ');
        console.log(`  ✓ ${result.venue}: ${priceStr}`);
      } else {
        console.log(`  ✗ ${result.venue}: ${result.error}`);
      }
    }
    console.log();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    console.error(`  ✗ Failed to fetch prices: ${msg}`);
    process.exit(1);
  }

  // Filter to only successful results with prices
  const successfulResults = providerResults.filter(r => r.success && Object.keys(r.prices).length > 0);
  if (successfulResults.length === 0) {
    console.error('  ✗ No providers returned prices. Aborting.');
    process.exit(1);
  }

  // ── Step 5: Submit prices on-chain from each provider ──────────────
  console.log('Step 5: Submitting prices on-chain...\n');

  for (const result of successfulResults) {
    for (const synthId of SYNTH_IDS) {
      const usdPrice = result.prices[synthId];
      if (!usdPrice) continue;

      const priceScaled = Math.round(usdPrice * SCALE8);

      try {
        const txId = await invoke(oracleAddress, oracleSeed, 'submitPrice', [
          { type: 'string', value: synthId },
          { type: 'string', value: result.venue },
          { type: 'integer', value: priceScaled },
        ]);
        console.log(`  ✓ ${synthId} [${result.venue}] $${usdPrice} (${priceScaled}) — txId: ${txId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.log(`  ✗ ${synthId} [${result.venue}] submitPrice failed: ${msg}`);
      }
    }
  }

  // ── Step 6: Aggregate prices ───────────────────────────────────────
  console.log('\nStep 6: Aggregating prices...\n');

  for (const synthId of SYNTH_IDS) {
    try {
      const txId = await invoke(oracleAddress, oracleSeed, 'aggregatePrice', [
        { type: 'string', value: synthId },
      ]);
      console.log(`  ✓ ${synthId} aggregated — txId: ${txId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.log(`  ✗ ${synthId} aggregation failed: ${msg}`);
    }
  }

  // ── Step 7: Verify prices by reading on-chain data ─────────────────
  console.log('\nStep 7: Verifying on-chain prices...\n');

  for (const synthId of SYNTH_IDS) {
    try {
      const priceKey = `price_${synthId}`;
      const tsKey = `price_${synthId}_timestamp`;
      const confKey = `price_${synthId}_confidence`;

      const priceRes = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(priceKey)}`);
      const tsRes = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(tsKey)}`);
      const confRes = await fetch(`${NODE_URL}/addresses/data/${oracleAddress}/${encodeURIComponent(confKey)}`);

      if (priceRes.ok) {
        const priceData = await priceRes.json() as { value: number };
        const tsData = tsRes.ok ? (await tsRes.json() as { value: number }) : { value: 0 };
        const confData = confRes.ok ? (await confRes.json() as { value: number }) : { value: 0 };

        const priceUsd = priceData.value / SCALE8;
        const sourceCount = await getOnChainSourceCount(oracleAddress, synthId);
        console.log(`  ✓ ${synthId}: $${priceUsd.toFixed(4)} | confidence: ${confData.value} | sources: ${sourceCount} | ts: ${new Date(tsData.value).toISOString()}`);
      } else {
        console.log(`  ✗ ${synthId}: no on-chain price found`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.log(`  ✗ ${synthId} verification failed: ${msg}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MULTI-SOURCE ORACLE SEEDING COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(console.error);
