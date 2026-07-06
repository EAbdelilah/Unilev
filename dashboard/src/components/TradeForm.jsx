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
        getAllowance,
        approveToken,
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
    const [allowance, setAllowance] = useState(0n)

    useEffect(() => {
        const fetchState = async () => {
            if (!isConnected || !address || !ADDRESSES[marginToken]) return
            const [bal, allow] = await Promise.all([
                getTokenBalance(ADDRESSES[marginToken], address),
                getAllowance(ADDRESSES[marginToken], address, ADDRESSES.V4_ROUTER)
            ])
            setBalanceData(bal)
            setAllowance(allow)
        }
        fetchState()
    }, [marginToken, isConnected, address, getTokenBalance, getAllowance, ADDRESSES])

    useEffect(() => {
        const fetchUsd = async () => {
            if (!amount || isNaN(amount) || !balanceData || !ADDRESSES[marginToken]) {
                setUsdValue("0.00")
                return
            }
            try {
                const amountBig = ethers.parseUnits(amount, balanceData.decimals)
                const usd = await getAmountInUsd(ADDRESSES[marginToken], amountBig)
                setUsdValue(parseFloat(ethers.formatUnits(usd, 18)).toFixed(2))
            } catch { setUsdValue("0.00") }
        }
        fetchUsd()
    }, [amount, marginToken, balanceData, ADDRESSES, getAmountInUsd])

    const handleApprove = async () => {
        setLoading(true)
        setStatus("Approving Router...")
        try {
            const tx = await approveToken(ADDRESSES[marginToken], ADDRESSES.V4_ROUTER)
            await tx.wait()
            setStatus("✅ Router Approved!")
            const allow = await getAllowance(ADDRESSES[marginToken], address, ADDRESSES.V4_ROUTER)
            setAllowance(allow)
        } catch (err) {
            setStatus(`❌ Error: ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        const amountBig = ethers.parseUnits(amount, balanceData?.decimals || 18)
        if (allowance < amountBig) return handleApprove()

        setLoading(true)
        setStatus("Opening V4 Margin Position...")
        try {
            const tx = await openV4Position(
                ADDRESSES[marginToken],
                ADDRESSES[tradingToken],
                isShort,
                amountBig,
                parseInt(leverage)
            )
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("✅ Position Opened Successfully!")
        } catch (err) {
            setStatus(`❌ Error: ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="glass-panel p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-500 text-center">
                Eswap V4 Margin
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setIsShort(false)} className={clsx("py-3 rounded-xl border-2 transition-all flex flex-col items-center", !isShort ? "bg-green-500/10 border-green-500 text-green-400" : "bg-black/40 text-gray-400")}>
                        <span className="font-bold tracking-wider">LONG</span>
                        <span className="text-[10px] opacity-60">0% Interest</span>
                    </button>
                    <button type="button" onClick={() => setIsShort(true)} className={clsx("py-3 rounded-xl border-2 transition-all flex flex-col items-center", isShort ? "bg-red-500/10 border-red-500 text-red-400" : "bg-black/40 text-gray-400")}>
                        <span className="font-bold tracking-wider">SHORT</span>
                        <span className="text-[10px] opacity-60">0% Interest</span>
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] text-gray-400 mb-1 block font-bold uppercase tracking-tight">Margin Asset</label>
                        <select value={marginToken} onChange={(e) => setMarginToken(e.target.value)} className="input-field bg-black/40 text-sm">
                            {SUPPORTED_TOKENS_LIST.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400 mb-1 block font-bold uppercase tracking-tight">Trading Asset</label>
                        <select value={tradingToken} onChange={(e) => setTradingToken(e.target.value)} className="input-field bg-black/40 text-sm">
                            {SUPPORTED_TOKENS_LIST.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] text-gray-400 mb-1 block font-bold uppercase tracking-tight">Amount</label>
                        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field text-sm" placeholder="0.00" />
                        <div className="text-[10px] text-gray-500 mt-1 font-mono">≈ ${usdValue}</div>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400 mb-1 block font-bold uppercase tracking-tight">Leverage (1-5x)</label>
                        <input type="number" value={leverage} onChange={(e) => setLeverage(e.target.value)} className="input-field text-sm" min="1" max="5" />
                    </div>
                </div>

                <button type="submit" disabled={loading || !isConnected} className="w-full primary-button mt-4 py-4 text-sm font-bold tracking-widest uppercase">
                    {loading ? "Processing..." : (allowance < ethers.parseUnits(amount || "0", balanceData?.decimals || 18) ? `Approve ${marginToken}` : "Execute 0% Interest Trade")}
                </button>
                {status && <div className="mt-4 p-3 bg-white/5 rounded border border-white/10 text-[10px] font-mono break-all opacity-80">{status}</div>}
            </form>
        </div>
    )
}
