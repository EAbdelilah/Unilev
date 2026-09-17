/**
 * ERC-7683 Cross-Chain Relayer Gateway
 * ====================================
 * Monitors `CrossChainOrder` origin events on Ethereum Mainnet, Arbitrum One
 * and Base, decodes `orderData` into `EswapRouter.SwapParams`, and fills the
 * destination order on Unichain (Chain ID 130) via `EswapSettlement.fill()`.
 * The relayer credit-transfers the required notional from ITS OWN balance so
 * the position is funded directly — neither the protocol treasury nor the
 * Eswap hook/router holds the borrow leg (zero-treasury bridged fills).
 *
 * Usage:
 *   ORIGIN_RPC_1=... ORIGIN_RPC_42161=... ORIGIN_RPC_8453=... \
 *   ORIGIN_SETTLER_1=0x... RELAYER_PRIVATE_KEY=0x... npm run relayer
 *
 * Flags:
 *   --once   scan the checkpointed ranges and exit instead of polling.
 * Env:
 *   ORIGIN_RPC_<chainId>      (required per monitored origin chain)
 *   ORIGIN_SETTLER_<chainId>  (optional; filters events by origin settler)
 *   RELAYER_PRIVATE_KEY       (required)
 *   RELAYER_STATE_FILE        (optional JSON checkpoint path, default ./relayer.state.json)
 *   UNICHAIN_RPC_URL, V4_*    (destination config, see lib/config.ts)
 */
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
    createPublicClient,
    createWalletClient,
    decodeAbiParameters,
    defineChain,
    encodePacked,
    http,
    keccak256,
    parseAbiParameters,
    type Address,
    type Account,
    type Chain,
    type HttpTransport,
    type PublicClient,
    type WalletClient,
} from "viem";
import { createClients, loadNetworkConfig, chainRpcUrl, ETH_MAINNET, ARBITRUM_ONE, BASE } from "../lib/config.js";
import { crossChainOrderEvent, erc20Abi, settlementAbi } from "../lib/abis.js";
import {
    type CrossChainOrderEvent,
    type SwapParamsData,
} from "../lib/types.js";

const ORIGIN_CHAINS: Array<{ chainId: number; name: string }> = [
    { chainId: ETH_MAINNET, name: "Ethereum Mainnet" },
    { chainId: ARBITRUM_ONE, name: "Arbitrum One" },
    { chainId: BASE, name: "Base" },
];

interface OriginChain {
    chainId: number;
    name: string;
    client: PublicClient;
    originSettler?: Address;
    lastBlock: bigint;
}

interface RelayerState {
    checkpoints: Record<number, string>;
}

export class Erc7683Relayer {
    private readonly cfg = loadNetworkConfig();
    private readonly destClients: {
        publicClient: PublicClient<HttpTransport, Chain, Account>;
        walletClient: WalletClient<HttpTransport, Chain, Account>;
        account: Account;
    };
    private readonly origins: OriginChain[];
    private readonly stateFile: string;
    private readonly processed = new Set<string>();
    private state: RelayerState;

    constructor() {
        const privateKey = process.env.RELAYER_PRIVATE_KEY;
        if (!privateKey) throw new Error("Missing RELAYER_PRIVATE_KEY");
        const dw = createClients(this.cfg, privateKey);
        this.destClients = { publicClient: dw.publicClient, walletClient: dw.walletClient, account: dw.account };

        this.origins = ORIGIN_CHAINS.map(({ chainId, name }) => {
            const rpcUrl = chainRpcUrl(`ORIGIN_RPC_${chainId}`, chainId);
            const chain = defineChain({
                id: chainId,
                name,
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: { default: { http: [rpcUrl] } },
            });
            const settler = process.env[`ORIGIN_SETTLER_${chainId}`] as Address | undefined;
            return {
                chainId,
                name,
                client: createPublicClient({ chain, transport: http(rpcUrl) }),
                originSettler: settler !== undefined ? settler : undefined,
                lastBlock: 0n,
            };
        });

        this.stateFile = process.env.RELAYER_STATE_FILE ?? "./relayer.state.json";
        this.state = this.loadState();
    }

    // ─── ERC-7683 helpers ────────────────────────────────────────────────

    /** `OriginSettler.evmComputeOrderId` — the canonical ERC-7683 order identifier:
     * keccak256("OrderId" || uint256(originChainId) || originSettler || keccak256(originData)). */
    computeOrderId(chainId: number, originSettler: Address, originData: `0x${string}`): `0x${string}` {
        return keccak256(
            encodePacked(
                ["bytes", "uint256", "address", "bytes32"],
                ["0x4f726465724964", BigInt(chainId), originSettler, keccak256(originData)] as const,
            ),
        );
    }

    /** Decodes `originData` into the router's SwapParams tuple. */
    decodeOriginData(originData: `0x${string}`): SwapParamsData {
        const params = parseAbiParameters(
            "((address,address,uint24,int24,address) key,(address,address,uint24,int24,address) standardPoolKey,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData,uint256 minAmountOut)",
        );
        const [swap] = decodeAbiParameters(params, originData);
        return {
            key: swap.key,
            standardPoolKey: swap.standardPoolKey,
            zeroForOne: swap.zeroForOne,
            amountSpecified: swap.amountSpecified,
            leverage: Number(swap.leverage),
            solver: swap.solver,
            hookData: swap.hookData,
            minAmountOut: swap.minAmountOut,
        };
    }

