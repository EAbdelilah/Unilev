import { createConfig, http } from "wagmi"
import { polygon, unichain, unichainSepolia } from "wagmi/chains"
import { injected, walletConnect, coinbaseWallet, safe } from "wagmi/connectors"

export const WC_PROJECT_ID =
    process.env.NEXT_PUBLIC_WC_PROJECT_ID || "90fd7d34d14f7542a32dc09a98ce2e4a"

const metadata = {
    name: "Eswap Protocol",
    description: "0% Interest Margin Trading — Uniswap V4 + Chainlink",
    url: "https://eswap.finance",
    icons: ["https://eswap.finance/logo.png"],
}

export const config = createConfig({
    chains: [unichain, polygon, unichainSepolia],
    multiInjectedProviderDiscovery: true,
    connectors: [
        // 1. MetaMask (direct extension target without @metamask/connect-evm SDK dependency)
        injected({ target: 'metaMask', shimDisconnect: true }),
        // 2. Generic Injected (Brave Wallet, Rabby, Frame...)
        injected({ shimDisconnect: true }),
        // 3. WalletConnect v2 — mobile wallets via QR code
        walletConnect({
            projectId: WC_PROJECT_ID,
            metadata,
            showQrModal: true,
        }),
        // 4. Coinbase Wallet
        coinbaseWallet({
            appName: metadata.name,
            appLogoUrl: metadata.icons[0],
        }),
        // 5. Safe
        safe(),
    ],
    transports: {
        [polygon.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://polygon-mainnet.g.alchemy.com/v2/demo"),
        [unichain.id]: http(process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/demo"),
        [unichainSepolia.id]: http(process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL || "https://sepolia.unichain.org"),
    },
    ssr: true,
})
