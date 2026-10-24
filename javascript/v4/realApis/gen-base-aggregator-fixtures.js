/**
 * javascript/v4/realApis/gen-base-aggregator-fixtures.js
 *
 * Fetches REAL ParaSwap and KyberSwap routes on Base (chain 8453) for
 * USDC -> WETH and pins the exact calldata into Solidity fixtures:
 *
 *     src/v4/test/fixtures/BaseParaSwapRoute.sol
 *     src/v4/test/fixtures/BaseKyberRoute.sol
 *
 * The fixed `TAKER` address is where the fork test deploys EswapRouter, so the
 * quote's user/recipient matches the contract that executes the fill.
 *
 * Usage:
 *     node javascript/v4/realApis/gen-base-aggregator-fixtures.js
 */
const fs = require("fs")
const path = require("path")
const { getAddress } = require("ethers")

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const WETH = "0x4200000000000000000000000000000000000006"
const AMOUNT = "100000000"
const TAKER = "0x0E5a7a0e5A7A0e5a7A0e5A7a0e5a7a0e5A7a0e5A"
const CHAIN_ID = 8453
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org"
const FIXTURE_DIR = path.join(__dirname, "../../../src/v4/test/fixtures")

function checksum(addr) {
    return getAddress(addr.toLowerCase())
}

async function getJson(url, opts = {}) {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) { /* non-json */ }
    return { status: res.status, body, text }
}

async function latestBlock() {
    const r = await getJson(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    })
    if (r.body?.result) return String(BigInt(r.body.result))
    return "0"
}

function writeParaSwap(r) {
    const body = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// Produced by: javascript/v4/realApis/gen-base-aggregator-fixtures.js (${new Date().toISOString()})
/// REAL ParaSwap Base route (chain ${CHAIN_ID}), USDC -> WETH.
///   sellToken ${USDC}   sellAmount ${r.sellAmount}
///   buyToken  ${WETH}   expected ${r.expectedBuy}  min ${r.minBuy}
///   refBlock      ${r.refBlock}
///   exchangeProxy ${r.to}
///   tokenProxy    ${r.tokenProxy}
///   taker         ${TAKER}
library BaseParaSwapRoute {
    string constant SOURCE = "paraswap-v5-base";
    address constant EXCHANGE_PROXY = ${checksum(r.to)};
    address constant TOKEN_PROXY = ${checksum(r.tokenProxy)};
    address constant TAKER = ${checksum(TAKER)};
    address constant TOKEN_IN = ${checksum(USDC)};
    address constant TOKEN_OUT = ${checksum(WETH)};
    uint256 constant SELL_AMOUNT = ${r.sellAmount};
    uint256 constant EXPECTED_BUY = ${r.expectedBuy};
    uint256 constant MIN_BUY = ${r.minBuy};
    uint256 constant REF_BLOCK = ${r.refBlock};
    uint256 constant TX_VALUE = 0;
    bytes constant CALLDATA = hex"${r.data.slice(2)}";
}
`
    const out = path.join(FIXTURE_DIR, "BaseParaSwapRoute.sol")
    fs.writeFileSync(out, body)
    console.log(`[ok] ${out}`)
    console.log(`     ${r.sellAmount} USDC -> ${r.expectedBuy} WETH (min ${r.minBuy}) block ${r.refBlock}`)
    console.log(`     proxy ${r.to} tokenProxy ${r.tokenProxy}`)
}

function writeKyber(r) {
    const body = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// Produced by: javascript/v4/realApis/gen-base-aggregator-fixtures.js (${new Date().toISOString()})
/// REAL KyberSwap Base route (chain ${CHAIN_ID}), USDC -> WETH.
///   sellToken ${USDC}   sellAmount ${r.sellAmount}
///   buyToken  ${WETH}   expected ${r.expectedBuy}  min ${r.minBuy}
///   refBlock      ${r.refBlock}
///   exchangeProxy ${r.to}
///   taker         ${TAKER}
library BaseKyberRoute {
    string constant SOURCE = "kyberswap-base";
    address constant EXCHANGE_PROXY = ${checksum(r.to)};
    address constant TAKER = ${checksum(TAKER)};
    address constant TOKEN_IN = ${checksum(USDC)};
    address constant TOKEN_OUT = ${checksum(WETH)};
    uint256 constant SELL_AMOUNT = ${r.sellAmount};
    uint256 constant EXPECTED_BUY = ${r.expectedBuy};
    uint256 constant MIN_BUY = ${r.minBuy};
    uint256 constant REF_BLOCK = ${r.refBlock};
    uint256 constant TX_VALUE = 0;
    bytes constant CALLDATA = hex"${r.data.slice(2)}";
}
`
    const out = path.join(FIXTURE_DIR, "BaseKyberRoute.sol")
    fs.writeFileSync(out, body)
    console.log(`[ok] ${out}`)
    console.log(`     ${r.sellAmount} USDC -> ${r.expectedBuy} WETH (min ${r.minBuy}) block ${r.refBlock}`)
    console.log(`     proxy ${r.to}`)
}

