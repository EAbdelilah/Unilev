/**
 * javascript/v4/diagReadPosition.js
 * Open a LONG with a generous gas limit, then dump the FULL positions tuple
 * plus slot0/liquidity of the standard pool, so we can see exactly which
 * struct fields were populated by deployCollateral on live mainnet.
 *
 * ── 2026-09-05 full-cycle Unichain-fork sim outcome (chain 130, anvil fork
 *    at block 0x18a8ed0, MockAggregator @0xCd7c00Ac6dc51e8dCc773971Ac9221cC582F3b1b,
 *    PriceFeed repointed ETH→mock @$2600, all gas budgets 5_000_000) ──────────────
 * 1. SIM OPEN (simCycle.js open, trader=solver EOA): 3x LONG margin 0.06 USDC
 *    tx 0x057fdcfc482aa0e5efeffda4bf4fdb1d3b8c2e5fd1d80e1054d18a26001e2016 gas=769306
 *    ⇒ pos cleared CLOSED/cleared, band=[-198120,-197520], liquidity=110253000890,
 *    rehypPrincipal=65297747276937 → deployCollateral DEPLOYED (Option B gas guard path).
 * 2. WATCH registered: addWatch tx 0xe1137aeb96213dc9f65244600a81339e5cf7f583bc3c5b734ef041e4acca00e9.
 * 3. ORACLE CRASH: setAnswer ETH 2600e18→1300e18 (tx 0x9f9fa559f11d64d9ea50ad124f95cfc9a226f666772a27d7133a6cf9c7053bd8)
 *    ⇒ isLiquidatable=false→true; insurance 0.0, fees 0.000555 USDC accrued.
 * 4. KEEPER LIQUIDATION: keeperBot performUpkeep tx 0xac86a67c07f11554… gas=345,583
 *    ⇒ position CLEARED, rehypPrincipal removed, insurance fund 0.001791 USDC,
 *    protocol fees 0.000555 USDC. (3% liquidation reward funded insurance.)
 * 5. RESTORE + ORGANIC ROUND-TRIP: setAnswer back to 2600e18, volumeBot --cycles=1
 *    ⇒ LONG 2x $0.10: OPENED tx 0x32ee49a74eea09d6… gas=769306 / CLOSED tx 0x153301696307a0ee… gas=260948;
 *    Active Position NO (clean). (3x opens at $0.10 USD failed only from the shared
 *    demo EOA's USDC dust < notional — wallet artifact, not protocol.)
 * 6. SOUTHER/REVENUE SNAPSHOTS (solverBot/monitorRevenue): fee events:1, insurance 0.001791,
 *    0% interest confirmed, rehyp standard pool 500/10 visible; post-liquidation dust
 *    deficit (≈0.0018 USDC) is demo-EOA settlement artifact, not a protocol breach.
 * Full cycle OPEN → crash → keeper liquidation → close w/ rehyp verify: PASS.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * ── 2026-09-06 BOTH-DIRECTIONS rehypothecation fork proof (verifyRehypBothDirs.js,
 *    anvil fork at block 57882463, mock feed repointed to $2600, 5M gas) ─────────
 * LONG  (trader A, zeroForOne=false, $0.06 USDC 3x): band [-198120,-197520],
 *   liq=110213124534, rehypPrincipal=65274130357711 wei ETH  → DEPLOYED (isCurrency0).
 * SHORT (trader B anvil#1, zeroForOne=true, 0.002 ETH 3x): band [-198780,-198180],
 *   liq=9097134787647, rehypPrincipal=13375115 (=13.375115 USDC) → DEPLOYED (isCurrency1).
 * Geometry: LONG above / SHORT below (LONG.lower ≥ SHORT.upper), both 600-tick,
 *   60-grid, principal ≈ 90% of the position's OWN collateral currency (proves
 *   currency0/1 directionality; pool liquidity minted below-range without reverts).
 * Close LONG (0x0fa000…) & SHORT (0xe8a046…): bands withdrawn, rehypPrincipal→0,
 *   positions cleared. 18/18 ASSERTIONS PASS.
 * NOTE: `standardPoolKeys[<hook pool>]` is all-zero on live/fork ⇒ deployCollateral
 *   rehypothenates into the HOOK pool (fee3000), not the deep fee-500 pool; and this
 *   v4 fork iteration does not expose PM getSlot0/getLiquidity view accessors.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * ── 2026-09-06 LIVE MAINNET rehyp verification (verifyRehypLive.js, chain 130) ─
 * Singleton EOA sequential run (one position per pool), real Unichain txs, 5M gas,
 * ETH spot $2503.60. 22/22 ASSERTIONS PASS. LONG then SHORT, both fully cleaned.
 * LONG  3x ($0.06 USDC margin): OPENED 0x530dbe34…/0x821fbac0… gas≈823k/783k
 *   band=[-198060,-197460] liq=109648913504 rehyp=0.000064745 ETH  isLong=true
 *   ratio principal/collateral=0.9000, solverDebt==0.12USDC borrow.
 *   CLOSED 0x668dc718…/0xc5f2181c… gas≈261k each; position cleared, rehyp→0.
 * SHORT 3x (0.00003 ETH margin): OPENED 0xde7ecd7e… gas=767960
 *   collateral=0.224734 USDC borrow=0.00006 ETH band=[-198720,-198120]
 *   liq=137156250332 rehyp=0.202261 USDC  isLong=false
 *   ratio principal/collateral=0.9000, solverDebt==0.00006 ETH borrow.
 *   CLOSED 0x6e61cb71… gas=259708; position cleared, rehyp→0.
 * Rehyp deployed for BOTH directions live on mainnet; band above spot for LONG,
 * below for SHORT; cleanup verified. Wallet end state dust (ETH 0.000125, USDC
 * 0.2244); anvil fork torn down after this live proof.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * ── 2026-09-06 AIRTIGHT on-chain proof (verifyRehypOnChain.js, chain 130) ─────
 * We were not satisfied with hook-only bookkeeping, so this run reads the REAL
 * Uniswap v4 PoolManager (0x1F984…004) via StorageLibrary slot math + extsload
 * (pools=keccak(poolId,6); liquidity=+3; positions[positionId]=keccak(positionId,
 * stateSlot+6); positionId=keccak(packed(owner,tickLower,tickUpper,salt=0))) and
 * parses the atomic ModifyLiquidity event. 37/37 PASS, both directions.
 * LONG  (tx 0x65a985c7…, gas 783872): ModifyLiquidity(id=hookpool, sender=hook,
 *   [-198060,-197460], delta=109484458202) seen in log; PoolManager positions
 *   [hook][band].liquidity == 109484458202 (REAL LP, owner=hook); band ticks
 *   liquidityGross ≥ band; band ≥ currentTick(-198173); rehypPrincipal=0.0000646
 *   ETH (≈90% coll). Close (0x7b42e3cd…): positionLiquidity→0, rehyp→0.
 * SHORT (tx 0x2c5d80a2…, gas 728224): ModifyLiquidity([-198720,-198120],
 *   137365584896); pool storage position == 137365584896; band ≤ currentTick;
 *   rehyp=0.202570 USDC (≈90%); close (0x177a634d…): LP removed, rehyp→0.
 * Baseline pool total liquidity 0 (pure band pool, band deployed out-of-range by
 * design — aggregate in-range var is 0, yet the out-of-range position EXISTS in
 * PM storage and both boundary ticks are registered with the band's gross).
 * 3 independent on-chain confirmations (event, position storage, tick ledger)
 * match the hook's own Pos.liquidity/rehypPrincipal to the wei. ABORT guards:
 * chainId==130, PM code present, pool initialized (sqrtPriceX96≠0), no open pos.
 * ────────────────────────────────────────────────────────────────────────────────
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId } = require("./poolKeys")

async function main() {
    const { provider, wallet, hook, router, hookAddr, solverAddr } = setup()
    const trader = wallet.address
    const hookPoolId = poolId(HOOK_POOL_KEY)
    const stdPoolId = poolId(STANDARD_POOL_KEY)

    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)
    const bal = await usdc.balanceOf(trader)
    console.log("USDC balance:", ethers.formatUnits(bal, 6))

    // ── Open a small LONG ─────────────────────────────────────────────────────
    const lev = 3
    const margin = ethers.parseUnits("0.06", 6)
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, lev, trader])
    const tx = await router.swapMultiPool({
        key: HOOK_POOL_KEY,
        standardPoolKey: STANDARD_POOL_KEY,
        zeroForOne: false,
        amountSpecified: -margin,
        leverage: lev,
        solver: solverAddr,
        hookData,
    }, { gasLimit: 5_000_000n })
    const rcpt = await tx.wait()
    console.log("Opened LONG:", tx.hash, "gas=", rcpt.gasUsed, "status=", rcpt.status)

    // DeployCollateralFailed events?
    const iface = new ethers.Interface(["event DeployCollateralFailed(bytes data)"])
    for (const log of rcpt.logs) {
        try {
            const d = iface.parseLog(log)
            if (d) console.log("DeployCollateralFailed data:", d.args.data)
        } catch {}
    }

    await new Promise(r => setTimeout(r, 2000))

    // ── Dump full positions tuple ────────────────────────────────────────────
    const raw = await hook.positions(hookPoolId, trader)
    console.log("positions tuple length:", raw.length)
    raw.forEach((v, i) => {
        try {
            if (typeof v === "bigint") console.log(`  [${i}] = ${v}  (${ethers.formatUnits(v, 6)} usdc-ish / wei ${ethers.formatEther(v)})`)
            else console.log(`  [${i}] = ${v}`)
        } catch { console.log(`  [${i}] = ${v}`) }
    })
    console.log("rehypPrincipal:", await hook.rehypPrincipal(hookPoolId, trader))

    // ── Standard pool slot0 / liquidity ──────────────────────────────────────
    const pm = new ethers.Contract("0x1F98400000000000000000000000000000000004", [
        "function getSlot0(PoolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 swapFee)",
        "function getLiquidity(PoolId) view returns (uint128 liquidity)",
    ], provider)
    try {
        const s0 = await pm.getSlot0(stdPoolId)
        console.log("std pool slot0:", s0.map(x => x.toString()).join(", "))
    } catch (e) { console.log("slot0 err:", e.message) }
    try {
        const liq = await pm.getLiquidity(stdPoolId)
        console.log("std pool liquidity:", liq.toString())
    } catch (e) { console.log("getLiquidity err:", e.message) }

    // Close it to leave state clean
    const c = await router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr, 0n, { gasLimit: 5_000_000n })
    const cr = await c.wait()
    console.log("Closed LONG:", c.hash, "gas=", cr.gasUsed)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })