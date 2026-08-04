import { render, screen, act } from "@testing-library/react"
import { LiquidityPoolManager } from "../LiquidityPoolManager"

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
    useWalletClient: jest.fn(() => ({ data: null })),
}))

jest.mock("../../hooks/useDeFi", () => ({
    useDeFi: jest.fn(),
}))

jest.mock("../../utils/formatContractError", () => ({
    formatContractError: jest.fn((e) => e.message),
    isUserCancellation: jest.fn(() => false),
}))

jest.mock("../../utils/format", () => ({
    formatTokenAmount: (v) => v ?? "...",
}))

jest.mock("ethers", () => ({
    ethers: {
        JsonRpcProvider: jest.fn(),
        Contract: jest.fn(),
        parseUnits: jest.fn((val, dec) => BigInt(val) * BigInt(10 ** dec)),
        formatUnits: jest.fn((val, dec) => (Number(val) / 10 ** Number(dec)).toString()),
        MaxUint256: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
    },
    JsonRpcProvider: jest.fn(),
    Contract: jest.fn(),
    parseUnits: jest.fn(),
    formatUnits: jest.fn(),
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")

describe("LiquidityPoolManager", () => {
    beforeEach(() => {
        useAccount.mockReturnValue({ isConnected: true, address: "0xUser" })
        useDeFi.mockReturnValue({
            ADDRESSES: { USDC: "0xUSDC", V4_HOOK: "0xHook" },
            getTokenBalance: jest.fn().mockResolvedValue({ balance: "1000.0", decimals: 6 }),
            getProtocolBalances: jest.fn().mockResolvedValue({ poolBalances: { USDC: { userAssets: "500.0", userShares: "50.0" } } }),
            depositToPool: jest.fn(),
            redeemFromPool: jest.fn(),
            isMetaMaskInstalled: true,
        })
    })

    it("renders liquidity manager UI when disconnected", () => {
        useAccount.mockReturnValue({ isConnected: false, address: null })
        render(<LiquidityPoolManager />)
        expect(screen.getByText("Liquidity Manager")).toBeInTheDocument()
    })

    it("renders liquidity manager UI when connected", async () => {
        await act(async () => render(<LiquidityPoolManager />))
        expect(screen.getByText("Liquidity Manager")).toBeInTheDocument()
        expect(screen.getByText("USDC Pool")).toBeInTheDocument()
        expect(screen.getByText("Deposit")).toBeInTheDocument()
        expect(screen.getByText("Redeem")).toBeInTheDocument()
    })

    it("renders amount input", async () => {
        await act(async () => render(<LiquidityPoolManager />))
        expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument()
    })
})
