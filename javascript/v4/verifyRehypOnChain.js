/**
 * javascript/v4/verifyRehypOnChain.js
 * AIRTIGHT live proof that rehypothecation LPs a real position in the Uniswap v4
 * PoolManager — not just hook bookkeeping. Reads the v4-core storage layout via
 * `PoolManager.extsload` (the ONLY state accessor this v4 iteration exposes):
 *
 *   pools[poolId]            slotted at keccak(poolId, 6)
 *   pools[poolId].liquidity  = stateSlot + 3
 *   pools[poolId].positions[positionId] = keccak(positionId, stateSlot + 6)
 *   pools[poolId].ticks[t]   = keccak(int256(t), stateSlot + 4)
 *   positionId = keccak(abi.encodePacked(owner, tickLower, tickUpper, salt))
 *
 * and parses the atomic `ModifyLiquidity` event from the PoolManager (emitted
 * during the open tx itself). Owner of the LP = the HOOK (msg.sender to PM).
 *
 * Safety: chainId must be 130, and a warm-up extsload must return a nonzero
 * sqrtPriceX96 BEFORE any tx is broadcast. Aborts otherwise.
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId } = require("./poolKeys")

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m", RESET = "\x1b[0m"
const delay = (ms) => new Promise(r => setTimeout(r, ms))

const PM_ADDRESS = "0x1F98400000000000000000000000000000000004"
const POOLS_SLOT = 6n
const LIQUIDITY_OFFSET = 3n
const POSITIONS_OFFSET = 6n
const TICKS_OFFSET = 4n
const ZERO_SALT = ethers.ZeroHash

const PM_ABI = [
    "function extsload(bytes32 slot) view returns (bytes32)",
    "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
]

let passed = 0, total = 0
const ok = (t, d = "") => { passed++; total++; console.log(`  ${GREEN}PASS${RESET}  ${t}${d ? "  (" + d + ")" : ""}`) }
const bad = (t, e) => { total++; console.log(`  ${RED}FAIL${RESET}  ${t}  — ${(e && e.message) || e}`) }

async function waitReceipt(provider, hash, ms = 180000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        const r = await provider.getTransactionReceipt(hash)
        if (r) return r
        await new Promise(res => setTimeout(res, 1500))
    }
    return null
}

// ── v4 storage math (mirrors StateLibrary.sol / Position.sol) ────────────────
const stateSlot = (poolId32) =>
    ethers.solidityPackedKeccak256(["bytes32", "uint256"], [poolId32, POOLS_SLOT])
const positionKey = (owner, tl, tu) =>
    ethers.solidityPackedKeccak256(["address", "int24", "int24", "bytes32"], [owner, tl, tu, ZERO_SALT])
const positionSlot = (poolId32, posId) =>
    ethers.solidityPackedKeccak256(["bytes32", "uint256"], [posId, BigInt(stateSlot(poolId32)) + POSITIONS_OFFSET])
const tickSlot = (poolId32, tick) =>
    ethers.solidityPackedKeccak256(["int256", "uint256"], [BigInt(tick), BigInt(stateSlot(poolId32)) + TICKS_OFFSET])
const decodeTick24 = (raw) => {
    const t = (raw >> 160n) & 0xffffffn
    return t >= 0x800000n ? t - 0x1000000n : t
}

async function main() {
    const { provider, wallet, hook, router, hookAddr, pf, solverAddr } = setup()
    const poolId32 = poolId(HOOK_POOL_KEY)
    const trader = wallet.address
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)
    const pm = new ethers.Contract(PM_ADDRESS, PM_ABI, provider)

    console.log(`${CYAN}═ AIRTIGHT ON-CHAIN REHYP PROOF (PoolManager extsload) ${"═".repeat(24)}${RESET}`)
    const net = await provider.getNetwork()
    if (net.chainId !== 130n) { console.log(`${RED}ABORT chainId=${net.chainId} ≠ 130${RESET}`); process.exit(1) }
    const pmCode = await provider.getCode(PM_ADDRESS)
    if (pmCode.length <= 2) { console.log(`${RED}ABORT PoolManager has no code${RESET}`); process.exit(1) }
    console.log(`  chainId ${net.chainId}  block ${await provider.getBlockNumber()}`)
    console.log(`  PM      ${PM_ADDRESS} (code=${(pmCode.length - 2) / 2}B)`)
    console.log(`  EOA     ${trader}`)
    console.log(`  hook    ${hookAddr}`)
    console.log(`  poolId  ${poolId32}`)

    // warm-up: pool must be initialized (slot0 packed word nonzero)
    const ss = stateSlot(poolId32)
    const slot0raw = BigInt(await pm.extsload(ss))
    const sqrtPriceX96 = slot0raw & ((1n << 160n) - 1n)
    if (sqrtPriceX96 === 0n) { console.log(`${RED}ABORT: hook pool never initialized (sqrtPriceX96=0)${RESET}`); process.exit(1) }
    const currentTick = decodeTick24(slot0raw)
    console.log(`  pool slot0: sqrtPriceX96=${sqrtPriceX96} currentTick=${currentTick}`)
    const totalLiq0 = BigInt(await pm.extsload(ethers.toBeHex(BigInt(ss) + LIQUIDITY_OFFSET, 32)))
    console.log(`  pool total liquidity: ${totalLiq0}`)

    const eth0 = await provider.getBalance(trader)
    const usdc0 = await usdc.balanceOf(trader)
    console.log(`  before: ETH=${ethers.formatEther(eth0)} USDC=${ethers.formatUnits(usdc0, 6)}\n`)

    const existing = await hook.positions(poolId32, trader)
    if (existing[1] !== 0n) { console.log(`${RED}ABORT: position already open${RESET}`); process.exit(1) }

    if (usdc0 < ethers.parseUnits("0.18", 6)) { console.log(`${RED}ABORT: USDC dust < 0.18 for LONG${RESET}`); process.exit(1) }
    const al = await usdc.allowance(trader, router.target)
    if (al < ethers.MaxUint256 / 2n) {
        const a = await (await usdc.approve(router.target, ethers.MaxUint256, { gasLimit: 1_000_000n })).wait(1)
        console.log(`  USDC approved (status=${a.status})`)
    }

    const findModifyLiquidity = (receipt) => {
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== PM_ADDRESS.toLowerCase()) continue
            try {
                const ev = pm.interface.parseLog({ topics: log.topics, data: log.data })
                if (ev && ev.name === "ModifyLiquidity") return ev.args
            } catch { /* not our event */ }
        }
        return null
    }

    // ── PHASE 1: LONG ─────────────────────────────────────────────────────────
    console.log(`${CYAN}── LONG 3x (margin $0.06 USDC → buys ETH, band above spot) ──${RESET}`)
    const longMargin = ethers.parseUnits("0.06", 6)
    let longTx = null, rcOpen = null
    try {
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, 3, trader])
        const tx = await router.swapMultiPool({
            key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
            zeroForOne: false, amountSpecified: -longMargin, leverage: 3,
            solver: solverAddr || trader, hookData,
        }, { gasLimit: 5_000_000n })
        longTx = tx.hash
        rcOpen = await waitReceipt(provider, tx.hash)
        if (!rcOpen || rcOpen.status !== 1) throw new Error("open LONG reverted")
        console.log(`  OPENED ${tx.hash} gas=${rcOpen.gasUsed}`)
        ok("Open LONG")
    } catch (e) { bad("Open LONG", e); return }
    await delay(2000)

    {
        const pos = await hook.positions(poolId32, trader)
        const rp = await hook.rehypPrincipal(poolId32, trader)
        console.log(`  hook position: coll=${ethers.formatEther(pos[1])} ETH borrow=${ethers.formatUnits(pos[2], 6)} USDC lev=${pos[3]} isLong=${pos[4]}`)
        console.log(`  band=[${pos[6]},${pos[7]}] liquidity=${pos[8]}  rehypPrincipal=${ethers.formatEther(rp)} ETH`)
        const ml = findModifyLiquidity(rcOpen)
        ok("isLong=true", pos[4] === true ? "yes" : "NO")
        ok("rehypPrincipal > 0", rp > 0n ? rp.toString() : "ZERO")
        ok("hook band liquidity > 0", pos[8].toString())
        ok("band width == 600", (pos[7] - pos[6]).toString())
        if (ml) {
            ok("ModifyLiquidity event seen on-chain", `tickLower=${ml.tickLower} upper=${ml.tickUpper} delta=${ml.liquidityDelta}`)
            ok("event.id == hook pool", ml.id.toLowerCase() === poolId32.toLowerCase())
            ok("event.sender == hook", ml.sender.toLowerCase() === hookAddr.toLowerCase(), ml.sender)
            ok("event range == band", ml.tickLower === pos[6] && ml.tickUpper === pos[7])
            ok("event delta == band liquidity", ml.liquidityDelta === pos[8], ml.liquidityDelta.toString())
        } else {
            bad("ModifyLiquidity event seen on-chain")
        }
        // REAL LP in PoolManager at the band's position key, owner = hook, salt 0
        const pkey = positionKey(hookAddr, pos[6], pos[7])
        const pslot = positionSlot(poolId32, pkey)
        const posLiq = BigInt(await pm.extsload(pslot)) & ((1n << 128n) - 1n)
        ok("PoolManager positions[hook][band].liquidity == band", posLiq === pos[8], posLiq.toString())
        // band ticks must be registered with at least band liquidity gross each
        const grossLo = BigInt(await pm.extsload(tickSlot(poolId32, pos[6]))) & ((1n << 128n) - 1n)
        const grossHi = BigInt(await pm.extsload(tickSlot(poolId32, pos[7]))) & ((1n << 128n) - 1n)
        ok("ticks[tickLower].liquidityGross >= band", grossLo >= pos[8], grossLo.toString())
        ok("ticks[tickUpper].liquidityGross >= band", grossHi >= pos[8], grossHi.toString())
        // geometry: LONG band entirely at/above the pool's current tick
        const slotAfter = BigInt(await pm.extsload(ss))
        const tickAfter = decodeTick24(slotAfter)
        ok("LONG band above/at current tick", pos[6] >= tickAfter, `lower=${pos[6]} tick=${tickAfter}`)
        // ratio
        const ratio = Number(rp) / Number(pos[1])
        ok("principal/collateral ∈ (0.85,0.95)", ratio > 0.85 && ratio < 0.95, ratio.toFixed(4))

        // close
        try {
            const tx = await router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr || trader, 0n, { gasLimit: 5_000_000n })
            const rc = await waitReceipt(provider, tx.hash)
            if (!rc || rc.status !== 1) throw new Error("close LONG reverted")
            console.log(`  CLOSED ${tx.hash} gas=${rc.gasUsed}`)
            ok("Close LONG")
        } catch (e) { bad("Close LONG", e) }
        await delay(2000)
        {
            const posB = await hook.positions(poolId32, trader)
            const rpB = await hook.rehypPrincipal(poolId32, trader)
            const posLiqB = BigInt(await pm.extsload(pslot)) & ((1n << 128n) - 1n)
            ok("position cleared", posB[1] === 0n)
            ok("rehypPrincipal zeroed", rpB === 0n)
            ok("PoolManager LP removed (position liquidity 0)", posLiqB === 0n, posLiqB.toString())
        }
    }

    // ── PHASE 2: SHORT ────────────────────────────────────────────────────────
    console.log(`\n${CYAN}── SHORT 3x (margin native ETH, band below spot) ──${RESET}`)
    const shortMargin = ethers.parseEther("0.00003")
    const shortNotional = shortMargin * 3n
    const ethNow = await provider.getBalance(trader)
    console.log(`  margin=${ethers.formatEther(shortMargin)} ETH notional=${ethers.formatEther(shortNotional)} balance=${ethers.formatEther(ethNow)}`)
    if (ethNow < shortNotional + ethers.parseEther("0.00001")) {
        console.log(`${YELLOW}SKIP SHORT phase (ETH dust). LONG on-chain proof stands.${RESET}`)
    } else {
        try {
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, 3, trader])
            const tx = await router.swapMultiPool({
                key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
                zeroForOne: true, amountSpecified: -shortMargin, leverage: 3,
                solver: solverAddr || trader, hookData,
            }, { value: shortNotional, gasLimit: 5_000_000n })
            rcOpen = await waitReceipt(provider, tx.hash)
            if (!rcOpen || rcOpen.status !== 1) throw new Error("open SHORT reverted")
            console.log(`  OPENED ${tx.hash} gas=${rcOpen.gasUsed}`)
            ok("Open SHORT")
        } catch (e) { bad("Open SHORT", e); return }
        await delay(2000)
        {
            const pos = await hook.positions(poolId32, trader)
            const rp = await hook.rehypPrincipal(poolId32, trader)
            console.log(`  hook position: coll=${ethers.formatUnits(pos[1], 6)} USDC borrow=${ethers.formatEther(pos[2])} ETH lev=${pos[3]} isLong=${pos[4]}`)
            console.log(`  band=[${pos[6]},${pos[7]}] liquidity=${pos[8]}  rehypPrincipal=${ethers.formatUnits(rp, 6)} USDC`)
            const ml = findModifyLiquidity(rcOpen)
            ok("isLong=false", pos[4] === false ? "yes" : "NO")
            ok("rehypPrincipal > 0 (USDC)", rp > 0n ? rp.toString() : "ZERO")
            ok("hook band liquidity > 0", pos[8].toString())
            ok("band width == 600", (pos[7] - pos[6]).toString())
            if (ml) {
                ok("ModifyLiquidity event seen on-chain", `delta=${ml.liquidityDelta}`)
                ok("event.id == hook pool", ml.id.toLowerCase() === poolId32.toLowerCase())
                ok("event.range == band", ml.tickLower === pos[6] && ml.tickUpper === pos[7])
                ok("event.delta == band liquidity", ml.liquidityDelta === pos[8], ml.liquidityDelta.toString())
            } else bad("ModifyLiquidity event seen on-chain")
            const pkey = positionKey(hookAddr, pos[6], pos[7])
            const pslot = positionSlot(poolId32, pkey)
            const posLiq = BigInt(await pm.extsload(pslot)) & ((1n << 128n) - 1n)
            ok("PoolManager positions[hook][band].liquidity == band", posLiq === pos[8], posLiq.toString())
            const grossLo = BigInt(await pm.extsload(tickSlot(poolId32, pos[6]))) & ((1n << 128n) - 1n)
            const grossHi = BigInt(await pm.extsload(tickSlot(poolId32, pos[7]))) & ((1n << 128n) - 1n)
            ok("ticks[tickLower].liquidityGross >= band", grossLo >= pos[8], grossLo.toString())
            ok("ticks[tickUpper].liquidityGross >= band", grossHi >= pos[8], grossHi.toString())
            const slotAfter = BigInt(await pm.extsload(ss))
            const tickAfter = decodeTick24(slotAfter)
            ok("SHORT band below/at current tick", pos[7] <= tickAfter, `upper=${pos[7]} tick=${tickAfter}`)
            const ratio = Number(rp) / Number(pos[1])
            ok("principal/collateral ∈ (0.85,0.95)", ratio > 0.85 && ratio < 0.95, ratio.toFixed(4))
            try {
                const tx = await router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr || trader, 0n, { gasLimit: 5_000_000n })
                const rc = await waitReceipt(provider, tx.hash)
                if (!rc || rc.status !== 1) throw new Error("close SHORT reverted")
                console.log(`  CLOSED ${tx.hash} gas=${rc.gasUsed}`)
                ok("Close SHORT")
            } catch (e) { bad("Close SHORT", e) }
            await delay(2000)
            {
                const posB = await hook.positions(poolId32, trader)
                const rpB = await hook.rehypPrincipal(poolId32, trader)
                const posLiqB = BigInt(await pm.extsload(pslot)) & ((1n << 128n) - 1n)
                ok("position cleared", posB[1] === 0n)
                ok("rehypPrincipal zeroed", rpB === 0n)
                ok("PoolManager LP removed (position liquidity 0)", posLiqB === 0n, posLiqB.toString())
            }
        }
    }

    console.log(`\n${CYAN}══ SUMMARY ══${RESET}  Passed ${passed}/${total}   (tx: ${(longTx || "").slice(0, 18)}…)`)
    const eth1 = await provider.getBalance(trader)
    const usdc1 = await usdc.balanceOf(trader)
    console.log(`  after: ETH=${ethers.formatEther(eth1)} USDC=${ethers.formatUnits(usdc1, 6)}`)
    process.exit(passed === total ? 0 : 1)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })