import { formatUnits } from "viem";
import { base } from "viem/chains";
import { ERC20_ABI, ESWAP_ROUTER_ABI } from "./../abis.js";
import { DEFAULT_LEVERAGE, DEFAULT_SLIPPAGE_TOLERANCE_BPS, DEFAULT_TX_DEADLINE_SECONDS, ESWAP_PAIRS, } from "./../constants.js";
import { OpenMarginActionSchema } from "./../schemas.js";
import { buildApproveCalldata, buildDepositBorrowEscrowCalldata, buildOpenMarginCalldata, carryDragBenchmarkRaw, formatRawAmount, marginParts, minAmountOutOf, parseRawAmount, protocolFeeRaw, } from "./../utils.js";
import { createWalletFromRuntime, readRuntimeSettings } from "./../wallet.js";
const MAX_UINT256 = 2n ** 256n - 1n;
export const openMarginAction = {
    name: "EXECUTE_ESWAP_MARGIN",
    similes: ["OPEN_SPOT_LEVERAGE", "ZERO_CARRY_MARGIN", "ESWAP_5X_LONG"],
    description: "Executes a 5x spot margin trade on Base Mainnet with 0.00% daily borrow interest using Eswap's Uniswap v4 hook. " +
        "Collateral is USDC; notional = collateral × 5; the flat 0.10% protocol fee is the only cost besides swap spread. " +
        "Requires an EVM wallet configured on the agent runtime (EVM_PRIVATE_KEY).",
    validate: async (runtime) => {
        try {
            const raw = runtime.getSetting("EVM_PRIVATE_KEY");
            if (typeof raw !== "string" || raw.trim().length < 66) {
                return false;
            }
            // Funded-wallet check: at least some USDC present on the trading EOA.
            const wallet = createWalletFromRuntime(runtime);
            const settings = readRuntimeSettings(runtime);
            const balance = await wallet.publicClient.readContract({
                address: ESWAP_PAIRS["WETH/USDC"].quote,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [wallet.address],
            });
            return balance > 0n;
        }
        catch {
            return false;
        }
    },
    handler: async (runtime, message, state, options, callback) => {
        const parsed = OpenMarginActionSchema.safeParse(options ?? {});
        if (!parsed.success) {
            const text = `Eswap open failed: invalid arguments — ${parsed.error.message}`;
            await callback?.({ text });
            return { success: false, error: parsed.error.message };
        }
        const args = parsed.data;
        const settings = readRuntimeSettings(runtime);
        const wallet = createWalletFromRuntime(runtime);
        const pair = ESWAP_PAIRS[args.pair];
        // WBTC pair guard (verified live 2026-11-03: no standard fill venue configured).
        if (args.pair === "WBTC/USDC" && !pair.fillVenueConfiguredInOut) {
            const text = "Eswap open failed: WBTC/USDC has no configured standard fill venue on the live deployment; use WETH/USDC.";
            await callback?.({ text });
            return { success: false, error: text };
        }
        let marginRaw;
        let borrowed;
        let notional;
        try {
            marginRaw = parseRawAmount(args.collateralAmount, pair.quoteDecimals);
            const parts = marginParts(marginRaw, DEFAULT_LEVERAGE);
            notional = parts.notional;
            borrowed = parts.borrowed;
        }
        catch (cause) {
            const text = `Eswap open failed: ${cause instanceof Error ? cause.message : String(cause)}`;
            await callback?.({ text });
            return { success: false, error: text };
        }
        const requiredUsdcRaw = notional; // margin + borrow, both funded/escrowed by this wallet
        try {
            // 1. Balance check.
            const balanceRaw = await wallet.publicClient.readContract({
                address: pair.quote,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [wallet.address],
            });
            if (balanceRaw < requiredUsdcRaw) {
                const text = `Eswap open failed: wallet has ${formatRawAmount(balanceRaw, pair.quoteDecimals)} USDC but needs ` +
                    `${formatRawAmount(requiredUsdcRaw, pair.quoteDecimals)} USDC (margin ${formatRawAmount(marginRaw, pair.quoteDecimals)} + ` +
                    `self-bonded borrow ${formatRawAmount(borrowed, pair.quoteDecimals)}).`;
                await callback?.({ text });
                return { success: false, error: text };
            }
            // 2. Allowance for the router.
            const allowanceRaw = await wallet.publicClient.readContract({
                address: pair.quote,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [wallet.address, settings.deployment.router],
            });
            if (allowanceRaw < requiredUsdcRaw) {
                const approveData = buildApproveCalldata(pair.quote, settings.deployment.router, MAX_UINT256);
                const approveHash = await wallet.walletClient.sendTransaction({
                    to: pair.quote,
                    data: approveData,
                    account: wallet.account,
                    chain: base,
                });
                await wallet.publicClient.waitForTransactionReceipt({ hash: approveHash });
            }
            // 3. Self-bond the borrow leg (protocol requirement for leverage > 1).
            const escrowedRaw = await wallet.publicClient.readContract({
                address: settings.deployment.router,
                abi: ESWAP_ROUTER_ABI,
                functionName: "erc20BorrowEscrow",
                args: [wallet.address, pair.quote],
            });
            let escrowDepositHash;
            if (escrowedRaw < borrowed) {
                const depositData = buildDepositBorrowEscrowCalldata(pair.quote, borrowed - escrowedRaw);
                escrowDepositHash = await wallet.walletClient.sendTransaction({
                    to: settings.deployment.router,
                    data: depositData,
                    account: wallet.account,
                    chain: base,
                });
                await wallet.publicClient.waitForTransactionReceipt({ hash: escrowDepositHash });
            }
            // 4. Quote-derived slippage floor.
            const hookKeyArgs = {
                currency0: pair.base,
                currency1: pair.quote,
                fee: pair.hookPoolFee,
                tickSpacing: pair.hookPoolTickSpacing,
                hooks: settings.deployment.hook,
            };
            const quoteOutRaw = await wallet.publicClient.readContract({
                address: settings.deployment.router,
                abi: ESWAP_ROUTER_ABI,
                functionName: "quoteExactInput",
                args: [hookKeyArgs, pair.longZeroForOne, -(marginRaw), DEFAULT_LEVERAGE],
            });
            if (quoteOutRaw <= 0n) {
                throw new Error("Router returned a non-positive quote — refusing to open.");
            }
            const slippageBps = args.slippageToleranceBps ?? DEFAULT_SLIPPAGE_TOLERANCE_BPS;
            const minAmountOutRaw = minAmountOutOf(quoteOutRaw, slippageBps);
            // 5. Open the position — leverage flash-expanded inside the hook.
            const openData = buildOpenMarginCalldata(settings.deployment, {
                pair,
                leverage: DEFAULT_LEVERAGE,
                marginRaw,
                trader: wallet.address,
            }, slippageBps, minAmountOutRaw);
            const openHash = await wallet.walletClient.sendTransaction({
                to: settings.deployment.router,
                data: openData,
                account: wallet.account,
                chain: base,
            });
            await wallet.publicClient.waitForTransactionReceipt({ hash: openHash });
            const feeRaw = protocolFeeRaw(notional);
            const carrySavedRaw = carryDragBenchmarkRaw(borrowed);
            const text = [
                `✅ Eswap 5x spot margin position opened on Base`,
                `pair: ${args.pair}`,
                `collateral: ${formatRawAmount(marginRaw, pair.quoteDecimals)} USDC  •  notional: ${formatRawAmount(notional, pair.quoteDecimals)} USDC (5x)`,
                `borrow leg: ${formatRawAmount(borrowed, pair.quoteDecimals)} USDC (0.00% daily carry — no funding rate)`,
                `minAmountOut: ${formatRawAmount(minAmountOutRaw, pair.baseDecimals)} ${pair.baseSymbol} (slippage ${slippageBps}bps)`,
                `protocol fee: ${formatRawAmount(feeRaw, pair.quoteDecimals)} USDC (0.10% flat)`,
                `carry saved vs 12% APR benchmark over 7 days: ≈ ${formatRawAmount(carrySavedRaw, pair.quoteDecimals)} USDC (illustrative comparison)`,
                escrowDepositHash
                    ? `escrow deposit tx: https://basescan.org/tx/${escrowDepositHash}`
                    : `escrow already covered`,
                `open tx: https://basescan.org/tx/${openHash}`,
            ].join("\n");
            await callback?.({ text, action: "EXECUTE_ESWAP_MARGIN" });
            return {
                success: true,
                text,
                data: { txHash: openHash, escrowDepositHash, pair: args.pair, notional: notional.toString(), borrowed: borrowed.toString() },
                values: {
                    eswapPair: args.pair,
                    eswapNotionalUsdc: formatRawAmount(notional, pair.quoteDecimals),
                    eswapBorrowedUsdc: formatRawAmount(borrowed, pair.quoteDecimals),
                    eswapMinAmountOut: formatRawAmount(minAmountOutRaw, pair.baseDecimals),
                    eswapCarrySaved7dUsdc: formatRawAmount(carrySavedRaw, pair.quoteDecimals),
                },
            };
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            const text = `Eswap 5x spot margin open failed: ${messageText}`;
            await callback?.({ text });
            return { success: false, error: messageText, text };
        }
    },
    examples: [
        [
            {
                name: "user",
                content: { text: "Open a 5x long WETH with 100 USDC collateral on Eswap" },
            },
            {
                name: "assistant",
                content: {
                    text: "Opening a 5x spot margin long WETH/USDC with 100 USDC collateral — no daily borrow carry.",
                    action: "EXECUTE_ESWAP_MARGIN",
                },
            },
        ],
    ],
};
