import { useState, useCallback, useEffect } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"

// ABIs
import ERC20ABI from "../abis/ERC20.json"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedL1ABI from "../abis/PriceFeedL1.json"
import supportedTokens from "../config/supported_tokens.json"

export const SUPPORTED_TOKENS_LIST = Object.entries(supportedTokens)
    .filter(([key]) => key !== "wrapper")
    .map(([key, address]) => ({ key, name: key, address }))

const ADDRESSES = {
    ...supportedTokens,
    V4_ROUTER: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS,
    V4_HOOK: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS,
    PRICEFEEDL1: process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS,
}

export function useDeFi() {
    const { address, isConnected } = useAccount()
    const { data: walletClient } = useWalletClient()
    const [readProvider, setReadProvider] = useState(null)

    useEffect(() => {
        const init = async () => {
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL || "https://polygon.drpc.org")
            setReadProvider(provider)
        }
        init()
    }, [])

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const openV4Position = useCallback(async (currency0, currency1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")

        const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)

        // V4 PoolKey
        const key = {
            currency0,
            currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: ADDRESSES.V4_HOOK
        }

        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8"], [true, leverage])

        // SwapParams for Router
        const params = {
            key,
            zeroForOne: !isShort,
            amountSpecified: -amount,
            hookData
        }

        const tx = await router.swap(params)
        return tx
    }, [getSigner])

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.PRICEFEEDL1) return 0n
        const feed = new ethers.Contract(ADDRESSES.PRICEFEEDL1, PriceFeedL1ABI.abi, readProvider)
        try {
            return await feed.getAmountInUsd(token, amount)
        } catch {
            return 0n
        }
    }, [readProvider])

    const getTokenBalance = useCallback(async (token, user) => {
        if (!readProvider || !token) return null
        const contract = new ethers.Contract(token, ERC20ABI.abi, readProvider)
        try {
            const [bal, decimals, symbol] = await Promise.all([
                contract.balanceOf(user),
                contract.decimals(),
                contract.symbol()
            ])
            return { rawBalance: bal, balance: ethers.formatUnits(bal, decimals), decimals, symbol }
        } catch {
            return null
        }
    }, [readProvider])

    return {
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        openV4Position,
        getAmountInUsd,
        getTokenBalance,
        isMetaMaskInstalled: typeof window !== "undefined" && !!window.ethereum
    }
}
