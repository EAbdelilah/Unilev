import { render, screen, act } from "@testing-library/react"
import { FeeManager } from "../FeeManager"

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

jest.mock("ethers", () => ({
    ethers: {
        JsonRpcProvider: jest.fn(),
        Contract: jest.fn(),
        formatUnits: jest.fn((v, d) => (Number(v) / 10 ** Number(d)).toString()),
    },
    JsonRpcProvider: jest.fn(),
    Contract: jest.fn(),
    formatUnits: jest.fn((v, d) => (Number(v) / 10 ** Number(d)).toString()),
}))

const { useAccount } = require("wagmi")
const { useDeFi } = require("../../hooks/useDeFi")

describe("FeeManager", () => {
    beforeEach(() => {
        useAccount.mockReturnValue({ isConnected: true, address: "0xUser" })
        useDeFi.mockReturnValue({
            ADDRESSES: { V4_HOOK: "0xHook" },
            getFeeDefaults: jest.fn().mockResolvedValue({ treasureFee: "100", liquidationReward: "50" }),
            updateFeeDefaults: jest.fn().mockResolvedValue({ hash: "0xHash", wait: jest.fn().mockResolvedValue({}) }),
        })
    })

    it("renders nothing when disconnected", () => {
        useAccount.mockReturnValue({ isConnected: false, address: null })
        const { container } = render(<FeeManager />)
        expect(container.innerHTML).toBe("")
    })

    it("renders fee form when connected", async () => {
        await act(async () => render(<FeeManager />))
        expect(screen.getByText("Fee Manager")).toBeInTheDocument()
        expect(screen.getByText("Treasure Fee (wei)")).toBeInTheDocument()
        expect(screen.getByText("Liquidation Reward (wei)")).toBeInTheDocument()
    })
})
