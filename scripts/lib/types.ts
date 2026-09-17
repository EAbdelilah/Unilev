import type { Address, Hex } from "viem";

/**
 * Mirrors `src/v4/types/PoolKey.sol`:
 *   struct PoolKey { Currency currency0; Currency currency1; uint24 fee; int24 tickSpacing; address hooks; }
 * `Currency` is a user-defined value type over `address` (flattens to `address` in the ABI).
 */
export interface PoolKey {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}

/**
 * Mirrors `CowOrder.Data` (src/v4/cow/CowOrder.sol) — byte-exact CoW Protocol v2 order.
 */
export interface CowOrderData {
    sellToken: Address;
    buyToken: Address;
    receiver: Address;
    sellAmount: bigint;
    buyAmount: bigint;
    validTo: number;
    appData: Hex;
    feeAmount: bigint;
    kind: Hex;
    partiallyFillable: boolean;
    sellTokenBalance: Hex;
    buyTokenBalance: Hex;
}

/**
 * Mirrors `EswapCoWSettlement.FillParams`.
 */
export interface FillParams {
    leverage: number;
    solver: Address;
    key: PoolKey;
    standardPoolKey: PoolKey;
}

/**
 * CoW Protocol order kind / token-balance markers (keccak256 strings, see CowOrder.sol).
 */
export const KIND_SELL = "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775" as const;
export const KIND_BUY = "0x6ed88e868af0a1983e3886d5f3e95a2fafbd6c3450bc229e27342283dc429ccc" as const;
export const BALANCE_ERC20 = "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9" as const;
export const RECEIVER_SAME_AS_OWNER = "0x0000000000000000000000000000000000000000" as const;

/** CoW signature scheme index, matching `CowSigning.Scheme` (Eip712=0, EthSign=1, Eip1271=2, PreSign=3). */
export const CowScheme = {
    Eip712: 0,
    EthSign: 1,
    Eip1271: 2,
    PreSign: 3,
} as const;
export type CowScheme = (typeof CowScheme)[keyof typeof CowScheme];

/** CoW API `signingScheme` strings mapped onto CowScheme. */
export const SIGNING_SCHEME_TO_ENUM: Record<string, CowScheme> = {
    eip712: CowScheme.Eip712,
    ethsign: CowScheme.EthSign,
    eip1271: CowScheme.Eip1271,
    presign: CowScheme.PreSign,
};

/**
 * Incoming leveraged trade requested by a DEX aggregator (Enso/Odos/1inch) on the
 * EswapLeverageAdapter — the bridge formats this as an EIP-1271 CoW order.
 */
export interface LeverageIntent {
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
    leverage: number;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    /** Owner of the EIP-1271 order (smart-contract wallet whose isValidSignature endorses the order). */
    owner: Address;
    /** ERC-1271 signature bytes from `owner` (pre-verified by the wallet), `0x` under PreSign. */
    signature: Hex;
    signingScheme: "eip712" | "ethsign" | "eip1271" | "presign";
    /** Seconds until the order becomes stale. */
    validToOffsetSec?: number;
    appData?: Hex;
}

/**
 * Full on-chain swap parameters, decoded from an ERC-7683 `orderData` payload
 * (the exact tuple `EswapSettlement.fill` decodes: key, standardPoolKey,
 * zeroForOne, amountSpecified, leverage, solver, hookData, minAmountOut).
 */
export interface SwapParamsData {
    key: PoolKey;
    standardPoolKey: PoolKey;
    zeroForOne: boolean;
    amountSpecified: bigint;
    leverage: number;
    solver: Address;
    hookData: Hex;
    minAmountOut: bigint;
}

/** ERC-7683 `CrossChainOrder` origin event payload. */
export interface CrossChainOrderEvent {
    error: bigint;
    from: `0x${string}`;
    to: `0x${string}`;
    originSettler: Address;
    originData: Hex;
    originChainId: number;
    destChainId: number;
    expiry: bigint;
    nonce: bigint;
}

export const UNICHAIN_CHAIN_ID = 130;

/** Provided Unichain network constants (per task spec). */
export const UNICHAIN_PM = "0x1F98400000000000000000000000000000000004" as Address;
export const UNICHAIN_WETH = "0x4200000000000000000000000000000000000006" as Address;
export const UNICHAIN_USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6" as Address;
export const UNICHAIN_ETH_USD_FEED = "0xBcE70e194940a157f3A80566505a7E96f5238CCa" as Address;
export const UNICHAIN_USDC_USD_FEED = "0xbd1cD1518eFB92a92100da62D4C488c810dFd75b" as Address;
export const COW_GPv2_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as Address;