async function main() {
    const block = await latestBlock()
    console.log(`[block] Base latest ${block}`)

    const priceUrl = `https://apiv5.paraswap.io/prices?srcToken=${USDC}&destToken=${WETH}&amount=${AMOUNT}&srcDecimals=6&destDecimals=18&side=SELL&network=${CHAIN_ID}`
    const price = await getJson(priceUrl)
    if (!price.body?.priceRoute) throw new Error(`ParaSwap price failed: ${price.status} ${price.text.slice(0, 300)}`)
    const pr = price.body.priceRoute

    const paraBody = {
        srcToken: pr.srcToken,
        destToken: pr.destToken,
        srcAmount: pr.srcAmount,
        destAmount: pr.destAmount,
        priceRoute: pr,
        userAddress: TAKER,
        receiver: TAKER,
        txOrigin: TAKER,
    }
    const paraTx = await getJson(`https://apiv5.paraswap.io/transactions/${CHAIN_ID}?ignoreChecks=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(paraBody),
    })
    if (!paraTx.body?.to || !paraTx.body?.data) {
        throw new Error(`ParaSwap build failed: ${paraTx.status} ${paraTx.text.slice(0, 300)}`)
    }
    const paraExpected = BigInt(pr.destAmount)
    writeParaSwap({
        to: paraTx.body.to,
        tokenProxy: pr.tokenTransferProxy,
        sellAmount: pr.srcAmount,
        expectedBuy: paraExpected.toString(),
        minBuy: ((paraExpected * 95n) / 100n).toString(),
        refBlock: String(pr.blockNumber ?? block),
        data: paraTx.body.data,
    })

    const routesUrl = `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${AMOUNT}&to=${TAKER}&saveGas=0&gasInclude=1`
    const routes = await getJson(routesUrl)
    if (!routes.body?.data?.routeSummary) {
        throw new Error(`Kyber routes failed: ${routes.status} ${routes.text.slice(0, 300)}`)
    }
    const rs = routes.body.data.routeSummary
    const deadline = Math.floor(Date.now() / 1000) + 3600
    const kyberBuild = await getJson("https://aggregator-api.kyberswap.com/base/api/v1/route/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            routeSummary: rs,
            deadline,
            slippageTolerance: 50,
            source: "eswap",
            recipient: TAKER,
        }),
    })
    const kd = kyberBuild.body?.data
    if (!kd?.data || !kd?.routerAddress) {
        throw new Error(`Kyber build failed: ${kyberBuild.status} ${kyberBuild.text.slice(0, 300)}`)
    }
    const kyberExpected = BigInt(kd.amountOut ?? rs.amountOut)
    writeKyber({
        to: kd.routerAddress,
        sellAmount: kd.amountIn ?? rs.amountIn,
        expectedBuy: kyberExpected.toString(),
        minBuy: ((kyberExpected * 95n) / 100n).toString(),
        refBlock: block,
        data: kd.data,
    })
}

main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
})
