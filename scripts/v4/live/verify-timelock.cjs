// Live check of the governance handover on Base (8453).
// Read-only. Exits non-zero if any assertion fails.
//
// Expected state after `DeployTimelock.s.sol --sig "handover()"`:
//   hook owner            == V4_TIMELOCK_ADDRESS            (single-step, done)
//   router owner          == EOA until the accept executes  (Ownable2Step)
//   router pendingOwner   == V4_ROUTER_TIMELOCK_ADDRESS
//   accept is queued on the router timelock at ROUTER_ACCEPT_ETA
// After `executeRouterAccept`: router owner == V4_ROUTER_TIMELOCK_ADDRESS.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { ethers } = require('ethers');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const HOOK = process.env.V4_HOOK_ADDRESS;
const ROUTER = process.env.V4_ROUTER_ADDRESS;
const HOOK_TL = process.env.V4_TIMELOCK_ADDRESS;
const ROUTER_TL = process.env.V4_ROUTER_TIMELOCK_ADDRESS;
const ETA = process.env.ROUTER_ACCEPT_ETA;
const EOA = process.env.TIMELOCK_ADMIN || '0x518634753C61342298c3E04326056b3Ce596a566';
const DELAY = 48 * 3600;
const GRACE = 14 * 24 * 3600;

const OWNABLE = [
    'function owner() view returns (address)',
    'function pendingOwner() view returns (address)',
];
const TL = [
    'function admin() view returns (address)',
    'function hook() view returns (address)',
    'function delay() view returns (uint256)',
    'function GRACE_PERIOD() view returns (uint256)',
    'function isQueued(bytes32) view returns (bool)',
    'function getTxHash(address,bytes,uint256) view returns (bytes32)',
];

let failures = 0;
function check(label, ok, detail = '') {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failures++;
}
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

(async () => {
    const p = new ethers.JsonRpcProvider(RPC);
    const hook = new ethers.Contract(HOOK, OWNABLE, p);
    const router = new ethers.Contract(ROUTER, OWNABLE, p);
    const hookTl = new ethers.Contract(HOOK_TL, TL, p);
    const routerTl = new ethers.Contract(ROUTER_TL, TL, p);

    console.log('== 1. timelock instances ==');
    for (const [label, tl, target] of [
        ['hook timelock', hookTl, HOOK],
        ['router timelock', routerTl, ROUTER],
    ]) {
        check(`${label} admin is EOA`, same(await tl.admin(), EOA));
        check(`${label} bound to target`, same(await tl.hook(), target));
        check(`${label} delay 48h`, (await tl.delay()) == BigInt(DELAY));
        check(`${label} grace 14d`, (await tl.GRACE_PERIOD()) == BigInt(GRACE));
    }

    console.log('== 2. ownership ==');
    check('hook owner == hook timelock', same(await hook.owner(), HOOK_TL));
    const rOwner = await router.owner();
    const rPending = await router.pendingOwner();
    const accepted = same(rOwner, ROUTER_TL);
    if (accepted) {
        check('router owner == router timelock (accept executed)', true);
    } else {
        // Ownable2Step: the EOA stays owner until the timelock accepts. That is
        // expected until ROUTER_ACCEPT_ETA, so it is PENDING, not a failure.
        check('router pendingOwner == router timelock', same(rPending, ROUTER_TL));
        const data = ethers.id('acceptOwnership()').slice(0, 10);
        const queued = ETA
            ? await routerTl.isQueued(await routerTl.getTxHash(ROUTER, data, BigInt(ETA)))
            : false;
        check('router accept queued at ROUTER_ACCEPT_ETA', queued);
        const left = Number(ETA) - Math.floor(Date.now() / 1000);
        console.log(
            `  PENDING router owner still ${rOwner}; accept executable in ${Math.max(0, left)}s` +
                (left <= 0 ? ' (run executeRouterAccept now)' : '')
        );
    }

    console.log(failures ? `\n❌ ${failures} assertion(s) failed` : '\n✅ all timelock assertions passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
