// Probe each aggregator API for a usable quote at the live dust notional.
const { ethers } = require('ethers');
const { loadEnv, getProvider, USDC, WETH, ROUTER, ZEROX, ENSO, PARASWAP, KYBER } = require('./common.cjs');

const env = loadEnv();
const CHAIN = 8453;
const AMOUNT = BigInt(process.argv[2] || '8000'); // USDC units (6dp)

async function timed(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`\n=== ${name}: OK (${Date.now() - t0}ms)`);
    return r;
  } catch (e) {
    console.log(`\n=== ${name}: FAIL (${Date.now() - t0}ms) ${e.shortMessage || e.message}`);
    return null;
  }
}

async function jget(url, headers = {}) {
  const res = await fetch(url, { headers });
  const txt = await res.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 400)}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

(async () => {
  const provider = getProvider();
  const who = { owner: env.ADDRESS || null };
  const wallets = {
    owner: env.PRIVATE_KEY ? new ethers.Wallet(env.PRIVATE_KEY).address : null,
    solver: env.SOLVER_PRIVATE_KEY ? new ethers.Wallet(env.SOLVER_PRIVATE_KEY).address : null,
    trader: env.TINY_TRADER_PK ? new ethers.Wallet(env.TINY_TRADER_PK).address : null,
  };
  console.log('wallets', wallets);
  const erc20 = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  for (const [k, a] of Object.entries(wallets)) {
    if (!a) continue;
    console.log(k, a, 'USDC', (await erc20.balanceOf(a)).toString(), 'ETH', (await provider.getBalance(a)).toString());
  }
  console.log('notional probe amount (USDC units):', AMOUNT.toString());

  const kyber = await timed('kyber', async () => {
    const u = `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${AMOUNT}&to=${ROUTER}&gasInclude=1`;
    const body = await jget(u, { 'x-client-id': 'eswap-proof' });
    console.log('  routeSummary:', JSON.stringify(body.data?.routeSummary)?.slice(0, 400));
    return body;
  });
  const kyberBuild = kyber ? await timed('kyber-build', async () => {
    const u = `https://aggregator-api.kyberswap.com/base/api/v1/route/build`;
    const res = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': 'eswap-proof' },
      body: JSON.stringify({
        routeSummary: kyber.data.routeSummary,
        sender: ROUTER,
        recipient: ROUTER,
        slippageTolerance: 100,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
    console.log('  to:', body.data?.routerAddress, 'out:', body.data?.amountOut, 'dataLen:', (body.data?.data || '').length);
    return body;
  }) : null;

  const enso = await timed('enso', async () => {
    const u = `https://api.enso.finance/api/v1/shortcuts/route?chainId=${CHAIN}&fromAddress=${ROUTER}&receiver=${ROUTER}&spender=${ROUTER}&tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${AMOUNT}&routingStrategy=router&slippage=100`;
    const body = await jget(u, env.ENSO_API_KEY ? { authorization: `Bearer ${env.ENSO_API_KEY}` } : {});
    console.log('  tx.to:', body.tx?.to, 'amountOut:', body.amountOut, 'dataLen:', (body.tx?.data || '').length);
    return body;
  });

  const para = await timed('paraswap-price', async () => {
    const u = `https://api.paraswap.io/prices/?srcToken=${USDC}&destToken=${WETH}&amount=${AMOUNT}&srcDecimals=6&destDecimals=18&side=SELL&network=${CHAIN}&partner=eswap`;
    const body = await jget(u);
    console.log('  priceRoute destAmount:', body.priceRoute?.destAmount, 'contract:', body.priceRoute?.contractAddress);
    return body;
  });
  const paraTx = para ? await timed('paraswap-tx', async () => {
    const res = await fetch(`https://api.paraswap.io/transactions/${CHAIN}?partner=eswap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        srcToken: USDC, destToken: WETH, srcAmount: AMOUNT.toString(), destAmount: para.priceRoute.destAmount,
        priceRoute: para.priceRoute, userAddress: ROUTER, txOrigin: wallets.owner, receiver: ROUTER,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
    console.log('  to:', body.to, 'dataLen:', (body.data || '').length);
    return body;
  }) : null;

  const zerox = await timed('0x', async () => {
    const u = `https://api.0x.org/swap/v1/quote?sellToken=${USDC}&buyToken=${WETH}&sellAmount=${AMOUNT}&takerAddress=${ROUTER}&slippagePercentage=0.01`;
    const h = env.ZEROX_API_KEY ? { '0x-api-key': env.ZEROX_API_KEY } : {};
    const body = await jget(u, h);
    console.log('  to:', body.to, 'allowanceTarget:', body.allowanceTarget, 'buyAmount:', body.buyAmount);
    return body;
  });

  console.log('\nsummary', {
    kyber: !!kyberBuild, enso: !!enso, paraswap: !!paraTx, zerox: !!zerox,
  });
})();
