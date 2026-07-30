import { render, screen } from "@testing-library/react"
import { ConnectButton } from "../ConnectButton"

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
    useConnect: jest.fn(),
    useDisconnect: jest.fn(),
    useSwitchChain: jest.fn(),
}))

jest.mock("wagmi/chains", () => ({
    polygon: { id: 137 },
}))

jest.mock("wagmi/connectors", () => ({
    injected: jest.fn(() => ({ id: "injected" })),
}))

const wagmi = require("wagmi")

describe("ConnectButton", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        wagmi.useConnect.mockReturnValue({ connect: jest.fn() })
        wagmi.useDisconnect.mockReturnValue({ disconnect: jest.fn() })
        wagmi.useSwitchChain.mockReturnValue({ switchChain: jest.fn() })
        delete window.ethereum
    })

    it('shows "Install MetaMask" when no provider', () => {
        wagmi.useAccount.mockReturnValue({ isConnected: false, address: null, chainId: null })
        render(<ConnectButton />)
        expect(screen.getByText("Install MetaMask")).toBeInTheDocument()
    })

    it('shows "Connect Wallet" when provider exists but not connected', () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({ isConnected: false, address: null, chainId: null })
        render(<ConnectButton />)
        expect(screen.getByText("Connect Wallet")).toBeInTheDocument()
    })

    it("shows address + disconnect when connected on Polygon", () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({
            isConnected: true,
            address: "0x1234567890abcdef",
            chainId: 137,
        })
        render(<ConnectButton />)
        expect(screen.getByText("0x1234...cdef")).toBeInTheDocument()
        expect(screen.getByText("Disconnect")).toBeInTheDocument()
    })

    it('shows "Switch to Polygon" when connected to wrong chain', () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({
            isConnected: true,
            address: "0xUser",
            chainId: 1,
        })
        render(<ConnectButton />)
        expect(screen.getByText("Switch to Polygon")).toBeInTheDocument()
    })
})
