import { render, screen, act } from "@testing-library/react"
import { Balances } from "../Balances"

const mockBalances = {
    native: { balance: "1.5", usdValue: "4500.00", symbol: "ETH" },
    WETH: { rawBalance: BigInt(2e18), balance: "2.0", decimals: 18 },
    USDC: { rawBalance: BigInt(500e6), balance: "500.0", decimals: 6 },
}

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
}))

jest.mock("../../hooks/useDeFi", () => ({
    useDeFi: jest.fn(),
}))

jest.mock("../../utils/format", () => ({
    formatTokenAmount: (v) => v ?? "...",
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")

describe("Balances", () => {
    beforeEach(() => {
        useAccount.mockReturnValue({ isConnected: true, address: "0xUser" })
        useDeFi.mockReturnValue({
            getTokenBalance: jest.fn().mockResolvedValue(mockBalances.WETH),
            getNativeBalance: jest.fn().mockResolvedValue(mockBalances.native),
            ADDRESSES: { WETH: "0xWETH", USDC: "0xUSDC" },
            SUPPORTED_TOKENS_LIST: [
                { key: "WETH", name: "WETH", address: "0xWETH" },
                { key: "USDC", name: "USDC", address: "0xUSDC" },
            ],
        })
    })

    it("renders nothing when disconnected", () => {
        useAccount.mockReturnValue({ isConnected: false, address: null })
        const { container } = render(<Balances />)
        expect(container.innerHTML).toBe("")
    })

    it("renders token balances when connected", async () => {
        await act(async () => render(<Balances />))
        expect(screen.getByText("Wallet")).toBeInTheDocument()
        expect(screen.getByText("ETH")).toBeInTheDocument()
        expect(screen.getByText("WETH")).toBeInTheDocument()
        expect(screen.getByText("USDC")).toBeInTheDocument()
    })

    it("shows refresh button", async () => {
        await act(async () => render(<Balances />))
        expect(screen.getByText("Refresh")).toBeInTheDocument()
    })
})
