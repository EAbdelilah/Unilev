/**
 * javascript/v4/keeperBot.js
 * Keeper Bot — monitors all positions and triggers liquidations
 * when health drops below threshold. Protects protocol solvency.
 *
 * Run:
 *   node javascript/v4/keeperBot.js
 *
 * What it does:
 *   1. Polls the on-chain keeper's checkUpkeep every INTERVAL seconds
 *   2. When liquidation is needed, calls performUpkeep or router.liquidate
 *   3. Tracks liquidation events and insurance fund changes
 *   4. Also monitors via the hook's isLiquidatable for watched positions
 */
const { ethers } = require("ethers")
const { setup, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId: computePoolId } = require("./poolKeys")

const POLL_INTERVAL_MS = 15_000 // 15 seconds

const GREEN  = "\x1b[32m"
const CYAN   = "\x1b[36m"
const YELLOW = "\x1b[33m"
const RED    = "\x1b[31m"
const RESET  = "\x1b[0m"

const KEEPER_ABI = [
    "function hook() view returns (address)",
    "function router() view returns (address)",
    "function owner() view returns (address)",
    "function checkUpkeep(bytes calldata checkData) view returns (bool upkeepNeeded, bytes memory performData)",
    "function performUpkeep(bytes calldata performData) external",
    "function liquidate(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) external returns (bool)",
    "function liquidateAll() external returns (uint256 count)",
    "function quoteMinAmountOut(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) view returns (uint256)",
    "function addWatch(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) external",
    "function removeWatch(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) external",
    "function watchesLength() view returns (uint256)",
    "function watches(uint256) view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader)",
    "function isWatched(bytes32 id) view returns (bool)",
    "function slippageBps() view returns (uint256)",
]

function fmtUsd(raw) { return `$${parseFloat(ethers.formatUnits(raw, 18)).toFixed(2)}` }
function fmtToken(raw, dec = 18) { return parseFloat(ethers.formatUnits(raw, dec)).toFixed(6) }

