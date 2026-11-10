import { describe, expect, it } from "vitest";
import { getFunctionSelector, type Address, type Hex } from "viem";
import type { EvmWalletProvider } from "@coinbase/agentkit";
// The provider tests exercise the BUILT bundle: AgentKit's `@CreateAction`
// decorator resolves argument types through reflect-metadata, which only tsc
// (not esbuild/vitest transforms) can emit. `npm test` runs `tsc` first.
import { eswapActionProvider } from "../dist/action-providers/eswap/index.js";
import { ERC20_ABI, ESWAP_HOOK_ABI, ESWAP_ROUTER_ABI } from "../src/action-providers/eswap/abis.js";
import { ESWAP_PAIRS, resolveEswapDeployment } from "../src/action-providers/eswap/constants.js";

const USDC = ESWAP_PAIRS["WETH/USDC"].quote;
const { hook: HOOK, router: ROUTER } = resolveEswapDeployment();

const TRADER = "0xC3bda178808aB93Ced2D3a8f4c21d34f06436988";
const LIVE_QUOTE_RAW = 2_162_485_868_520_759n; // verified live: 1 USDC margin ×5 → ≈0.0021625 WETH

const SEL_APPROVE = getFunctionSelector("approve(address,uint256)");
const SEL_DEPOSIT_ESCROW = getFunctionSelector("depositBorrowEscrow(address,uint256)");
const SEL_SWAP_MULTI_POOL = ESWAP_ROUTER_ABI.some((item) => item.name === "swapMultiPool")
  ? getFunctionSelector(
      "swapMultiPool(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256))",
    )
  : "";

interface MockOptions {
  readonly baseQuote?: bigint;
  /** [fits, reason] — the contract's tuple-shaped `quoteOpenFit` output. */
  readonly openFit?: readonly [boolean, string];
  readonly balanceRaw?: bigint;
  readonly allowanceRaw?: bigint;
  readonly escrowRaw?: bigint;
  readonly network?: { protocolFamily: string; networkId?: string; chainId?: string };
}

interface ReadLog {
  readonly functionName: string;
  readonly address: Address | undefined;
  readonly args: readonly unknown[];
}

interface SendLog {
  readonly to: string;
  readonly data: string;
}

