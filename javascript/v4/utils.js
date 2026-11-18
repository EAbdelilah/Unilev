/**
 * javascript/v4/utils.js
 * Shared setup helpers for V4 scripts. `setup()` keeps the original Unichain
 * defaults; `setupBase()` exposes the live Base stack (WETH/USDC + cbBTC/USDC).
 *
 * Exports:
 *   setup()           – Unichain provider/contracts and ETH/USDC/WBTC constants
 *   setupBase()       – Base provider/contracts and USDC/WETH/cbBTC constants
 *   printBalances()   – prints Unichain ETH/USDC/WBTC balances + USD values
 *   printBaseBalances() – prints Base WETH/cbBTC/USDC balances + USD values
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

// ── Token addresses (Base mainnet, live v4 deployment) ──────────────────────
const BASE_CHAIN_ID = 8453
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_WETH = "0x4200000000000000000000000000000000000006"
const BASE_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
const BASE_CBBTC_USD_FEED = "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D"

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

// ── setupBase() ──────────────────────────────────────────────────────────────
/**
 * Create the shared contract instances for the LIVE Base v4 stack.
 * Does not change the legacy Unichain `setup()` above.
 */
function setupBase() {
    const rpcUrl     = process.env.BASE_RPC_URL
    const pk         = process.env.PRIVATE_KEY
    const hookAddr   = process.env.V4_HOOK_ADDRESS
    const routerAddr = process.env.V4_ROUTER_ADDRESS
    const pfAddr     = process.env.V4_PRICEFEED_ADDRESS
    const timelockAddr = process.env.V4_TIMELOCK_ADDRESS

    if (!rpcUrl)     throw new Error("BASE_RPC_URL not set in .env")
    if (!pk)         throw new Error("PRIVATE_KEY not set in .env")
    if (!hookAddr)   throw new Error("V4_HOOK_ADDRESS not set in .env")
    if (!routerAddr) throw new Error("V4_ROUTER_ADDRESS not set in .env")
    if (!pfAddr)     throw new Error("V4_PRICEFEED_ADDRESS not set in .env")

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const wallet   = new ethers.Wallet(pk, provider)

    const hookAbi   = loadAbi("EswapMarginHook")
    const routerAbi = loadAbi("EswapRouter")
    const pfAbi     = loadAbi("PriceFeed")

    const hook   = new ethers.Contract(hookAddr,   hookAbi,   wallet)
    const router = new ethers.Contract(routerAddr, routerAbi, wallet)
    const pf     = new ethers.Contract(pfAddr,     pfAbi,     wallet)

    return {
        provider, wallet, hook, router, pf,
        hookAddr, routerAddr, pfAddr, timelockAddr,
        chainId: BASE_CHAIN_ID,
        USDC: BASE_USDC,
        WETH: BASE_WETH,
        CBBTC: BASE_CBBTC,
        CBBTC_USD_FEED: BASE_CBBTC_USD_FEED,
    }
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

// ── printBaseBalances() ──────────────────────────────────────────────────────
async function printBaseBalances(wallet, pf) {
    const provider = wallet.provider
    const addr = wallet.address
    const tokens = [
        ["WETH", BASE_WETH, 18],
        ["cbBTC", BASE_CBBTC, 8],
        ["USDC", BASE_USDC, 6],
    ]

    for (const [label, tokenAddr, decimals] of tokens) {
        const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider)
        try {
            const bal = await token.balanceOf(addr)
            let usd = "?"
            try {
                const v = await pf.getAmountInUsd(tokenAddr, bal)
                usd = parseFloat(ethers.formatUnits(v, 18)).toFixed(2)
            } catch {}
            console.log(
                `    ${label.padEnd(6)}: ${ethers.formatUnits(bal, decimals).padEnd(20)} (~$${usd})`,
            )
        } catch {}
    }
}

module.exports = {
    setup,
    setupBase,
    printBalances,
    printBaseBalances,
    loadAbi,
    ERC20_ABI,
    ETH,
    USDC,
    WBTC,
    BASE_CHAIN_ID,
    BASE_USDC,
    BASE_WETH,
    BASE_CBBTC,
    BASE_CBBTC_USD_FEED,
}
