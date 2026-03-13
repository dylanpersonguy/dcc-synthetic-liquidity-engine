// Test swap to verify protocol fee extraction
// Usage: DCC_SEED="..." npx tsx scripts/test-swap-fee.ts

import { invokeScript, broadcast, waitForTx, libs } from '@waves/waves-transactions';

const { crypto } = libs;

const SEED = process.env['DCC_SEED'];
if (!SEED) { console.error('ERROR: DCC_SEED required'); process.exit(1); }

const NODE_URL = 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = '?';
const AMM_ADDR = '3DehXxU6pXMNePVmUgGTZFthgb5V3f3qaYo';

async function readData(key: string): Promise<any> {
  const res = await fetch(`${NODE_URL}/addresses/data/${AMM_ADDR}/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  const data = await res.json() as { value: unknown };
  return data.value;
}

async function main() {
  // Read state before swap
  const reserveABefore = await readData('pool:pool-sxrp-sdoge:reserveA');
  const reserveBBefore = await readData('pool:pool-sxrp-sdoge:reserveB');
  const accruedBefore = await readData('protocolFee:pool-sxrp-sdoge:sXRP') ?? 0;

  console.log('=== BEFORE SWAP ===');
  console.log(`  reserveA (sXRP): ${reserveABefore}`);
  console.log(`  reserveB (sDOGE): ${reserveBBefore}`);
  console.log(`  protocolFee accrued (sXRP): ${accruedBefore}`);

  // Swap 10000000 sXRP (0.1 sXRP) → sDOGE
  const amountIn = 10000000; // 0.1 sXRP
  console.log(`\nSwapping ${amountIn} sXRP (${amountIn / 1e8} sXRP) → sDOGE ...`);

  const tx = invokeScript(
    {
      dApp: AMM_ADDR,
      call: {
        function: 'swap',
        args: [
          { type: 'string', value: 'pool-sxrp-sdoge' },
          { type: 'string', value: 'sXRP' },
          { type: 'integer', value: amountIn },
          { type: 'integer', value: 1 }, // minAmountOut = 1 (accept any)
        ],
      },
      payment: [],
      chainId: CHAIN_ID,
      fee: 500000,
    } as any,
    SEED!,
  );
  console.log(`  TxId: ${tx.id}`);
  await broadcast(tx, NODE_URL);
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 60000 });
  console.log('  ✓ Swap confirmed');

  // Read state after swap
  const reserveAAfter = await readData('pool:pool-sxrp-sdoge:reserveA');
  const reserveBAfter = await readData('pool:pool-sxrp-sdoge:reserveB');
  const accruedAfter = await readData('protocolFee:pool-sxrp-sdoge:sXRP') ?? 0;

  console.log('\n=== AFTER SWAP ===');
  console.log(`  reserveA (sXRP): ${reserveAAfter}`);
  console.log(`  reserveB (sDOGE): ${reserveBAfter}`);
  console.log(`  protocolFee accrued (sXRP): ${accruedAfter}`);

  // Analysis
  const fee = Math.floor(amountIn * 30 / 10000); // feeRateBps=30
  const protocolFee = Math.floor(fee * 2000 / 10000); // protocolFeeShareBps=2000
  const lpFee = fee - protocolFee;

  console.log('\n=== FEE ANALYSIS ===');
  console.log(`  Total fee: ${fee} (${fee / 1e8} sXRP)`);
  console.log(`  Protocol fee (20%): ${protocolFee} (${protocolFee / 1e8} sXRP)`);
  console.log(`  LP fee (80%): ${lpFee} (${lpFee / 1e8} sXRP)`);
  console.log(`  Protocol fee accrued delta: ${accruedAfter - accruedBefore}`);
  console.log(`  reserveA delta: ${reserveAAfter - reserveABefore} (expected: ${amountIn - protocolFee})`);
  
  if (accruedAfter - accruedBefore === protocolFee) {
    console.log('\n✓ Protocol fee extraction is working correctly!');
  } else {
    console.log(`\n✗ MISMATCH: expected protocol fee accrued += ${protocolFee}, got += ${accruedAfter - accruedBefore}`);
  }
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
