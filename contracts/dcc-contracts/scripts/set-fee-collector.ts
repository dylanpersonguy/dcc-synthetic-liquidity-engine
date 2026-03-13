// Set protocol fee collector address on the AMM contract
// Usage: DCC_SEED="..." npx tsx scripts/set-fee-collector.ts

import { invokeScript, broadcast, waitForTx, libs } from '@waves/waves-transactions';

const { crypto } = libs;

const SEED = process.env['DCC_SEED'];
if (!SEED) { console.error('ERROR: DCC_SEED required'); process.exit(1); }

const NODE_URL = 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = '?';
const AMM_SEED = `${SEED}#6`;
const ammAddr = crypto.address(AMM_SEED, CHAIN_ID);
const COLLECTOR = '3DdH3fHbZNsmrdmp9fdSiuJZgEaWJ8mLnyJ';

async function main() {
  console.log(`AMM: ${ammAddr}`);
  console.log(`Setting protocolFeeCollector to: ${COLLECTOR}`);

  const tx = invokeScript(
    {
      dApp: ammAddr,
      call: {
        function: 'setProtocolFeeCollector',
        args: [{ type: 'string', value: COLLECTOR }],
      },
      payment: [],
      chainId: CHAIN_ID,
      fee: 500000,
    } as any,
    AMM_SEED,
  );
  console.log(`TxId: ${tx.id}`);
  await broadcast(tx, NODE_URL);
  await waitForTx(tx.id, { apiBase: NODE_URL, timeout: 60000 });
  console.log(`✓ protocolFeeCollector set to ${COLLECTOR}`);
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
