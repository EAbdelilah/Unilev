import { describe, expect, it } from "vitest";
import {
    decodeAbiParameters,
    decodeFunctionData,
    parseUnits,
    type Hex,
} from "viem";
import {
    BASE_CHAIN_ID,
    CBBTC,
    ESWAP_CONTRACTS,
    LEVERAGE,
    POOL_KEY_COMPONENTS,
    ROUTER_ABI,
    ROUTER_EXT_ABI,
    SETTLEMENT_ABI,
    TRIGGER_ORDER_DOMAIN,
    USDC,
    WETH,
    type SwapParams,
    buildContangoQuote,
    buildEnsoRouteRequest,
    buildEnsoShortcut,
    buildUniDexRoute,
    encodeSettlementHookData,
    encodeSettlementOriginData,
    getPairConfig,
} from "../src/index.js";

const SOLVER = "0x1111111111111111111111111111111111111111";
const TRADER = "0x2222222222222222222222222222222222222222";
const FEE_RECIPIENT = "0x3333333333333333333333333333333333333333";
const NOW = 1_800_000_000n;

function decodeSwap(data: Hex) {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data });
    expect(decoded.functionName).toBe("swapMultiPool");
    const params = decoded.args[0] as SwapParams | undefined;
    expect(params).toBeDefined();
    return params!;
}

describe("adapter calldata validity", () => {
    it("builds an Enso shortcut whose terminal call is a valid viem swapMultiPool transaction", () => {
        const shortcut = buildEnsoShortcut({
            pair: "WETH/USDC",
            collateralUsdc: "1000",
            quoteOutputUnits: parseUnits("1", 18),
            solver: SOLVER,
            nowSeconds: () => Number(NOW),
            allowanceUnits: 0n,
            skipEscrow: true,
        });

        expect(shortcut.chainId).toBe(BASE_CHAIN_ID);
        expect(shortcut.calls.length).toBe(2); // approve + swap (escrow pre-funded)
        expect(shortcut.calls[1]!.to).toBe(ESWAP_CONTRACTS.router);
        const terminal = shortcut.calls.at(-1)!;
        const params = decodeSwap(terminal.data);
        expect(shortcut.selector).toBe(terminal.data.slice(0, 10));
        expect(params.amountSpecified).toBe(-1_000_000_000n);
        expect(params.leverage).toBe(LEVERAGE);
        expect(params.zeroForOne).toBe(false);
        expect(params.deadline).toBe(NOW + 900n);
        expect(params.minAmountOut).toBe((parseUnits("1", 18) * 9_900n) / 10_000n);
        expect(shortcut.tokens).toEqual([USDC.address, WETH.address]);
    });

    it("builds a JSON-safe Enso /shortcuts/route POST body", () => {
        const request = buildEnsoRouteRequest({
            pair: "cbBTC/USDC",
            collateralUsdc: "250",
            quoteOutputUnits: 2_500_000n, // 0.025 cbBTC at 10k
            solver: SOLVER,
            nowSeconds: () => Number(NOW),
            skipEscrow: true,
        });
        expect(request.method).toBe("POST");
        expect(request.endpoint).toBe("https://api.enso.finance/api/v1/shortcuts/route");
        expect(JSON.parse(JSON.stringify(request.body)).amountIn).toBe("250000000");
        expect(request.body.leverage).toBe(5);
        expect(() => JSON.stringify(request)).not.toThrow();
    });

    it("builds a normalized Contango quote with zero borrow APR and decoded router calldata", () => {
        const quote = buildContangoQuote({
            pair: "cbBTC/USDC",
            collateralUsdc: "1000",
            quoteOutputUnits: 50_000_000n, // 0.5 cbBTC, strict 8dp
            solver: SOLVER,
            nowSeconds: () => Number(NOW),
        });

        expect(quote.moneyMarket).toBe("none");
        expect(quote.eswapBorrowAprBps).toBe(0);
        expect(quote.benchmarkBorrowAprBps).toBe(1200);
        expect(quote.tokenOutDecimals).toBe(8);
        expect(quote.borrowUsdcUnits).toBe("4000000000");
        expect(quote.annualBorrowInterestSavedUsdc).toBe("480000000"); // 4000 * 12% = 480 USDC
        expect(quote.call.to).toBe(ESWAP_CONTRACTS.router);
        expect(quote.call.value).toBe(0n);

        const params = decodeSwap(quote.call.data);
        expect(params.key.currency0.toLowerCase()).toBe(USDC.address.toLowerCase());
        expect(params.zeroForOne).toBe(true);
        expect(params.amountSpecified).toBe(-1_000_000_000n);
        expect(params.minAmountOut.toString()).toBe(quote.minAmountOut);
        expect(params.deadline.toString()).toBe(quote.deadline);
    });

    it("enforces the UniDex 15-minute deadline, fee cap and slippage floor", () => {
        const route = buildUniDexRoute({
            pair: "WETH/USDC",
            collateralUsdc: "500",
            quoteOutputUnits: parseUnits("0.1", 18),
            solver: SOLVER,
            feeRecipient: FEE_RECIPIENT,
            partnerFeeBps: 25,
            nowSeconds: () => Number(NOW),
        });
        expect(route.deadline).toBe((NOW + 900n).toString());
        expect(route.deadlineSeconds).toBe(900);
        expect(route.partnerFee.amountUnits).toBe(
            ((parseUnits("0.1", 18) * 25n) / 10_000n).toString(),
        );
        const params = decodeSwap(route.call.data);
        expect(params.minAmountOut.toString()).toBe(route.minAmountOut);
        expect(params.minAmountOut).toBeLessThan(parseUnits("0.1", 18));
        expect(() =>
            buildUniDexRoute({
                pair: "WETH/USDC",
                collateralUsdc: "500",
                quoteOutputUnits: 1n,
                solver: SOLVER,
                feeRecipient: FEE_RECIPIENT,
                partnerFeeBps: 1001,
            }),
        ).toThrow(/partnerFeeBps/);
    });

    it("rejects non-5x intent in Enso and invalid quote output in every adapter", () => {
        expect(() =>
            buildEnsoShortcut({
                pair: "WETH/USDC",
                collateralUsdc: "100",
                leverage: 3 as never,
                quoteOutputUnits: 1n,
                solver: SOLVER,
            }),
        ).toThrow(/5x only/);
        expect(() =>
            buildContangoQuote({
                pair: "WETH/USDC",
                collateralUsdc: "100",
                quoteOutputUnits: 0n,
                solver: SOLVER,
            }),
        ).toThrow(/positive/);
    });
});