    // ─── Destination funding + fill ──────────────────────────────────────

    private async ensureApproval(token: Address, notional: bigint): Promise<void> {
        const allowance = (await this.destClients.publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [this.destClients.account.address, this.cfg.settlement],
        })) as bigint;
        if (allowance >= notional) return;
        const approve = await this.destClients.walletClient.writeContract({
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [this.cfg.settlement, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
            account: this.destClients.account,
            chain: this.destClients.walletClient.chain,
        });
        await this.destClients.publicClient.waitForTransactionReceipt({ hash: approve });
    }

    private async fillOrder(chainId: number, originSettler: Address, originData: `0x${string}`): Promise<void> {
        const orderId = this.computeOrderId(chainId, originSettler, originData);
        if (this.processed.has(orderId)) return;
        this.processed.add(orderId);

        const already = (await this.destClients.publicClient.readContract({
            address: this.cfg.settlement,
            abi: settlementAbi,
            functionName: "filledOrders",
            args: [orderId],
        })) as boolean;
        if (already) return;

        const swap = this.decodeOriginData(originData);
        const margin = swap.amountSpecified < 0n ? -swap.amountSpecified : swap.amountSpecified;
        const notional = margin * BigInt(swap.leverage);
        const inputToken = swap.zeroForOne ? swap.key.currency0 : swap.key.currency1;
        await this.ensureApproval(inputToken, notional);

        console.log(
            `[relayer] fill orderId=${orderId} in=${inputToken} notional=${notional} ` +
                `lev=${swap.leverage} recipient(trader from hookData)`,
        );
        const hash = await this.destClients.walletClient.writeContract({
            address: this.cfg.settlement,
            abi: settlementAbi,
            functionName: "fill",
            args: [orderId, originData, "0x"],
            account: this.destClients.account,
            chain: this.destClients.walletClient.chain,
        });
        const receipt = await this.destClients.publicClient.waitForTransactionReceipt({ hash });
        console.log(`[relayer] filled ${orderId} status=${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed}`);
    }

    // ─── Origin scanning ─────────────────────────────────────────────────

    private async scanOrigin(o: OriginChain, fromBlock: bigint, toBlock: bigint): Promise<void> {
        if (fromBlock > toBlock) return;
        const logs = await o.client.getLogs({
            address: o.originSettler,
            event: crossChainOrderEvent,
            fromBlock,
            toBlock,
        });
        for (const log of logs) {
            const args = log.args as CrossChainOrderEvent;
            if (args.destChainId !== this.cfg.chain.id) {
                console.log(`[relayer] skip non-Unichain order dest=${args.destChainId} tx=${log.transactionHash}`);
                continue;
            }
            if (args.error !== 0n) {
                console.log(`[relayer] skip errored order (error=${args.error})`);
                continue;
            }
            const expiry = args.expiry;
            if (expiry !== 0n && expiry < BigInt(Math.floor(Date.now() / 1000))) {
                console.log(`[relayer] skip expired order expiry=${expiry}`);
                continue;
            }
            try {
                await this.fillOrder(o.chainId, args.originSettler, args.originData);
            } catch (err) {
                console.error(`[relayer] fill failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    private async poll(): Promise<void> {
        for (const o of this.origins) {
            const latest = await o.client.getBlockNumber();
            const from = o.lastBlock === 0n ? latest - 5n : o.lastBlock + 1n; // warm-up window on first scan
            if (from <= latest) {
                await this.scanOrigin(o, from, latest);
            }
            o.lastBlock = latest;
            this.persist();
        }
    }

    // ─── State persistence ───────────────────────────────────────────────

    private loadState(): RelayerState {
        try {
            return JSON.parse(readFileSync(this.stateFile, "utf8")) as RelayerState;
        } catch {
            return { checkpoints: {} };
        }
    }

    private persist(): void {
        this.state.checkpoints = Object.fromEntries(
            this.origins.map((o) => [String(o.chainId), o.lastBlock.toString()]),
        );
        const target = resolve(process.cwd(), this.stateFile);
        try {
            mkdirSync(dirname(target), { recursive: true });
        } catch {
            /* cwd or already-existing directory */
        }
        writeFileSync(target, JSON.stringify(this.state, null, 2));
    }

    // ─── Entry ───────────────────────────────────────────────────────────

    async run(): Promise<void> {
        console.log(
            `[relayer] relayer=${this.destClients.account.address} dest=unichain(${this.cfg.chain.id}) ` +
                `settlement=${this.cfg.settlement} state=${this.stateFile}`,
        );
        if (process.argv.includes("--once")) {
            await this.poll();
            console.log("[relayer] --once scan complete");
            return;
        }
        await this.poll();
        for (;;) {
            await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, Number(process.env.POLL_INTERVAL_MS ?? "8000")));
            await this.poll();
        }
    }
}

async function main(): Promise<void> {
    const relayer = new Erc7683Relayer();
    await relayer.run();
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
    main().catch((err: unknown) => {
        console.error(`[relayer] fatal: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}