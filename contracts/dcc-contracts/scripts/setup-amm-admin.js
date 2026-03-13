const { transfer, invokeScript, broadcast, waitForTx, libs } = require('@waves/waves-transactions');
const SEED = process.env.DCC_SEED;
if (!SEED) { console.error('DCC_SEED required'); process.exit(1); }
const NODE = 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = '?';
const AMM_SEED = SEED + '#6';
const AMM_ADDR = libs.crypto.address(AMM_SEED, CHAIN_ID);
const DEPLOYER_ADDR = libs.crypto.address(SEED, CHAIN_ID);
console.log('AMM:', AMM_ADDR);
console.log('Deployer:', DEPLOYER_ADDR);

(async () => {
  // 1. Fund AMM from deployer (1 DCC for fees)
  console.log('Funding AMM with 1 DCC...');
  const tx1 = transfer({ recipient: AMM_ADDR, amount: 100000000, chainId: CHAIN_ID, fee: 500000 }, SEED);
  await broadcast(tx1, NODE);
  await waitForTx(tx1.id, { apiBase: NODE, timeout: 60000 });
  console.log('Funded AMM:', tx1.id);

  // 2. Grant admin on AMM to deployer (signed with AMM seed = contract owner)
  console.log('Granting AMM admin to deployer...');
  const tx2 = invokeScript({
    dApp: AMM_ADDR,
    call: { function: 'grantAdmin', args: [{ type: 'string', value: DEPLOYER_ADDR }] },
    payment: [],
    chainId: CHAIN_ID,
    fee: 500000,
  }, AMM_SEED);
  await broadcast(tx2, NODE);
  await waitForTx(tx2.id, { apiBase: NODE, timeout: 60000 });
  console.log('AMM.grantAdmin(deployer):', tx2.id);

  console.log('Done!');
  process.exit(0);
})().catch(e => { console.error(e.message || JSON.stringify(e)); process.exit(1); });
