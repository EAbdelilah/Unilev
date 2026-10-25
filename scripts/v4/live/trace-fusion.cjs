/**
 * Debug helper: trace the Fusion fill eth_call on a local anvil fork so the
 * revert selector can be attributed to a frame.
 *
 *   node scripts/v4/live/trace-fusion.cjs [planFile]
 */
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC_URL || 'http://127.0.0.1:8545';
const FUSION = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

async function main() {
  const file = process.argv[2] || 'scripts/v4/live/proofs/fusion-plan.json';
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = new ethers.JsonRpcProvider(RPC);
  const fusion = new ethers.Contract(FUSION, abiOf('out/EswapOneInchFusionSettlement.sol/EswapOneInchFusionSettlement.json'), p);

  const o = plan.order;
  const order = {
    salt: BigInt(o.salt),
    maker: BigInt(o.maker),
    receiver: BigInt(o.receiver),
    makerAsset: BigInt(o.makerAsset),
    takerAsset: BigInt(o.takerAsset),
    makingAmount: BigInt(o.makingAmount),
    takingAmount: BigInt(o.takingAmount),
    makerTraits: BigInt(o.makerTraits),
  };
  const data = fusion.interface.encodeFunctionData('fill', [
    order,
    plan.signature.r,
    plan.signature.vs,
    BigInt(o.makingAmount),
    BigInt(plan.takerTraits),
    plan.extension,
    '0x',
    ethers.getAddress('0x' + BigInt(o.receiver).toString(16).padStart(40, '0')),
  ]);

  const tx = { from: plan.solver || '0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037', to: FUSION, data };
  try {
    await p.call(tx);
    console.log('eth_call OK');
  } catch (e) {
    console.log('eth_call revert', e.data || e.shortMessage || e.message);
  }

  const trace = await p.send('debug_traceCall', [tx, 'latest', { tracer: 'callTracer' }]);
  const walk = (node, depth = 0) => {
    const pad = '  '.repeat(depth);
    const sel = node.input && node.input.length >= 10 ? node.input.slice(0, 10) : '';
    console.log(`${pad}${node.type} ${node.to || ''} ${sel} gas=${node.gas} gasUsed=${node.gasUsed} ${node.error ? 'ERROR ' + node.error + ' out=' + (node.output || '').slice(0, 10) : ''}`);
    for (const c of node.calls || []) walk(c, depth + 1);
  };
  walk(trace);
  const firstErr = (() => {
    let found = null;
    const visit = (n) => { if (found) return; if (n.error) found = n; for (const c of n.calls || []) visit(c); };
    visit(trace);
    return found;
  })();
  if (firstErr) console.log('\nfirst failing frame:', firstErr.to, firstErr.error, (firstErr.output || '').slice(0, 10));
}

main().catch((e) => {
  console.error('FAILED', e.shortMessage || e.message);
  process.exit(1);
});
