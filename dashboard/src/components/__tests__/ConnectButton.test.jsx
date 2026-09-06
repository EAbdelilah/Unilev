import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConnectButton } from "../ConnectButton"

jest.mock("wagmi", () => ({
    useAccount: jest.fn(),
    useConnect: jest.fn(),
    useDisconnect: jest.fn(),
    useSwitchChain: jest.fn(),
}))

jest.mock("wagmi/chains", () => ({
    polygon: { id: 137, name: "Polygon" },
    unichain: { id: 130, name: "Unichain" },
    unichainSepolia: { id: 1301, name: "Unichain Sepolia" },
}))

jest.mock("wagmi/connectors", () => ({
    injected: jest.fn(() => ({ id: "injected" })),
}))

const wagmi = require("wagmi")

const MOCK_CONNECTORS = [
    { id: "io.metamask", name: "MetaMask", type: "injected", uid: "1" },
    { id: "walletConnect", name: "WalletConnect", type: "walletConnect", uid: "2" },
]

describe("ConnectButton", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        wagmi.useConnect.mockReturnValue({ connect: jest.fn(), connectors: MOCK_CONNECTORS, isPending: false, error: null })
        wagmi.useDisconnect.mockReturnValue({ disconnect: jest.fn() })
        wagmi.useSwitchChain.mockReturnValue({ switchChain: jest.fn() })
        delete window.ethereum
    })

    it('shows "Connect Wallet" when not connected', () => {
        wagmi.useAccount.mockReturnValue({ isConnected: false, address: null, chainId: null, connector: null })
        render(<ConnectButton />)
        expect(screen.getByText("Connect Wallet")).toBeInTheDocument()
    })

    it("opens the wallet modal listing connectors", async () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({ isConnected: false, address: null, chainId: null, connector: null })
        render(<ConnectButton />)
        await userEvent.click(screen.getByText("Connect Wallet"))
        expect(screen.getByRole("heading", { name: "Connect Wallet" })).toBeInTheDocument()
        expect(screen.getByText("MetaMask")).toBeInTheDocument()
        expect(screen.getByText("Recommended")).toBeInTheDocument()
        expect(screen.getByText("WalletConnect")).toBeInTheDocument()
    })

    it("shows address + disconnect when connected on Polygon", () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({
            isConnected: true,
            address: "0x1234567890abcdef",
            chainId: 137,
            connector: { id: "io.metamask", name: "MetaMask" },
        })
        render(<ConnectButton />)
        expect(screen.getByText("Polygon")).toBeInTheDocument()
        expect(screen.getByText("0x1234…cdef")).toBeInTheDocument()
        expect(screen.getByText("Disconnect")).toBeInTheDocument()
    })

    it("shows address + disconnect when connected on Unichain", () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({
            isConnected: true,
            address: "0x1234567890abcdef",
            chainId: 130,
            connector: { id: "io.metamask", name: "MetaMask" },
        })
        render(<ConnectButton />)
        expect(screen.getByText("Unichain")).toBeInTheDocument()
        expect(screen.getByText("0x1234…cdef")).toBeInTheDocument()
        expect(screen.getByText("Disconnect")).toBeInTheDocument()
    })

    it('shows "Wrong Network" when connected to an unsupported chain', () => {
        window.ethereum = {}
        wagmi.useAccount.mockReturnValue({
            isConnected: true,
            address: "0xUser",
            chainId: 1,
            connector: { id: "io.metamask", name: "MetaMask" },
        })
        render(<ConnectButton />)
        expect(screen.getByText("Wrong Network")).toBeInTheDocument()
        expect(screen.getByText("Disconnect")).toBeInTheDocument()
    })
})