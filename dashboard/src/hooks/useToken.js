import { useCallback } from "react"
import { ethers } from "ethers"
import { useWalletClient } from "wagmi"
import ERC20ABI from "../abis/ERC20.json"
import { useReadProvider } from "./useReadProvider"

export function useToken() {
    const readProvider = useReadProvider()
    const { data: walletClient } = useWalletClient()

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

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

    return { getTokenBalance, getAllowance, approveToken }
}
