var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
/**
 * Eswap AgentKit action provider.
 *
 * Actions
 *  ─ get_eswap_margin_quote : read-only eth_call through `router.quoteExactInput`
 *                             (+ `hook.quoteOpenFit` size gates) — expected fill,
 *                             0.10% fee, and the 7-day carry savings vs. a
 *                             12% APR continuous-borrow benchmark.
 *  ─ open_spot_margin       : approve USDC -> self-bond the borrow leg into
 *                             `erc20BorrowEscrow` -> `router.swapMultiPool`
 *                             (5x spot margin; 0% daily carry).
 *
 * Both actions are ONLY registered on Base mainnet (chainId 8453).
 */
import "reflect-metadata";
import { ActionProvider, CreateAction } from "@coinbase/agentkit";
import { ERC20_ABI, ESWAP_HOOK_ABI, ESWAP_ROUTER_ABI } from "./abis.js";
import { DEFAULT_LEVERAGE, DEFAULT_SLIPPAGE_TOLERANCE_BPS, DEFAULT_TX_DEADLINE_SECONDS, ESWAP_CHAIN_ID, ESWAP_NETWORK_ID, ESWAP_PAIRS, hookPoolKey, MAX_UINT256, resolveEswapDeployment, } from "./constants.js";
import { EswapProviderError } from "./errors.js";
import { buildApproveCalldata, buildDepositBorrowEscrowCalldata, buildOpenMarginCalldata, carryDragBenchmarkRaw, defaultStandardPoolKey, formatRawAmount, marginParts, minAmountOutOf, parseRawAmount, poolIdOf, protocolFeeRaw, txExplorerUrl, } from "./utils.js";
import { GetEswapQuoteSchema, OpenSpotMarginSchema } from "./schemas.js";
function isBaseNetwork(network) {
    if (network.protocolFamily !== "evm") {
        return false;
    }
    if (network.networkId === ESWAP_NETWORK_ID) {
        return true;
    }
    const rawChainId = network.chainId;
    if (typeof rawChainId !== "string") {
        return false;
    }
    const chainId = rawChainId.startsWith("0x") || rawChainId.startsWith("0X")
        ? BigInt(rawChainId).toString()
        : rawChainId;
    return chainId === String(ESWAP_CHAIN_ID);
}
function pairConfig(pair) {
    return ESWAP_PAIRS[pair];
}
function fail(code, cause, context) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new EswapProviderError(code, `${context}: ${message}`, { cause });
}
export class EswapActionProvider extends ActionProvider {
    constructor() {
        super("eswap", []);
    }
    /** @inheritdoc AgentKit — only Base mainnet. */
    supportsNetwork(network) {
        return isBaseNetwork(network);
    }
    async getEswapMarginQuote(walletProvider, args) {
        if (!isBaseNetwork(walletProvider.getNetwork())) {
            throw new EswapProviderError("UNSUPPORTED_NETWORK", "Eswap 5x spot margin is only available on Base mainnet (chainId 8453).");
        }
        const trader = walletProvider.getAddress();
        const deployment = resolveEswapDeployment();
        const pair = pairConfig(args.pair);
        const marginRaw = parseRawAmount(args.collateralAmount, pair.quoteDecimals);
        const { notional, borrowed } = marginParts(marginRaw, DEFAULT_LEVERAGE);
        const feeRaw = protocolFeeRaw(notional);
        const carrySavedRaw = carryDragBenchmarkRaw(borrowed);
        const hookKey = hookPoolKey(pair, deployment.hook);
        const hookKeyArgs = { currency0: hookKey[0], currency1: hookKey[1], fee: hookKey[2], tickSpacing: hookKey[3], hooks: hookKey[4] };
        // Live quote: the router resolves the configured standard pool itself,
        // applies its measured 100bps execution discount, and returns an
        // int128 estimate of the leveraged output (verified live on Base).
        let expectedOutRaw;
        try {
            expectedOutRaw = await walletProvider.readContract({
                address: deployment.router,
                abi: ESWAP_ROUTER_ABI,
                functionName: "quoteExactInput",
                args: [hookKeyArgs, pair.longZeroForOne, -(marginRaw), DEFAULT_LEVERAGE],
            });
        }
        catch (cause) {
            fail("QUOTE_FAILED", cause, `router.quoteExactInput for ${args.pair} (margin=${args.collateralAmount} USDC)`);
        }
        // Size gates: leverage bounds, duplicate position, collateral floor, OI caps.
        let fit;
        try {
            const result = (await walletProvider.readContract({
                address: deployment.hook,
                abi: ESWAP_HOOK_ABI,
                functionName: "quoteOpenFit",
                args: [hookKeyArgs, trader, pair.quote, DEFAULT_LEVERAGE, marginRaw, borrowed],
            }));
            fit = { fits: result[0], reason: result[1] };
        }
        catch {
            fit = undefined; // degrade gracefully — the fit check is advisory in a quote
        }
        const lines = [
            `**Eswap 5x Spot Margin Quote — ${args.pair} (Base mainnet)**`,
            `Collateral (margin): ${formatRawAmount(marginRaw, pair.quoteDecimals)} USDC`,
            `Leveraged notional : ${formatRawAmount(notional, pair.quoteDecimals)} USDC (5x)`,
            `Borrow leg (0% carry): ${formatRawAmount(borrowed, pair.quoteDecimals)} USDC, escrow-bonded from your own wallet`,
            `Expected fill      : ≈ ${formatRawAmount(expectedOutRaw, pair.baseDecimals)} ${pair.baseSymbol} (router spot-estimate, pre-impact)`,
            `Protocol fee       : ${formatRawAmount(feeRaw, pair.quoteDecimals)} USDC (flat 0.10%, settled into protocolFees)`,
            `Hook pool          : fee 3000 / tickSpacing 60, poolId ${poolIdOf(hookKey).slice(0, 18)}…`,
        ];
        if (args.pair === "WBTC/USDC" && !pair.fillVenueConfiguredInOut) {
            lines.push(`⚠️ Fill venue: the WBTC/USDC standard (deep-fill) pool is NOT configured on the live deployment yet — ` +
                `opens on this pair will revert until governance registers a standard pool. Quote shown for planning only.`);
        }
        else {
            lines.push(`Fill venue         : standard pool (500 / 10) configured via hook.standardPoolKeys`);
        }
        if (fit !== undefined) {
            lines.push(fit.fits
                ? `Open-fit check     : ✅ passes all size gates (leverage bounds, collateral floor, OI caps) for ${trader}`
                : `Open-fit check     : ❌ ${fit.reason}`);
        }
        lines.push(`Carry comparison   : 0.00%/day on Eswap. The same ${formatRawAmount(borrowed, pair.quoteDecimals)} USDC borrowed ` +
            `at a 12% APR benchmark would cost ≈ ${formatRawAmount(carrySavedRaw, pair.quoteDecimals)} USDC over a 7-day hold — ` +
            `saved on Eswap (illustrative comparison, not an Eswap charge).`);
        lines.push(`_Estimate only — the executable floor for an open is quote × (1 − slippageBps/1e4); actual fills depend on live depth._`);
        return lines.join("\n");
    }
    async openSpotMargin(walletProvider, args) {
        if (!isBaseNetwork(walletProvider.getNetwork())) {
            throw new EswapProviderError("UNSUPPORTED_NETWORK", "Eswap 5x spot margin is only available on Base mainnet (chainId 8453).");
        }
        const pair = pairConfig(args.pair);
        if (args.pair === "WBTC/USDC" && !pair.fillVenueConfiguredInOut) {
            // Reinforced by the quote action — be explicit before money moves.
            throw new EswapProviderError("PAIR_FILL_VENUE_NOT_CONFIGURED", "WBTC/USDC has no configured standard fill venue on the live deployment; opening would revert. Use WETH/USDC or point the provider at a redeployed deployment.");
        }
        const trader = walletProvider.getAddress();
        const deployment = resolveEswapDeployment();
        const marginRaw = parseRawAmount(args.collateralAmount, pair.quoteDecimals);
        const { notional, borrowed } = marginParts(marginRaw, DEFAULT_LEVERAGE);
        const requiredUsdcRaw = notional; // margin + borrow, both funded/escrowed by this very wallet
        // 1. Balance check (USDC, 6 decimals).
        const balanceRaw = await walletProvider.readContract({
            address: pair.quote,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [trader],
        });
        if (balanceRaw < requiredUsdcRaw) {
            throw new EswapProviderError("INSUFFICIENT_BALANCE", `Wallet ${trader} has ${formatRawAmount(balanceRaw, 6)} USDC but opening ${formatRawAmount(marginRaw, 6)} USDC at 5x ` +
                `requires ${formatRawAmount(requiredUsdcRaw, 6)} USDC (margin + self-bonded borrow leg).`);
        }
        // 2. Allowance for the router.
        const allowanceRaw = await walletProvider.readContract({
            address: pair.quote,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [trader, deployment.router],
        });
        let escrowDepositHash;
        if (allowanceRaw < requiredUsdcRaw) {
            const approveData = buildApproveCalldata(pair.quote, deployment.router, MAX_UINT256);
            const approveHash = await walletProvider.sendTransaction({ to: pair.quote, data: approveData });
            await walletProvider.waitForTransactionReceipt(approveHash);
        }
        // 3. Self-bond the borrow leg (protocol requirement for leverage > 1:
        //    the solver must be whitelisted OR fully capitalised in erc20BorrowEscrow).
        const escrowedRaw = await walletProvider.readContract({
            address: deployment.router,
            abi: ESWAP_ROUTER_ABI,
            functionName: "erc20BorrowEscrow",
            args: [trader, pair.quote],
        });
        if (escrowedRaw < borrowed) {
            const depositRaw = borrowed - escrowedRaw;
            const depositData = buildDepositBorrowEscrowCalldata(pair.quote, depositRaw);
            escrowDepositHash = await walletProvider.sendTransaction({ to: deployment.router, data: depositData });
            await walletProvider.waitForTransactionReceipt(escrowDepositHash);
        }
        // 4. Quote-derived slippage floor.
        const hookKey = hookPoolKey(pair, deployment.hook);
        const quoteOutRaw = await walletProvider.readContract({
            address: deployment.router,
            abi: ESWAP_ROUTER_ABI,
            functionName: "quoteExactInput",
            args: [
                { currency0: hookKey[0], currency1: hookKey[1], fee: hookKey[2], tickSpacing: hookKey[3], hooks: hookKey[4] },
                pair.longZeroForOne,
                -(marginRaw),
                DEFAULT_LEVERAGE,
            ],
        });
        if (quoteOutRaw <= 0n) {
            throw new EswapProviderError("QUOTE_EMPTY", "Router returned a non-positive quote — refusing to open.");
        }
        const slippageBps = args.slippageToleranceBps ?? DEFAULT_SLIPPAGE_TOLERANCE_BPS;
        const minAmountOutRaw = minAmountOutOf(quoteOutRaw, slippageBps);
        // 5. Open the position — one atomic transaction; leverage is flash-expanded
        //    inside the hook's beforeSwap via EIP-1153 transient storage.
        const deadline = Math.floor(Date.now() / 1000) + DEFAULT_TX_DEADLINE_SECONDS;
        const openData = buildOpenMarginCalldata(deployment, {
            pair,
            leverage: DEFAULT_LEVERAGE,
            marginRaw,
            slippageToleranceBps: slippageBps,
            trader: trader,
        }, deadline, minAmountOutRaw, defaultStandardPoolKey(pair));
        const openHash = await walletProvider.sendTransaction({ to: deployment.router, data: openData });
        await walletProvider.waitForTransactionReceipt(openHash);
        const feeRaw = protocolFeeRaw(notional);
        const carrySavedRaw = carryDragBenchmarkRaw(borrowed);
        return [
            `**Eswap 5x spot margin order sent on Base**`,
            `pair: ${args.pair}`,
            `collateral: ${formatRawAmount(marginRaw, pair.quoteDecimals)} USDC  •  notional: ${formatRawAmount(notional, pair.quoteDecimals)} USDC (5x)`,
            `borrow leg: ${formatRawAmount(borrowed, pair.quoteDecimals)} USDC (0.00% daily carry — no funding rate)`,
            `minAmountOut: ${formatRawAmount(minAmountOutRaw, pair.baseDecimals)} ${pair.baseSymbol} (slippage ${slippageBps}bps)`,
            `protocol fee: ${formatRawAmount(feeRaw, pair.quoteDecimals)} USDC (0.10% flat)`,
            `carry saved vs 12% APR benchmark over 7 days: ≈ ${formatRawAmount(carrySavedRaw, pair.quoteDecimals)} USDC (illustrative comparison)`,
            escrowDepositHash ? `escrow deposit tx: ${txExplorerUrl(escrowDepositHash)}` : `escrow already covered`,
            `open tx: ${txExplorerUrl(openHash)}`,
            `Position is tracked per (pool, ${trader}) by the hook — wrap up with the close tooling or dashboard when done.`,
        ].join("\n");
    }
}
__decorate([
    CreateAction({
        name: "get_eswap_margin_quote",
        description: "Eswap 5x spot margin quote (Base mainnet). Reads the live on-chain quote for a leveraged buy of the base asset " +
            "funded by USDC collateral (5x spot margin), reports the expected fill from the router's own quote function, the " +
            "flat 0.10% protocol fee, and the estimated borrow-carry savings vs. a 12% APR continuous-borrow benchmark " +
            "(Eswap charges 0.00% daily interest — no funding rate). Also runs the hook's open-fit size gates for the wallet. " +
            "Supported pairs: WETH/USDC, WBTC/USDC. Read-only; sends nothing.",
        schema: GetEswapQuoteSchema,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], EswapActionProvider.prototype, "getEswapMarginQuote", null);
__decorate([
    CreateAction({
        name: "open_spot_margin",
        description: "Open a 5x spot-margin LONG on Eswap (Base mainnet) with 0.00% daily borrow interest. " +
            "Performs up to three transactions where only the last one opens the position: (1) approve USDC for the Eswap " +
            "router if allowance is insufficient, (2) bond the borrow leg into the caller's own erc20BorrowEscrow (margin + " +
            "borrow both come from your wallet; the escrowed borrow remains refundable via withdrawBorrowEscrow if unused), " +
            "(3) execute router.swapMultiPool atomically with a quote-derived minAmountOut slippage guard and 15-minute " +
            "deadline. Returns the BaseScan transaction hash. Supported pairs: WETH/USDC, WBTC/USDC (WBTC opens require a " +
            "configured standard pool). Notional = collateral × 5; the flat 0.10% protocol fee is the only cost besides " +
            "swap spread.",
        schema: OpenSpotMarginSchema,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], EswapActionProvider.prototype, "openSpotMargin", null);
/** Factory export required by AgentKit conventions. */
export const eswapActionProvider = () => new EswapActionProvider();
