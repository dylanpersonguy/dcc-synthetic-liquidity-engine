const { transfer, broadcast, libs } = require('@waves/waves-transactions');
const SEED = process.env.DCC_SEED;
const NODE = 'https://mainnet-node.decentralchain.io';
const CHAIN_ID = '?';
const deployerAddr = libs.crypto.address(SEED, CHAIN_ID);
console.log('Deployer:', deployerAddr);

// Transfer from all contract accounts that have enough to cover the 500k fee
const sources = [
  { name: 'PairRegistry', nonce: 0, amount: 29500000 },   // has 30M, send 29.5M
  { name: 'RiskConfig', nonce: 1, amount: 100000 },        // has 600k, send 100k
  { name: 'Oracle', nonce: 4, amount: 700000 },             // has 1.2M, send 700k
  { name: 'Liquidation', nonce: 5, amount: 100000 },        // has 600k, send 100k
  { name: 'AMM', nonce: 6, amount: 100000 },                // has 600k, send 100k
  { name: 'Escrow', nonce: 7, amount: 100000 },             // has 600k, send 100k
];

(async () => {
  for (const src of sources) {
    const srcSeed = SEED + '#' + src.nonce;
    const srcAddr = libs.crypto.address(srcSeed, CHAIN_ID);
    try {
      const tx = transfer({ recipient: deployerAddr, amount: src.amount, chainId: CHAIN_ID, fee: 500000 }, srcSeed);
      await broadcast(tx, NODE);
      console.log(`${src.name} (${srcAddr}): sent ${src.amount} → ${tx.id}`);
    } catch (e) {
      console.error(`${src.name}: ${e.message || JSON.stringify(e)}`);
    }
  }
  process.exit(0);
})();
