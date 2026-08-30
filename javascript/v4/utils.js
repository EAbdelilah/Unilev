/**
 * javascript/v4/utils.js
 * Shared setup helpers for all V4 Unichain scripts.
 *
 * Exports:
 *   setup()        – returns { provider, wallet, hook, router, pf, hookAddr,
 *                              routerAddr, keeperAddr, solverAddr, ETH, USDC, WBTC }
 *   printBalances(wallet, pf) – prints ETH/USDC/WBTC balances + USD values
 */
const { ethers } = require("ethers")
const fs = require("fs")
const path = require("path")

// Load root .env
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") })

// ── Token addresses (Unichain mainnet) ──────────────────────────────────────
const ETH  = ethers.ZeroAddress                                    // native ETH
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6"
const WBTC = "0x927B51f251480a681271180DA4de28D44EC4AfB8"

// ── ABI loaders ─────────────────────────────────────────────────────────────
function loadAbi(contractName) {
    const candidates = [
        path.resolve(__dirname, `../../out/${contractName}.sol/${contractName}.json`),
        path.resolve(__dirname, `../../dashboard/src/abis/${contractName}.json`),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, "utf8")).abi
        }
    }
    throw new Error(`ABI not found for ${contractName}. Run 'forge build' first.`)
}

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
]

// ── setup() ─────────────────────────────────────────────────────────────────
/**
 * Create and return all shared contract instances for V4 Unichain scripts.
 * Reads addresses from process.env (populated from .env).
 */
function setup() {
    const rpcUrl   = process.env.UNICHAIN_RPC_URL
    const pk       = process.env.PRIVATE_KEY
    const hookAddr  = process.env.V4_HOOK_ADDRESS
    const routerAddr = process.env.V4_ROUTER_ADDRESS
    const keeperAddr = process.env.V4_KEEPER_ADDRESS
    const pfAddr   = process.env.V4_PRICEFEED_ADDRESS
    const solverAddr = process.env.SOLVER_ADDRESS || ethers.ZeroAddress

    if (!rpcUrl)    throw new Error("UNICHAIN_RPC_URL not set in .env")
    if (!pk)        throw new Error("PRIVATE_KEY not set in .env")
    if (!hookAddr)  throw new Error("V4_HOOK_ADDRESS not set in .env")
    if (!routerAddr) throw new Error("V4_ROUTER_ADDRESS not set in .env")
    if (!pfAddr)    throw new Error("V4_PRICEFEED_ADDRESS not set in .env")

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const wallet   = new ethers.Wallet(pk, provider)

    const hookAbi   = loadAbi("EswapMarginHook")
    const routerAbi = loadAbi("EswapRouter")
    const pfAbi     = loadAbi("PriceFeed")

    const hook   = new ethers.Contract(hookAddr,   hookAbi,   wallet)
    const router = new ethers.Contract(routerAddr, routerAbi, wallet)
    const pf     = new ethers.Contract(pfAddr,     pfAbi,     wallet)

    return { provider, wallet, hook, router, pf, hookAddr, routerAddr, keeperAddr, pfAddr, solverAddr, ETH, USDC, WBTC }
}

// ── printBalances() ──────────────────────────────────────────────────────────
async function printBalances(wallet, pf) {
    const provider = wallet.provider
    const addr = wallet.address

    // Native ETH
    const ethBal = await provider.getBalance(addr)
    let ethUsd = "?"
    try {
        const v = await pf.getAmountInUsd(ETH, ethBal)
        ethUsd = parseFloat(ethers.formatUnits(v, 18)).toFixed(2)
    } catch {}
    console.log(`    ETH   : ${ethers.formatEther(ethBal).padEnd(20)} (~$${ethUsd})`)

    // USDC
    const usdc = new ethers.Contract(USDC, ERC20_ABI, provider)
    try {
        const [sym, dec, bal] = await Promise.all([usdc.symbol(), usdc.decimals(), usdc.balanceOf(addr)])
        let usd = "?"
        try { const v = await pf.getAmountInUsd(USDC, bal); usd = parseFloat(ethers.formatUnits(v, 18)).toFixed(2) } catch {}
        console.log(`    ${sym.padEnd(6)}: ${ethers.formatUnits(bal, dec).padEnd(20)} (~$${usd})`)
    } catch {}

    // WBTC
    const wbtc = new ethers.Contract(WBTC, ERC20_ABI, provider)
    try {
        const [sym, dec, bal] = await Promise.all([wbtc.symbol(), wbtc.decimals(), wbtc.balanceOf(addr)])
        let usd = "?"
        try { const v = await pf.getAmountInUsd(WBTC, bal); usd = parseFloat(ethers.formatUnits(v, 18)).toFixed(2) } catch {}
        console.log(`    ${sym.padEnd(6)}: ${ethers.formatUnits(bal, dec).padEnd(20)} (~$${usd})`)
    } catch {}
}

module.exports = { setup, printBalances, loadAbi, ERC20_ABI, ETH, USDC, WBTC }
