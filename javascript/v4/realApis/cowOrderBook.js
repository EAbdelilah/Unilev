/**
 * javascript/v4/realApis/cowOrderBook.js
 * Real CoW Protocol order-book integration.
 *
 *   - EIP-712 mirror of the Eswap cow/ CowSigning+CowOrder hashing so the
 *     digests/domains computed here are BYTE-IDENTICAL to the ones produced by
 *     the on-chain EswapCoWSettlement (proven by the pinned vectors below and
 *     by src/v4/test/EswapSepoliaDomainCompatTest.t.sol).
 *   - `quote()` talks to the REAL CoW order-book API (api.cow.fi) and maps
 *     typed solver responses (NoLiquidity, ExcessiveValidTo, ...) to verdicts,
 *     so Phase A reports what the real solver fleet actually offers.
 */
const { ethers } = require("ethers")

const COW_TYPE_HASH = ethers.id(
    "Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)"
)
const KIND_SELL = ethers.id("sell")
const KIND_BUY = ethers.id("buy")
const BALANCE_ERC20 = ethers.id("erc20")

const GPV2 = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"

// Pinned canonical anchors (computed independently, locked into the fork test).
const ANCHORS = {
    sepoliaDomain: "0xdaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230b",
    unichainSepoliaDomain: "0xd815a6a99cfa28a883bf8ae6aaf9be04a42464a978185a0b68ebf99e9b932384",
    gnosisDomain: "0x8f05589c4b810bc2f706854508d66d447cd971f8354a4bb0b3471ceb0a466bc7",
    fixedDigest: "0x5a5d9a273a567a00d2163070db4c06d9d82db60d370b54fc758ca9c51fd5c9a4",
}

// Chains CoW operates on + our own Eswap stacks to compare domains against.
const CHAINS = {
    11155111: { name: "Ethereum Sepolia", api: "https://api.cow.fi/sepolia/api/v1", gpv2: GPV2, tokens: {
        USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
    } },
    100: { name: "Gnosis Chain", api: "https://api.cow.fi/xdai/api/v1", gpv2: GPV2, tokens: {
        WETH: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", WXDAI: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
        USDC: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
    } },
    1301: { name: "Unichain Sepolia (Eswap live stack)", api: null, gpv2: GPV2, tokens: {
        USDC: "0x31d0220469e10c4E71834a79b1f276d740d3768F", WETH: "0x4200000000000000000000000000000000000006",
    } },
}

/** CoW EIP-712 domain separator for a chain (`EIP712Domain(...)` over name
 *  "Gnosis Protocol", version "v2", chainId, verifyingContract = GPv2). */
function domainSeparator(chainId, gpv2 = GPV2) {
    return ethers.TypedDataEncoder.hashDomain({ name: "Gnosis Protocol", version: "v2", chainId, verifyingContract: gpv2 })
}

/** CoW order digest. Mirrors CowOrder.hash EXACTLY: struct hash uses keccak256
 *  of the "sell"/"erc20" strings for the string-typed fields (the same bytes32
 *  the Solidity library pre-hashes), digest = keccak256("\x19\x01" ‖ sep ‖ structHash). */
function orderDigest(order, chainId, gpv2 = GPV2) {
    const coder = ethers.AbiCoder.defaultAbiCoder()
    const kind = order.kind === "buy" ? KIND_BUY : KIND_SELL
    const sb = order.sellTokenBalance === "external" ? ethers.id("external") : order.sellTokenBalance === "internal" ? ethers.id("internal") : BALANCE_ERC20
    const bb = order.buyTokenBalance === "external" ? ethers.id("external") : order.buyTokenBalance === "internal" ? ethers.id("internal") : BALANCE_ERC20
    const structHash = ethers.keccak256(coder.encode(
        ["bytes32", "address", "address", "address", "uint256", "uint256", "uint32", "bytes32", "uint256", "bytes32", "bool", "bytes32", "bytes32"],
        [COW_TYPE_HASH, order.sellToken, order.buyToken, order.receiver, order.sellAmount, order.buyAmount, order.validTo, order.appData, order.feeAmount, kind, order.partiallyFillable, sb, bb]
    ))
    return ethers.keccak256(ethers.concat(["0x1901", domainSeparator(chainId, gpv2), structHash]))
}

/** CoW order UID: digest(32) ‖ owner(20) ‖ validTo(4). */
function uid(digest, owner, validTo) {
    return ethers.hexlify(ethers.concat([ethBytes(digest), ethers.getBytes(ethers.getAddress(owner)), uint32be(validTo)]))
}
function ethBytes(h) { return ethers.getBytes(h) }
function uint32be(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, Number(v)); return b }

/** Self-check the mirrors against the pinned canonical anchors. */
function verifyAnchors() {
    const checks = [
        ["Sepolia domain", domainSeparator(11155111), ANCHORS.sepoliaDomain],
        ["Unichain Sepolia domain", domainSeparator(1301), ANCHORS.unichainSepoliaDomain],
        ["Gnosis domain", domainSeparator(100), ANCHORS.gnosisDomain],
        ["fixed digest", orderDigest(fixedOrder(), 11155111), ANCHORS.fixedDigest],
    ]
    const failed = checks.filter(([, a, b]) => a !== b)
    return { ok: failed.length === 0, failed }
}

function fixedOrder() {
    return {
        sellToken: CHAINS[11155111].tokens.USDC,
        buyToken: CHAINS[11155111].tokens.WETH,
        receiver: ethers.ZeroAddress,
        sellAmount: "5000000",
        buyAmount: "2000000000000000",
        validTo: 2100000000,
        appData: ethers.id("eswap-real-cow-sepolia"),
        feeAmount: 0,
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    }
}

/** Real CoW order-book quote proxy. `sellAmountBeforeFee` is the modern
 *  canonical field (fees included in the sell amount). Round-trips the caller
 *  by returning the raw quote or a typed verdict object. */
async function quote({ chainId, sellToken, buyToken, sellAmountBeforeFee, appData, from, validTo, receiver }) {
    const chain = CHAINS[chainId]
    if (!chain || !chain.api) return { ok: false, type: "NO_COW_DEPLOYMENT", description: `chain ${chainId} has no CoW order-book API` }
    const body = {
        sellToken, buyToken, receiver: receiver ?? null,
        sellAmountBeforeFee: String(sellAmountBeforeFee),
        validTo, appData: appData ?? "0x" + "00".repeat(32),
        feeAmount: "0", kind: "sell", partiallyFillable: false,
        sellTokenBalance: "erc20", buyTokenBalance: "erc20",
        from: from ?? ethers.ZeroAddress, signingScheme: "eip712",
    }
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 30000)
    let res
    try {
        res = await fetch(`${chain.api}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal })
    } catch (e) {
        clearTimeout(t)
        return { ok: false, type: "API_UNREACHABLE", description: e.message }
    }
    clearTimeout(t)
    if (res.ok) {
        const data = await res.json()
        return { ok: true, type: "REAL_QUOTE", quote: data.quote, id: data.id, expiration: data.expiration, chainId }
    }
    let err = null
    try { err = await res.json() } catch (_) { /* non-json error body */ }
    return {
        ok: false,
        type: err?.errorType || "HTTP_" + res.status,
        description: err?.description || res.statusText,
        httpStatus: res.status,
        chainId,
    }
}

module.exports = { quote, domainSeparator, orderDigest, uid, verifyAnchors, fixedOrder, ANCHORS, CHAINS, GPV2, COW_TYPE_HASH, KIND_SELL, KIND_BUY, BALANCE_ERC20 }