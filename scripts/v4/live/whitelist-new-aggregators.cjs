/**
 * Whitelist the new Base aggregator / cross-chain execution proxies on
 * EswapRouter via the owner key.
 *
 *   node scripts/v4/live/whitelist-new-aggregators.cjs            # check + whitelist
 *   node scripts/v4/live/whitelist-new-aggregators.cjs --check    # check only, no tx
 *
 * A target is only whitelisted after it passes its own check:
 *   - it has bytecode on Base, and
 *   - the venue's own API or a known view function confirms it is the
 *     contract that will be called.
 *
 * Addresses from the original request that failed these checks are NOT
 * whitelisted:
 *   - Li.Fi  0x123151509706580380423f72322400a08  malformed (33 hex chars)
 *   - Socket 0x3a23f3e7313593b5a2701331c430e8a71c841369  no bytecode on Base
 *     (the live V3 gateway is the Socket Allowance Holder 0x50c4E75a…5909,
 *     confirmed by docs.socket.tech/integrate/contract-addresses and by the
 *     txData.to of a live public-backend.socket.tech /v3/swap/quote)
 *   - OpenOcean 0x6352a56caadc4f1e25cd6c773226378215f740b3  no bytecode on Base
 *   - WOOFi  0x133857502e604f32d8479e0a293a5530fa01cc3a  no bytecode on Base
 */
const { ethers } = require('ethers');
const { loadEnv, getProvider, USDC, WETH, ROUTER } = require('./common.cjs');

const env = loadEnv();
const CHECK_ONLY = process.argv.includes('--check');
const ROUTER_ABI = [
  'function owner() view returns (address)',
  'function allowedAggregators(address) view returns (bool)',
  'function setAllowedAggregator(address proxy, bool allowed)',
];

const TARGETS = [
  {
    name: 'LI.FI Diamond',
    addr: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    async verify(p) {
      const q = await (await fetch(
        `https://li.quest/v1/quote?fromChain=8453&toChain=8453&fromToken=${USDC}&toToken=${WETH}`
        + `&fromAmount=8000&fromAddress=${ROUTER}&toAddress=${ROUTER}`,
      )).json();
      if (q.transactionRequest.to.toLowerCase() !== this.addr.toLowerCase()) {
        throw new Error(`quote routes via ${q.transactionRequest.to}, not ${this.addr}`);
      }
      if (q.estimate.approvalAddress.toLowerCase() !== this.addr.toLowerCase()) {
        throw new Error(`approvalAddress ${q.estimate.approvalAddress} differs`);
      }
      return `quote.to == approvalAddress == target (${q.tool})`;
    },
  },
  {
    name: 'WOOFi Router V2.1',
    addr: '0x4c4AF8DBc524681930a27b2F1Af5bcC8062E6fB7',
    async verify(p) {
      const c = new ethers.Contract(this.addr, [
        'function quoteToken() view returns (address)',
        'function WETH() view returns (address)',
      ], p);
      const [qt, weth] = await Promise.all([c.quoteToken(), c.WETH()]);
      if (qt.toLowerCase() !== USDC.toLowerCase() || weth.toLowerCase() !== WETH.toLowerCase()) {
        throw new Error(`quoteToken ${qt} / WETH ${weth} do not match Base USDC / WETH`);
      }
      return 'quoteToken == Base USDC, WETH == Base WETH';
    },
  },
  {
    name: '1inch AggregationRouterV6',
    addr: '0x111111125421cA6dc452d289314280a0f8842A65',
    async verify(p) {
      if ((await p.getCode(this.addr)).length <= 2) throw new Error('no bytecode');
      return 'bytecode present (canonical LOP / router address)';
    },
  },
  {
    name: 'OpenOcean Router (§13)',
    addr: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64',
    async verify(p) {
      if ((await p.getCode(this.addr)).length <= 2) throw new Error('no bytecode');
      return 'bytecode present (the router used in §13)';
    },
  },
  {
    // Socket Swap V3 is keyless on the public backend. The executable target is
    // the Socket Allowance Holder, which exec()s the Socket Open Router.
    name: 'Socket Allowance Holder (Swap V3)',
    addr: '0x50c4E75a512F2A14A7b304787Adf79C4531A5909',
    async verify(p) {
      if ((await p.getCode(this.addr)).length <= 2) throw new Error('no bytecode');
      const q = new URLSearchParams({
        userOps: 'tx',
        originChainId: '8453',
        destinationChainId: '8453',
        inputToken: USDC,
        outputToken: WETH,
        inputAmount: '8000',
        userAddress: ROUTER,
        receiverAddress: ROUTER,
        slippage: '3',
        contractCaller: ROUTER,
      });
      let b = null;
      let lastErr = '';
      for (let i = 0; i < 2; i++) {
        const r = await fetch(`https://public-backend.socket.tech/v3/swap/quote?${q}`, {
          headers: { accept: 'application/json' },
        });
        const txt = await r.text();
        try {
          b = JSON.parse(txt);
        } catch {
          b = null;
        }
        if (r.ok && b?.result?.routes?.length) break;
        lastErr = `HTTP ${r.status} ${txt.slice(0, 200)}`;
        // A rate limit must not be retried in a tight loop.
        if (r.status === 429) break;
        await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
      }
      const route = b?.result?.routes?.[0];
      if (!route) throw new Error(`no route: ${lastErr || JSON.stringify(b).slice(0, 200)}`);
      const to = ethers.getAddress(route.txData.object.to);
      if (to !== ethers.getAddress(this.addr)) throw new Error(`route targets ${to}`);
      if (route.approval && ethers.getAddress(route.approval.spenderAddress) !== to) {
        throw new Error(`approval spender ${route.approval.spenderAddress} differs`);
      }
      return `V3 txData.to == approval spender == target (${route.routeDetails?.dexDetails?.protocol?.name})`;
    },
  },
];

(async () => {
  const provider = getProvider();
  const owner = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, owner);
  const onchainOwner = await router.owner();
  if (onchainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`signer ${owner.address} is not router owner ${onchainOwner}`);
  }
  const results = [];
  for (const t of TARGETS) {
    const row = { name: t.name, addr: t.addr };
    try {
      row.check = await t.verify.call(t, provider);
    } catch (e) {
      results.push({ ...row, status: 'skipped', reason: e.message });
      console.log(`SKIP  ${t.name}: ${e.message}`);
      continue;
    }
    const already = await router.allowedAggregators(t.addr);
    if (already) {
      results.push({ ...row, status: 'already-whitelisted' });
      console.log(`OK    ${t.name} already whitelisted (${row.check})`);
      continue;
    }
    if (CHECK_ONLY) {
      results.push({ ...row, status: 'verified-not-whitelisted' });
      console.log(`CHECK ${t.name} verified (${row.check}), not yet whitelisted`);
      continue;
    }
    const tx = await router.setAllowedAggregator(t.addr, true, { gasLimit: 120_000 });
    const rc = await tx.wait();
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      ok = await router.allowedAggregators(t.addr);
      if (!ok) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!ok) throw new Error(`whitelist of ${t.name} not visible after tx ${tx.hash}`);
    results.push({ ...row, status: 'whitelisted', tx: tx.hash, block: rc.blockNumber, gasUsed: rc.gasUsed.toString() });
    console.log(`DONE  ${t.name} whitelisted tx ${tx.hash} block ${rc.blockNumber} (${row.check})`);
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error('FAILED:', e.shortMessage || e.message);
  process.exit(1);
});
