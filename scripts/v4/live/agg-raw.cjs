// Diagnose a venue's raw calldata on the current RPC (fork or mainnet) without
// going through EswapRouter: caller must already hold + approve the input token.
const { ethers } = require('ethers');
const { loadEnv, getProvider, USDC, WETH, ROUTER } = require('./common.cjs');

const env = loadEnv();
const MODE = process.argv[2] || 'kyber';
const TRADER_ADDR = process.argv[3];

function traderFor(venue) {
  return new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`eswap-aggregator-live-v1/${venue}`)));
}

async function main() {
  const p = getProvider();
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'], p);
  const weth = new ethers.Contract(WETH, ['function balanceOf(address) view returns (uint256)'], p);
  const trader = TRADER_ADDR || traderFor(MODE).address;
  const AMOUNT = 8000n;

  let to, data, expected;
  if (MODE === 'kyber') {
    const h = { 'x-client-id': 'eswap-live-proof' };
    const r = await (await fetch(`https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${AMOUNT}&to=${ROUTER}&gasInclude=1`, { headers: h })).json();
    const b = await (await fetch('https://aggregator-api.kyberswap.com/base/api/v1/route/build', {
      method: 'POST', headers: { 'content-type': 'application/json', ...h },
      body: JSON.stringify({ routeSummary: r.data.routeSummary, sender: ROUTER, recipient: ROUTER, slippageTolerance: 3 }),
    })).json();
    to = b.data.routerAddress; data = b.data.data; expected = b.data.amountOut;
    console.log('routeSummary', JSON.stringify(r.data.routeSummary));
    console.log('build', JSON.stringify({ router: to, amountOut: b.data.amountOut, amountIn: b.data.amountIn, gas: b.data.gas }));
  } else if (MODE === 'enso') {
    const u = `https://api.enso.finance/api/v1/shortcuts/route?chainId=8453&fromAddress=${ROUTER}&receiver=${ROUTER}&spender=${ROUTER}&tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${AMOUNT}&routingStrategy=router&slippage=300`;
    const b = await (await fetch(u, { headers: { authorization: `Bearer ${env.ENSO_API_KEY}` } })).json();
    to = b.tx.to; data = b.tx.data; expected = b.amountOut;
    console.log('enso', JSON.stringify({ to, amountOut: b.amountOut, route: b.route }));
  } else if (MODE === '0x') {
    const u = `https://api.0x.org/swap/allowance-holder/quote?chainId=8453&sellToken=${USDC}&buyToken=${WETH}&sellAmount=${AMOUNT}&taker=${ROUTER}&slippageBps=300`;
    const b = await (await fetch(u, { headers: { '0x-api-key': env.ZERO_X_API_KEY, '0x-version': 'v2' } })).json();
    to = (b.transaction || b).to; data = (b.transaction || b).data; expected = b.buyAmount;
    console.log('0x', JSON.stringify({ to, buyAmount: b.buyAmount, allowanceTarget: b.allowanceTarget }));
  } else if (MODE === 'paraswap') {
    const pr = await (await fetch(`https://api.paraswap.io/prices/?srcToken=${USDC}&destToken=${WETH}&amount=${AMOUNT}&srcDecimals=6&destDecimals=18&side=SELL&network=8453&partner=eswap`)).json();
    const b = await (await fetch('https://api.paraswap.io/transactions/8453?partner=eswap&ignoreChecks=true', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ srcToken: USDC, destToken: WETH, srcAmount: AMOUNT.toString(), destAmount: pr.priceRoute.destAmount, priceRoute: pr.priceRoute, userAddress: ROUTER, receiver: ROUTER }),
    })).json();
    to = b.to; data = b.data; expected = pr.priceRoute.destAmount;
    console.log('paraswap', JSON.stringify({ to, destAmount: pr.priceRoute.destAmount, tokenTransferProxy: pr.priceRoute.tokenTransferProxy }));
  }
  console.log('calldata', (data.length - 2) / 2, 'bytes  selector', data.slice(0, 10));
  console.log('trader', trader, 'USDC', (await usdc.balanceOf(trader)).toString(), 'allow->venue', (await usdc.allowance(trader, to)).toString());
  const wethBefore = await weth.balanceOf(ROUTER);
  try {
    const ret = await p.call({ from: trader, to, data, gasLimit: 3_000_000n });
    console.log('raw eth_call OK  ret', ret.slice(0, 200));
    console.log('expected out', expected, 'router WETH delta', ((await weth.balanceOf(ROUTER)) - wethBefore).toString());
  } catch (e) {
    console.log('raw eth_call REVERT', e.shortMessage || e.message, 'data', e.data || e.info?.error?.data);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
