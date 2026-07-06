import { useState, useEffect } from "react"
import { useDeFi } from "../hooks/useDeFi"
import clsx from "clsx"
import { useAccount } from "wagmi"
import { ethers } from "ethers"

export function TradeForm() {
    const { isConnected, address } = useAccount()
    const {
        openV4Position,
        getTokenBalance,
        getAmountInUsd,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
    } = useDeFi()

    const [marginToken, setMarginToken] = useState("USDC")
    const [tradingToken, setTradingToken] = useState("WBTC")
    const [amount, setAmount] = useState("0")
    const [leverage, setLeverage] = useState("5")
    const [isShort, setIsShort] = useState(false)
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState("")
    const [balanceData, setBalanceData] = useState(null)
    const [usdValue, setUsdValue] = useState("0.00")

    useEffect(() => {
        const fetchBal = async () => {
            if (!isConnected || !address) return
            const data = await getTokenBalance(ADDRESSES[marginToken], address)
            setBalanceData(data)
        }
        fetchBal()
    }, [marginToken, isConnected, address, getTokenBalance, ADDRESSES])

    useEffect(() => {
        const fetchUsd = async () => {
            if (!amount || isNaN(amount) || !balanceData) {
                setUsdValue("0.00")
                return
            }
            const amountBig = ethers.parseUnits(amount, balanceData.decimals)
            const usd = await getAmountInUsd(ADDRESSES[marginToken], amountBig)
            setUsdValue(parseFloat(ethers.formatUnits(usd, 18)).toFixed(2))
        }
        fetchUsd()
    }, [amount, marginToken, balanceData, ADDRESSES, getAmountInUsd])

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setStatus("Opening V4 Margin Position...")
        try {
            const amountBig = ethers.parseUnits(amount, balanceData.decimals)
            const tx = await openV4Position(
                ADDRESSES[marginToken],
                ADDRESSES[tradingToken],
                isShort,
                amountBig,
                parseInt(leverage)
            )
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("✅ V4 Position Opened Successfully!")
        } catch (err) {
            setStatus(`❌ Error: ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="glass-panel p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-500">
                Eswap V4 Margin
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setIsShort(false)} className={clsx("py-3 rounded-xl border-2 transition-all flex flex-col items-center", !isShort ? "bg-green-500/10 border-green-500 text-green-400" : "bg-black/40 text-gray-400")}>
                        <span className="font-bold">LONG</span>
                        <span className="text-[10px] opacity-60">0% Interest</span>
                    </button>
                    <button type="button" onClick={() => setIsShort(true)} className={clsx("py-3 rounded-xl border-2 transition-all flex flex-col items-center", isShort ? "bg-red-500/10 border-red-500 text-red-400" : "bg-black/40 text-gray-400")}>
                        <span className="font-bold">SHORT</span>
                        <span className="text-[10px] opacity-60">0% Interest</span>
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Margin Asset</label>
                        <select value={marginToken} onChange={(e) => setMarginToken(e.target.value)} className="input-field bg-black/40">
                            {SUPPORTED_TOKENS_LIST.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Trading Asset</label>
                        <select value={tradingToken} onChange={(e) => setTradingToken(e.target.value)} className="input-field bg-black/40">
                            {SUPPORTED_TOKENS_LIST.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Amount</label>
                        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" placeholder="0.00" />
                        <div className="text-[10px] text-gray-500 mt-1">Value: ≈ ${usdValue}</div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Leverage (Max 5x)</label>
                        <input type="number" value={leverage} onChange={(e) => setLeverage(e.target.value)} className="input-field" min="2" max="5" />
                    </div>
                </div>

                <button type="submit" disabled={loading || !isConnected} className="w-full primary-button mt-4">
                    {loading ? "Processing..." : "Execute 0% Interest Trade"}
                </button>
                {status && <div className="mt-4 p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all">{status}</div>}
            </form>
        </div>
    )
}
