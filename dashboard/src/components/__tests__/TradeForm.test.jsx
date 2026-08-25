import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TradeForm } from "../TradeForm"

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
}))

jest.mock("../../hooks/useDeFi", () => ({
    useDeFi: jest.fn(),
}))

jest.mock("../../utils/formatContractError", () => ({
    formatContractError: jest.fn((e) => e.message || "Mocked error"),
    isUserCancellation: jest.fn(() => false),
}))

jest.mock("ethers", () => ({
    ethers: {
        parseUnits: jest.fn((val, dec) => BigInt(val) * BigInt(10 ** dec)),
        formatUnits: jest.fn((val, dec) => (Number(val) / 10 ** Number(dec)).toString()),
        MaxUint256: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
    },
    parseUnits: jest.fn(),
    formatUnits: jest.fn(),
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")

describe("TradeForm", () => {
    const mockApprove = jest.fn()
    const mockOpenV4 = jest.fn()
    const mockGetBal = jest.fn()
    const mockGetUsd = jest.fn()
    const mockGetAllow = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        useAccount.mockReturnValue({ isConnected: true, address: "0xUser" })
        mockGetBal.mockResolvedValue({ rawBalance: BigInt(1000e6), balance: "1000.0", decimals: 6 })
        mockGetAllow.mockResolvedValue(BigInt(0))
        mockGetUsd.mockResolvedValue(BigInt(100e18))
        useDeFi.mockReturnValue({
            openV4Position: mockOpenV4,
            simulateV4Position: jest.fn().mockResolvedValue({ success: true }),
            getTokenBalance: mockGetBal,
            getAmountInUsd: mockGetUsd,
            getAllowance: mockGetAllow,
            approveToken: mockApprove,
            isMetaMaskInstalled: true,
            ADDRESSES: { USDC: "0xUSDC", WETH: "0xWETH", V4_ROUTER: "0xRouter" },
            SUPPORTED_TOKENS_LIST: [
                { key: "WETH", name: "WETH", address: "0xWETH" },
                { key: "USDC", name: "USDC", address: "0xUSDC" },
            ],
        })
    })

    it("renders long/short toggle", async () => {
        await act(async () => render(<TradeForm />))
        expect(screen.getByText("LONG")).toBeInTheDocument()
        expect(screen.getByText("SHORT")).toBeInTheDocument()
    })

    it("renders token selectors", async () => {
        await act(async () => render(<TradeForm />))
        expect(screen.getByText("Margin Asset")).toBeInTheDocument()
        expect(screen.getByText("Trading Asset")).toBeInTheDocument()
    })

    it("renders amount and leverage inputs", async () => {
        await act(async () => render(<TradeForm />))
        expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument()
    })

    it('shows "Approve" button when no allowance', async () => {
        await act(async () => render(<TradeForm />))
        await act(async () => {
            const input = screen.getByPlaceholderText("0.00")
            await userEvent.type(input, "100")
        })
        expect(screen.getByText(/Approve USDC/)).toBeInTheDocument()
    })

    it("shows error via formatContractError on tx failure", async () => {
        mockGetAllow.mockResolvedValue(BigInt(1e18))
        mockOpenV4.mockRejectedValue(new Error("LeverageTooHigh()"))
        await act(async () => render(<TradeForm />))
        await act(async () => {
            const input = screen.getByPlaceholderText("0.00")
            await userEvent.type(input, "10")
        })
        await act(async () => {
            const btn = screen.getByText("Execute 0% Interest Trade")
            await userEvent.click(btn)
        })
        expect(await screen.findByText(/LeverageTooHigh/)).toBeInTheDocument()
    })

    it("allows switching the V4 trading asset between WETH and WBTC", async () => {
        useDeFi.mockReturnValue({
            openV4Position: mockOpenV4,
            simulateV4Position: jest.fn().mockResolvedValue({ success: true }),
            getTokenBalance: mockGetBal,
            getAmountInUsd: mockGetUsd,
            getAllowance: mockGetAllow,
            approveToken: mockApprove,
            isMetaMaskInstalled: true,
            ADDRESSES: {
                USDC: "0xUSDC",
                WETH: "0xWETH",
                WBTC: "0xWBTC",
                V4_ROUTER: "0xRouter",
            },
            SUPPORTED_TOKENS_LIST: [
                { key: "WETH", name: "WETH", address: "0xWETH" },
                { key: "USDC", name: "USDC", address: "0xUSDC" },
                { key: "WBTC", name: "WBTC", address: "0xWBTC" },
            ],
        })
        await act(async () => render(<TradeForm />))
        const [marginSel, tradingSel] = screen.getAllByRole("combobox")

        expect([...tradingSel.options].map((o) => o.value)).toEqual(["WETH", "WBTC"])
        expect([...marginSel.options].map((o) => o.value)).toEqual(["USDC", "WETH"])

        await act(async () => userEvent.selectOptions(tradingSel, "WBTC"))
        expect(tradingSel.value).toBe("WBTC")

        // Margin options follow the selected pair + LONG defaults to USDC.
        expect([...marginSel.options].map((o) => o.value)).toEqual(["USDC", "WBTC"])
        expect(marginSel.value).toBe("USDC")
    })
})