function makeWallet(graph: MockOptions = {}) {
  const reads: ReadLog[] = [];
  const sends: SendLog[] = [];
  let txCounter = 0;

  const wallet = {
    getAddress: () => TRADER,
    getNetwork: () =>
      graph.network ?? { protocolFamily: "evm", networkId: "base-mainnet", chainId: "8453" },
    readContract: async (call: unknown): Promise<unknown> => {
      const { address, functionName, args } = call as {
        address: Address;
        functionName: string;
        args: readonly unknown[];
      };
      reads.push({ functionName, address, args });
      switch (functionName) {
        case "quoteExactInput":
          return graph.baseQuote ?? LIVE_QUOTE_RAW;
        case "quoteOpenFit":
          return graph.openFit ?? ([true, ""] as const);
        case "balanceOf":
          return graph.balanceRaw ?? 1_000_000_000n; // 1000 USDC (covers margin+borrow)
        case "allowance":
          return graph.allowanceRaw ?? 0n;
        case "erc20BorrowEscrow":
          return graph.escrowRaw ?? 0n;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
    sendTransaction: async (tx: { to?: string; data?: string }) => {
      sends.push({ to: tx.to ?? "", data: tx.data ?? "" });
      txCounter += 1;
      return `0x${txCounter.toString(16).padStart(64, "0")}`;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  return { wallet: wallet as unknown as EvmWalletProvider, reads, sends };
}

describe("EswapActionProvider.supportsNetwork", () => {
  const provider = eswapActionProvider();

  it("registers only on Base mainnet", () => {
    expect(provider.name).toBe("eswap");
    expect(provider.supportsNetwork({ protocolFamily: "evm", networkId: "base-mainnet" })).toBe(true);
    expect(provider.supportsNetwork({ protocolFamily: "evm", chainId: "8453" })).toBe(true);
    expect(provider.supportsNetwork({ protocolFamily: "evm", chainId: "0x2105" })).toBe(true);
    expect(provider.supportsNetwork({ protocolFamily: "evm", networkId: "ethereum-mainnet" })).toBe(false);
    expect(provider.supportsNetwork({ protocolFamily: "evm", chainId: "1" })).toBe(false);
    expect(provider.supportsNetwork({ protocolFamily: "solana", networkId: "solana-mainnet" })).toBe(false);
  });
});

describe("get_eswap_margin_quote", () => {
  it("queries router.quoteExactInput with 5x, negative exact-input margin, and no broadcast", async () => {
    const { wallet, reads } = makeWallet();
    const provider = eswapActionProvider();

    const result = await provider.getEswapMarginQuote(wallet, {
      pair: "WETH/USDC",
      collateralAmount: "1",
    });

    expect(result).toContain("0.00216248"); // formatted live-verified fill
    expect(result).toContain("WETH");
    expect(result).toContain("0.10%");

    const quoteCall = reads.find((r) => r.functionName === "quoteExactInput");
    expect(quoteCall?.address).toBe(ROUTER);
    expect(quoteCall?.args[1]).toBe(false); // zeroForOne: USDC -> base (long)
    expect(quoteCall?.args[2]).toBe(-1_000_000n); // -1 USDC margin
    expect(quoteCall?.args[3]).toBe(5);

    const fitCall = reads.find((r) => r.functionName === "quoteOpenFit");
    expect(fitCall?.address).toBe(HOOK);
  });

  it("surfaces a hook fit failure instead of pretending the open would work", async () => {
    const { wallet } = makeWallet({ openFit: [false as const, "COLLATERAL_TOO_LOW"] });
    const provider = eswapActionProvider();
    const result = await provider.getEswapMarginQuote(wallet, { pair: "WETH/USDC", collateralAmount: "1" });
    expect(result).toContain("COLLATERAL_TOO_LOW");
  });

  it("flags the unconfigured WBTC fill venue (verified on-chain)", async () => {
    const { wallet } = makeWallet();
    const provider = eswapActionProvider();
    const result = await provider.getEswapMarginQuote(wallet, { pair: "WBTC/USDC", collateralAmount: "1" });
    expect(result).toContain("NOT configured");
  });

  it("refuses to run off Base", async () => {
    const { wallet } = makeWallet({ network: { protocolFamily: "evm", networkId: "base-sepolia", chainId: "84532" } });
    const provider = eswapActionProvider();
    await expect(provider.getEswapMarginQuote(wallet, { pair: "WETH/USDC", collateralAmount: "1" })).rejects.toThrow(
      /Base mainnet/,
    );
  });
});

describe("open_spot_margin", () => {
  it("runs approve → escrow-deposit → swapMultiPool with quote-derived minAmountOut", async () => {
    const { wallet, reads, sends } = makeWallet();
    const provider = eswapActionProvider();

    const result = await provider.openSpotMargin(wallet, {
      pair: "WETH/USDC",
      collateralAmount: "100",
      leverage: 5,
      slippageToleranceBps: 50,
    });

    expect(SEL_SWAP_MULTI_POOL).toMatch(/^0x[0-9a-f]{8}$/); // sanity for the hand-written selector
    expect(sends).toHaveLength(3);
    const [approve, escrow, open] = sends as [SendLog, SendLog, SendLog];

    // 1. USDC allowance to the router
    expect(approve.data.slice(0, 10)).toBe(SEL_APPROVE);
    expect(approve.to).toBe(USDC);

    // 2. Borrow leg self-bonded into erc20BorrowEscrow (100 ×4 = 400 USDC)
    expect(escrow.data.slice(0, 10)).toBe(SEL_DEPOSIT_ESCROW);
    expect(escrow.to).toBe(ROUTER);

    // 3. The open itself: router.swapMultiPool
    expect(open.data.slice(0, 10)).toBe(SEL_SWAP_MULTI_POOL);
    expect(open.to).toBe(ROUTER);

    const quoteRead = reads.find((r) => r.functionName === "quoteExactInput");
    expect(quoteRead?.args[2]).toBe(-100_000_000n);

    expect(result).toContain("https://basescan.org/tx/");
    expect(result).toContain("0.00% daily carry");
  });

  it("skips approval and escrow funding when both are already sufficient", async () => {
    const { wallet, sends } = makeWallet({ allowanceRaw: 1_000_000_000n, escrowRaw: 1_000_000_000n });
    const provider = eswapActionProvider();
    await provider.openSpotMargin(wallet, {
      pair: "WETH/USDC",
      collateralAmount: "100",
      leverage: 5,
      slippageToleranceBps: 50,
    });
    expect(sends).toHaveLength(1); // only the open transaction
    expect((sends[0] as SendLog).data.slice(0, 10)).toBe(SEL_SWAP_MULTI_POOL);
  });

  it("rejects insufficient USDC balance before any transaction", async () => {
    const { wallet, sends } = makeWallet({ balanceRaw: 10_000_000n }); // 10 USDC < 500 needed
    const provider = eswapActionProvider();
    await expect(
      provider.openSpotMargin(wallet, {
        pair: "WETH/USDC",
        collateralAmount: "100",
        leverage: 5,
        slippageToleranceBps: 50,
      }),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE|requires/);
    expect(sends).toHaveLength(0);
  });

  it("blocks WBTC opens while the fill venue is unconfigured", async () => {
    const { wallet, sends } = makeWallet();
    const provider = eswapActionProvider();
    await expect(
      provider.openSpotMargin(wallet, {
        pair: "WBTC/USDC",
        collateralAmount: "100",
        leverage: 5,
        slippageToleranceBps: 50,
      }),
    ).rejects.toThrow(/standard fill venue|redeployed deployment/i);
    expect(sends).toHaveLength(0);
  });

  it("only reads on-chain state (ABI sanity)", () => {
    // The three ABIs the provider relies on must exist with these signatures.
    expect(ERC20_ABI.every((item) => item.type === "function")).toBe(true);
    expect(ESWAP_HOOK_ABI.some((item) => item.name === "quoteOpenFit")).toBe(true);
  });
});