describe("strict 6 / 18 / 8 decimal scaling", () => {
    it("keeps USDC at 6, WETH at 18 and cbBTC at 8 across adapter outputs", () => {
        expect([USDC.address, USDC.decimals]).toEqual([
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            6,
        ]);
        expect([WETH.address, WETH.decimals]).toEqual([
            "0x4200000000000000000000000000000000000006",
            18,
        ]);
        expect([CBBTC.address, CBBTC.decimals]).toEqual([
            "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
            8,
        ]);

        const weth = buildContangoQuote({
            pair: "WETH/USDC",
            collateralUsdc: "1000",
            quoteOutputUnits: 10n ** 18n,
            solver: SOLVER,
        });
        const cbbtc = buildContangoQuote({
            pair: "cbBTC/USDC",
            collateralUsdc: "1000",
            quoteOutputUnits: 50_000_000n,
            solver: SOLVER,
        });
        expect(weth.netOutputUnits).toBe((999_000_000_000_000_000n).toString());
        expect(cbbtc.netOutputUnits).toBe("49950000");
        expect(weth.tokenOutDecimals).toBe(18);
        expect(cbbtc.tokenOutDecimals).toBe(8);
        expect(weth.collateralUsdcUnits).toBe("1000000000");
        expect(cbbtc.collateralUsdcUnits).toBe("1000000000");
    });
});

describe("settlement + rebalancer calldata", () => {
    it("encodes ERC-7683 originData with hookData that credits the recipient", () => {
        const config = getPairConfig("cbBTC/USDC");
        const originData = encodeSettlementOriginData({
            key: config.hookPoolKey,
            standardPoolKey: config.standardPoolKey,
            zeroForOne: true,
            amountSpecified: -1_000_000_000n,
            leverage: 5,
            solver: ESWAP_CONTRACTS.settlement,
            hookData: encodeSettlementHookData(TRADER),
            deadline: NOW,
            minAmountOut: 49_500_000n,
        });
        const decoded = decodeAbiParameters(
            [
                { type: "tuple", components: POOL_KEY_COMPONENTS },
                { type: "tuple", components: POOL_KEY_COMPONENTS },
                { type: "bool" },
                { type: "int256" },
                { type: "uint8" },
                { type: "address" },
                { type: "bytes" },
                { type: "uint256" },
            ],
            originData,
        );
        expect(decoded[6]).toBe(encodeSettlementHookData(TRADER));
        const hook = decodeAbiParameters(
            [
                { name: "isLong", type: "bool" },
                { name: "leverage", type: "uint8" },
                { name: "recipient", type: "address" },
            ],
            decoded[6],
        );
        expect(hook).toEqual([true, 5, TRADER]);
    });

    it("exposes trigger-order ABI with the canonical EIP-712 domain", () => {
        expect(TRIGGER_ORDER_DOMAIN).toEqual({
            name: "EswapRouter",
            version: "1",
            chainId: 8453,
            verifyingContract: ESWAP_CONTRACTS.router,
        });
        expect(
            ROUTER_EXT_ABI.some((item) => "name" in item && item.name === "executeTriggerOrder"),
        ).toBe(true);
        expect(SETTLEMENT_ABI.some((item) => "name" in item && item.name === "fill")).toBe(true);
    });
});