async function main() {
    const { provider, wallet, hook, router, pf, hookAddr, keeperAddr } = setup()

    const poolKey = HOOK_POOL_KEY
    const standardPoolKey = STANDARD_POOL_KEY
    const poolId = computePoolId(HOOK_POOL_KEY)

    const keeper = new ethers.Contract(keeperAddr, KEEPER_ABI, wallet)

    console.log(`\n${"═".repeat(58)}`)
    console.log(`  KEEPER BOT — Eswap V4 Unichain`)
    console.log(`  Caller    : ${wallet.address}`)
    console.log(`  Keeper    : ${keeperAddr}`)
    console.log(`  Hook      : ${hookAddr}`)
    console.log(`  Router    : ${router.target}`)
    console.log(`  Interval  : ${POLL_INTERVAL_MS / 1000}s`)
    console.log(`${"═".repeat(58)}\n`)

    // Check if caller is keeper owner
    const keeperOwner = await keeper.owner()
    const isOwner = keeperOwner.toLowerCase() === wallet.address.toLowerCase()
    console.log(`  Keeper Owner  : ${keeperOwner}`)
    console.log(`  Is Owner      : ${isOwner ? "✅ YES" : "⚠️  NO (will use router.liquidate directly)"}`)

    // Check existing watches
    const watchLen = await keeper.watchesLength()
    console.log(`  Watched Positions: ${watchLen}`)

    // List watched positions
    if (watchLen > 0n) {
        console.log(`\n  Watched positions:`)
        for (let i = 0n; i < watchLen; i++) {
            try {
                const w = await keeper.watches(i)
                const pos = await hook.positions(poolId, w.trader)
                const hasPos = pos[1] !== 0n
                const isLiq = hasPos ? await hook.isLiquidatable({
                    trader: pos[0], collateralAmount: pos[1], borrowedAmount: pos[2],
                    leverage: pos[3], isLong: pos[4], liquidationSqrtPrice: pos[5],
                    tickLower: pos[6], tickUpper: pos[7], liquidity: pos[8],
                }, poolKey) : false

                const status = !hasPos ? "CLOSED" : isLiq ? `${RED}LIQUIDATABLE${RESET}` : `${GREEN}HEALTHY${RESET}`
                console.log(`    [${i}] ${w.trader.slice(0, 10)}… ${status}`)
                if (hasPos) {
                    console.log(`        Collateral: ${fmtToken(pos[1])} ETH, Borrowed: ${fmtToken(pos[2], 6)} USDC, Lev: ${pos[3]}x, ${pos[4] ? "LONG" : "SHORT"}`)
                }
            } catch (e) {
                console.log(`    [${i}] Error reading: ${e.message}`)
            }
        }
    }

    // Eth price
    const ethPrice = await pf.getAmountInUsd(ETH, ethers.parseEther("1"))
    console.log(`\n  ETH Price: ${fmtUsd(ethPrice)}`)

    let liquidationCount = 0

    console.log(`\n${GREEN}  Polling for liquidations… (Ctrl+C to stop)${RESET}`)

    while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

        try {
            // ── 1. Try on-chain keeper checkUpkeep ───────────────
            let upkeepNeeded = false
            let performData = "0x"

            try {
                const result = await keeper.checkUpkeep("0x")
                upkeepNeeded = result[0]
                performData = result[1]
            } catch (e) {
                // checkUpkeep might revert if no positions
            }

            if (upkeepNeeded) {
                const now = new Date().toISOString().slice(11, 19)
                console.log(`\n${YELLOW}━━━ [${now}] UPKEEP NEEDED ━━━${RESET}`)
                console.log(`  performData: ${performData.slice(0, 66)}…`)

                if (isOwner) {
                    try {
                        const tx = await keeper.performUpkeep(performData, { gasLimit: 5_000_000n })
                        const receipt = await tx.wait()
                        liquidationCount++
                        console.log(`  ${GREEN}LIQUIDATED via performUpkeep${RESET} — Tx: ${tx.hash.slice(0, 18)}… Gas: ${receipt.gasUsed}`)
                    } catch (e) {
                        console.error(`  ${RED}performUpkeep FAILED: ${e.message}${RESET}`)
                    }
                } else {
                    console.log(`  ⚠️  Not keeper owner — cannot call performUpkeep`)
                }
            }

            // ── 2. Scan watched positions via isLiquidatable ─────
            const watchLenNow = await keeper.watchesLength()
            for (let i = 0n; i < watchLenNow; i++) {
                try {
                    const w = await keeper.watches(i)
                    const pos = await hook.positions(poolId, w.trader)
                    if (pos[1] === 0n) continue // no position

                    const isLiq = await hook.isLiquidatable({
                        trader: pos[0], collateralAmount: pos[1], borrowedAmount: pos[2],
                        leverage: pos[3], isLong: pos[4], liquidationSqrtPrice: pos[5],
                        tickLower: pos[6], tickUpper: pos[7], liquidity: pos[8],
                    }, poolKey)

                    if (isLiq) {
                        const now = new Date().toISOString().slice(11, 19)
                        console.log(`\n${YELLOW}━━━ [${now}] LIQUIDATABLE: ${w.trader.slice(0, 10)}… ━━━${RESET}`)
                        console.log(`  Collateral: ${fmtToken(pos[1])} ETH, Borrowed: ${fmtToken(pos[2], 6)} USDC, Lev: ${pos[3]}x`)

                        // Try keeper.liquidate first
                        if (isOwner) {
                            try {
                                const tx = await keeper.liquidate(poolKey, w.trader, { gasLimit: 5_000_000n })
                                const receipt = await tx.wait()
                                liquidationCount++
                                console.log(`  ${GREEN}LIQUIDATED via keeper.liquidate${RESET} — Tx: ${tx.hash.slice(0, 18)}… Gas: ${receipt.gasUsed}`)
                                continue
                            } catch (e) {
                                console.log(`  keeper.liquidate failed: ${e.message}, trying router.liquidate…`)
                            }
                        }

                        // Fallback to router.liquidate
                        try {
                            const tx = await router.liquidate(hookAddr, poolKey, w.trader, 0n, { gasLimit: 5_000_000n })
                            const receipt = await tx.wait()
                            liquidationCount++
                            console.log(`  ${GREEN}LIQUIDATED via router.liquidate${RESET} — Tx: ${tx.hash.slice(0, 18)}… Gas: ${receipt.gasUsed}`)
                        } catch (e) {
                            console.error(`  ${RED}router.liquidate FAILED: ${e.message}${RESET}`)
                        }
                    }
                } catch (e) {
                    // skip
                }
            }

            // ── 3. Periodic health report ────────────────────────
            const insuranceFund = await hook.insuranceFund(USDC)
            const protocolFees = await hook.protocolFees(USDC)

            // Only print every 10 cycles to reduce noise
            if (liquidationCount > 0 || Math.random() < 0.1) {
                const now = new Date().toISOString().slice(11, 19)
                console.log(`  [${now}] Insurance: ${fmtToken(insuranceFund, 6)} USDC | Fees: ${fmtToken(protocolFees, 6)} USDC | Liquidations: ${liquidationCount}`)
            }

        } catch (e) {
            console.error(`${RED}  Poll error: ${e.message}${RESET}`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) })
