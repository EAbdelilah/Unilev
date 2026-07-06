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
        const key = { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.V4_HOOK }

        // Pass the signer's address as the trader in hookData for secure position recording
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, leverage, address])

        return await router.swap({ key, zeroForOne: !isShort, amountSpecified: -amount, hookData })
    }, [getSigner, address])

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.PRICEFEEDL1) return 0n
        const feed = new ethers.Contract(ADDRESSES.PRICEFEEDL1, PriceFeedL1ABI.abi, readProvider)
        try { return await feed.getAmountInUsd(token, amount) } catch { return 0n }
    }, [readProvider])

    const getTokenBalance = useCallback(async (token, user) => {
        if (!readProvider || !token) return null
        const contract = new ethers.Contract(token, ERC20ABI.abi, readProvider)
        try {
            const [bal, decimals] = await Promise.all([contract.balanceOf(user), contract.decimals()])
            return { rawBalance: bal, balance: ethers.formatUnits(bal, decimals), decimals }
        } catch { return null }
    }, [readProvider])

    const getAllowance = useCallback(async (token, owner, spender) => {
        if (!readProvider || !token) return 0n
        const contract = new ethers.Contract(token, ERC20ABI.abi, readProvider)
        try { return await contract.allowance(owner, spender) } catch { return 0n }
    }, [readProvider])

    const approveToken = useCallback(async (token, spender, amount = ethers.MaxUint256) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const contract = new ethers.Contract(token, ERC20ABI.abi, signer)
        return await contract.approve(spender, amount)
    }, [getSigner])

    return {
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        openV4Position,
        getAmountInUsd,
        getTokenBalance,
        getAllowance,
        approveToken,
        isMetaMaskInstalled: typeof window !== "undefined" && !!window.ethereum
    }
}
