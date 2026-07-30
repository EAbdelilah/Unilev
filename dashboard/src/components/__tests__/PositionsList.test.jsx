import { render, screen, act } from "@testing-library/react"
import { PositionsList } from "../PositionsList"

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
}))

jest.mock("../../hooks/useDeFi", () => ({
    useDeFi: jest.fn(),
}))

jest.mock("../../contexts/AdminContext", () => ({
    useAdmin: jest.fn(),
}))

jest.mock("../../utils/formatContractError", () => ({
    formatContractError: jest.fn((e) => e.message),
    isUserCancellation: jest.fn(() => false),
}))

jest.mock("../../utils/format", () => ({
    formatTokenAmount: (v) => v ?? "...",
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")
const { useAdmin } = require("../../contexts/AdminContext")

describe("PositionsList", () => {
    const mockClosePos = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        useAccount.mockReturnValue({ isConnected: true, address: "0xUser" })
        useAdmin.mockReturnValue({ isAdmin: false })
    })

    it("renders title and tab buttons", async () => {
        useDeFi.mockReturnValue({
            getPositionsCount: jest.fn().mockResolvedValue(BigInt(0)),
            getPositionDetails: jest.fn().mockResolvedValue(null),
            closePosition: mockClosePos,
        })
        await act(async () => render(<PositionsList />))
        expect(screen.getByText("Positions")).toBeInTheDocument()
        expect(screen.getByText("My Positions")).toBeInTheDocument()
    })

    it("shows empty state when no positions", async () => {
        useDeFi.mockReturnValue({
            getPositionsCount: jest.fn().mockResolvedValue(BigInt(0)),
            getPositionDetails: jest.fn().mockResolvedValue(null),
            closePosition: mockClosePos,
        })
        await act(async () => render(<PositionsList />))
        expect(await screen.findByText("No active positions found.")).toBeInTheDocument()
    })

    it("shows position card when a position exists", async () => {
        useDeFi.mockReturnValue({
            getPositionsCount: jest.fn().mockResolvedValue(BigInt(2)),
            getPositionDetails: jest.fn().mockImplementation((id, userAddr) => {
                if (userAddr === "0xUser") {
                    return Promise.resolve({
                        id: "V4-User",
                        owner: "0xUser",
                        collateral: BigInt(1e18),
                        borrowed: BigInt(500e6),
                        leverage: "2",
                        isShort: false,
                        state: "ACTIVE",
                        size: "1.0",
                        baseSymbol: "WETH",
                        quoteSymbol: "USDC",
                        entryPrice: "3000",
                        currentPrice: "3100",
                        pnl: "0.05",
                        pnlUsd: "150.00",
                        pnlIsPositive: true,
                    })
                }
                return Promise.resolve(null)
            }),
            closePosition: mockClosePos,
        })
        await act(async () => render(<PositionsList />))
        expect(await screen.findByText("ACTIVE")).toBeInTheDocument()
        expect(screen.getByText(/LONG 2x/)).toBeInTheDocument()
    })
})
