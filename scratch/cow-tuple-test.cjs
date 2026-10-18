const { ethers } = require("ethers");
const SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46";
const GPV2 = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const POOL_TUPLE = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const ORDER_TUPLE = "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)";
const S_ABI = [`function hashOrder(${ORDER_TUPLE}) view returns (bytes32)`, `function verify(${ORDER_TUPLE},uint8,bytes) view returns (address,bytes32,bytes)`];
(async () => {
    const p = new ethers.JsonRpcProvider("https://mainnet.base.org");
    const s = new ethers.Contract(SETTLEMENT, S_ABI, p);
    const order = {
        sellToken: USDC, buyToken: WETH, receiver: "0x17D0EaBe1A1F5781B48aacf972098f2717ed62fF",
        sellAmount: 40000n, buyAmount: 15419108702620n, validTo: 1792322289,
        appData: "0x0e6bbd5b034bb4498818f2aeeebeee214a0a31599937ed81baa6b230c859dbb3",
        feeAmount: 0n, kind: ethers.keccak256(ethers.toUtf8Bytes("sell")),
        partiallyFillable: false,
        sellTokenBalance: ethers.keccak256(ethers.toUtf8Bytes("erc20")),
        buyTokenBalance: ethers.keccak256(ethers.toUtf8Bytes("erc20")),
    };
    console.log("digest", await s.hashOrder(order));
    const sig = ethers.Signature.from({ r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32), v: 27 });
    const res = await s.verify(order, 0, ethers.concat([sig.r, sig.s, ethers.toBeBytes(sig.v)]));
    console.log("verify owner", res[0], "digest", res[1], "uid", res[2], ethers.hexlify(res[2]));
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); });
