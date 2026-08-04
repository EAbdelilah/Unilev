import { createConfig, http } from "wagmi"
import { polygon, unichain, unichainSepolia } from "wagmi/chains"
import { injected } from "wagmi/connectors"

export const config = createConfig({
    chains: [polygon, unichain, unichainSepolia],
    connectors: [injected()],
    transports: {
        [polygon.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://polygon-mainnet.g.alchemy.com/v2/demo"),
        [unichain.id]: http(process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/demo"),
        [unichainSepolia.id]: http(process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL || "https://sepolia.unichain.org"),
    },
    ssr: true,
})
