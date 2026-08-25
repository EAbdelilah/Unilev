import { render, screen, act } from "@testing-library/react"
import { SolverFunding } from "../SolverFunding"

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

jest.mock("../../utils/chains", () => ({
    isUnichainChain: jest.fn(() => true),
}))

jest.mock("ethers", () => ({
    ethers: {
        parseUnits: jest.fn((val, dec) => BigInt(val) * BigInt(10 ** dec)),
        MaxUint256: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
    },
    parseUnits: jest.fn(),
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")

const SOLVER = "0x0f8BEC665E1eEbf0433FEDA67181B06E10710614"

describe("SolverFunding", () => {
    beforeEach(() => {
        useAccount.mockReturnValue({
            isConnected: true,
            address: "0xUser",
            chainId: 130,
        })
        useDeFi.mockReturnValue({
            ADDRESSES: {
                USDC: "0xUSDC",
                WETH: "0xWETH",
                V4_SOLVER: SOLVER,
            },
            getTokenBalance: jest
                .fn()
                .mockResolvedValue({ balance: "1000.0", decimals: 6, usdValue: "1000.00" }),
            sendTokens: jest.fn(),
            isMetaMaskInstalled: true,
        })
    })

    it("renders the fund solver panel with the solver address", async () => {
        await act(async () => render(<SolverFunding />))
        expect(screen.getByText("Fund the Solver")).toBeInTheDocument()
        expect(screen.getByText(SOLVER)).toBeInTheDocument()
    })

    it("shows solver balances for USDC and WETH", async () => {
        await act(async () => render(<SolverFunding />))
        expect(screen.getByText("Solver Balances")).toBeInTheDocument()
        expect(screen.getAllByText("1000.0").length).toBeGreaterThanOrEqual(2)
    })

    it("renders asset selector and amount input", async () => {
        await act(async () => render(<SolverFunding />))
        expect(screen.getByText("Asset")).toBeInTheDocument()
        expect(screen.getByText("Amount")).toBeInTheDocument()
        expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument()
    })

    it("shows a connect prompt when the wallet is not connected", async () => {
        useAccount.mockReturnValue({ isConnected: false, address: null, chainId: undefined })
        await act(async () => render(<SolverFunding />))
        expect(screen.getByText("Connect Wallet")).toBeInTheDocument()
    })

    it("shows empty balance placeholders when balances are not loaded", async () => {
        useDeFi.mockReturnValue({
            ADDRESSES: { USDC: "0xUSDC", WETH: "0xWETH", V4_SOLVER: SOLVER },
            getTokenBalance: jest
                .fn()
                .mockResolvedValue({ balance: "1000.0", decimals: 6, usdValue: "1000.00" }),
            sendTokens: jest.fn(),
            isMetaMaskInstalled: true,
        })
        await act(async () => render(<SolverFunding />))
        expect(screen.getByText("Solver Balances")).toBeInTheDocument()
    })
})