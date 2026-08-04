import { render, screen, act } from "@testing-library/react"
import { ProtocolBalances } from "../ProtocolBalances"

jest.mock("../../hooks/useDeFi", () => ({
    useDeFi: jest.fn(),
}))

jest.mock("../../utils/format", () => ({
    formatTokenAmount: (v) => v ?? "...",
}))

jest.mock("ethers", () => ({
    ethers: {
        JsonRpcProvider: jest.fn(),
        Contract: jest.fn(),
        formatUnits: jest.fn((v, d) => (Number(v) / 10 ** Number(d)).toString()),
        ZeroAddress: "0x0000000000000000000000000000000000000000",
    },
    JsonRpcProvider: jest.fn(),
    Contract: jest.fn(),
    formatUnits: jest.fn((v, d) => (Number(v) / 10 ** Number(d)).toString()),
}))

const { useDeFi } = require("../../hooks/useDeFi")

describe("ProtocolBalances", () => {
    const mockOnSelect = jest.fn()

    beforeEach(() => {
        useDeFi.mockReturnValue({
            ADDRESSES: { WETH: "0xWETH", USDC: "0xUSDC", V4_HOOK: "0xHook" },
            SUPPORTED_TOKENS_LIST: [
                { key: "WETH", name: "WETH" },
                { key: "USDC", name: "USDC" },
            ],
            getProtocolBalances: jest.fn().mockResolvedValue({}),
        })
    })

    it("renders protocol health section", async () => {
        await act(async () => render(<ProtocolBalances onSelectToken={mockOnSelect} selectedToken="USDC" />))
        expect(screen.getByText("Protocol Health")).toBeInTheDocument()
        expect(screen.getByText("WETH")).toBeInTheDocument()
        expect(screen.getByText("USDC")).toBeInTheDocument()
    })

    it("shows SELECTED badge for the active token", async () => {
        await act(async () => render(<ProtocolBalances onSelectToken={mockOnSelect} selectedToken="USDC" />))
        expect(screen.getByText("SELECTED")).toBeInTheDocument()
    })

    it("calls onSelectToken when clicking a token", async () => {
        await act(async () => render(<ProtocolBalances onSelectToken={mockOnSelect} selectedToken="WETH" />))
        screen.getByText("USDC").click()
        expect(mockOnSelect).toHaveBeenCalledWith("USDC")
    })
})
