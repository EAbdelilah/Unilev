import { createConfig, http } from "wagmi"
import { polygon } from "wagmi/chains"
import { injected } from "wagmi/connectors"

export const config = createConfig({
    chains: [polygon],
    connectors: [injected()],
    transports: {
        [polygon.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://polygon-mainnet.g.alchemy.com/v2/demo"),
    },
    ssr: true,
})
