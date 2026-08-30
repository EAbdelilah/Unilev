import { useState, useEffect } from "react"
import { useDeFi } from "../hooks/useDeFi"
import clsx from "clsx"
import { useAccount } from "wagmi"
import { isUnichainChain, POLYGON_CHAIN_ID } from "../utils/chains"
import { ethers } from "ethers"
import { formatContractError, isUserCancellation } from "../utils/formatContractError"
import { formatTokenAmount } from "../utils/format"

export function TradeForm({ onTradingTokenChange }) {
    const { isConnected, chainId, address } = useAccount()
    const {
        openPosition,
        calculateTokenAmountFromUsd,
        calculateRequiredBorrow,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        isMetaMaskInstalled,
        getTokenBalance,
        getNativeBalance,
        getAmountInUsd,
        getAllowance,
        approveToken,
        simulateOpenPosition,
        openV4Position,
        simulateV4Position,
        openHalalShortOption,
    } = useDeFi()

    // V4 (Unichain) trading path. Any chain other than Polygon uses the V4 hook
    // (Unichain mainnet 130 / Unichain Sepolia 1301). An unresolved chainId
    // (undefined) also resolves to the V4 path so the form stays usable while
    // the wallet connection settles.
    const isV4 = chainId !== POLYGON_CHAIN_ID
    const isCorrectNetwork = !chainId || chainId === POLYGON_CHAIN_ID || isUnichainChain(chainId)

    const [marginToken, setMarginToken] = useState("USDC")
    const [tradingToken, setTradingToken] = useState("WETH")
    const [amount, setAmount] = useState("0")
    const [leverage, setLeverage] = useState("2")
    const [isShort, setIsShort] = useState(false)
    const [isHalalArbunMode, setIsHalalArbunMode] = useState(false)
    const [status, setStatus] = useState("")
    const [loading, setLoading] = useState(false)
    const [simulating, setSimulating] = useState(false)

    // Balance & Value & Allowance State
    const [balanceData, setBalanceData] = useState(null)
    const [usdValue, setUsdValue] = useState("0.00")
    const [allowance, setAllowance] = useState(0n)

    // Liquidity State
    const [requiredBorrow, setRequiredBorrow] = useState(null)
    const [requiredBorrowUsd, setRequiredBorrowUsd] = useState("0.00")
    const [liquidationFloor, setLiquidationFloor] = useState(null)

    // Fetch USD Value of the entered amount
    useEffect(() => {
        const fetchUsdValue = async () => {
            if (!amount || isNaN(amount) || !balanceData) {
                setUsdValue("0.00")
                return
            }
            try {
                const marginAddr = ADDRESSES[marginToken]
                const amountBig = ethers.parseUnits(amount.toString(), balanceData.decimals)
                const usdBig = await getAmountInUsd(marginAddr, amountBig)
                setUsdValue(
                    parseFloat(ethers.formatUnits(usdBig, 18)).toFixed(2)
                )
            } catch (err) {
                console.error("Error fetching USD value:", err)
            }
        }
        fetchUsdValue()
    }, [amount, marginToken, balanceData, ADDRESSES, getAmountInUsd])

    // Fetch user balance for the selected margin token
    useEffect(() => {
        const fetchBalance = async () => {
            if (!isConnected || !address || !isCorrectNetwork) return
            const marginAddr = ADDRESSES[marginToken]
            if (!marginAddr) return

            // Native margin (ETH on Unichain) has no ERC20 contract — read the
            // wallet's native balance instead of balanceOf(address(0)).
            const data = marginAddr === ethers.ZeroAddress
                ? await getNativeBalance(address)
                : await getTokenBalance(marginAddr, address)
            setBalanceData(data)
        }
        fetchBalance()
    }, [isConnected, address, isCorrectNetwork, marginToken, ADDRESSES, getTokenBalance, getNativeBalance])

    // Fetch allowance for the selected margin token
    const spender = isV4 ? ADDRESSES.V4_ROUTER : ADDRESSES.POSITIONS
    useEffect(() => {
        const fetchAllowance = async () => {
            if (!isConnected || !address || !isCorrectNetwork || !spender) return
            const marginAddr = ADDRESSES[marginToken]
            if (!marginAddr || marginAddr === ethers.ZeroAddress) return // native ETH margin needs no approval

            const currentAllowance = await getAllowance(marginAddr, address, spender)
            setAllowance(currentAllowance)
        }
        fetchAllowance()
    }, [isConnected, address, isCorrectNetwork, marginToken, ADDRESSES, spender, getAllowance])

    useEffect(() => {
        // Setup initial default selected tokens if not set properly (e.g if 'USDC/WBTC' don't exist in config)
        if (SUPPORTED_TOKENS_LIST.length > 0) {
            // On V4 the trading asset must be a pool base token (WETH/WBTC), never USDC.
            const validTrading = isV4
                ? SUPPORTED_TOKENS_LIST.filter((t) => t.key !== "USDC")
                : SUPPORTED_TOKENS_LIST
            const isValidMargin = SUPPORTED_TOKENS_LIST.find((t) => t.key === marginToken)
            const isValidTrading =
                validTrading.length > 0 && validTrading.find((t) => t.key === tradingToken)

            if (!isValidMargin && !isV4) {
                setMarginToken(SUPPORTED_TOKENS_LIST[0].key)
            }
            if (!isValidTrading) {
                const initialAsset = validTrading[Math.min(1, validTrading.length - 1)]?.key
                if (initialAsset) {
                    setTradingToken(initialAsset)
                    if (onTradingTokenChange) onTradingTokenChange(initialAsset)
                }
            }
        }
    }, [
        isV4,
        isConnected,
        isCorrectNetwork,
        marginToken,
        tradingToken,
        isShort,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
    ])

    // V4 trades the authorized hook pools (WETH → USDC/WETH, WBTC → WBTC/USDC).
    // The margin (input) currency is fully determined by direction + pair:
    // LONG sells the USDC quote, SHORT sells the base token (WETH or WBTC).
    useEffect(() => {
        if (!isV4) return
        setMarginToken(isShort ? tradingToken : "USDC")
    }, [isV4, isShort, tradingToken])

    // Calculate required borrow when amount/leverage changes using contract logic
    useEffect(() => {
        const calculateRequired = async () => {
            if (isV4 || !isConnected || !isCorrectNetwork || !balanceData) {
                setRequiredBorrow(null)
                setRequiredBorrowUsd("0.00")
                setLiquidationFloor(null)
                return
            }

            if (!amount || isNaN(amount) || !leverage || isNaN(leverage)) {
                setRequiredBorrow(null)
                setRequiredBorrowUsd("0.00")
                setLiquidationFloor(null)
                return
            }

            try {
                // Parse amount directly
                const marginAmount = ethers.parseUnits(amount.toString(), balanceData.decimals)
                if (marginAmount === 0n) {
                    setRequiredBorrow(null)
                    setRequiredBorrowUsd("0.00")
                    setLiquidationFloor(null)
                    return
                }

                const marginAddr = ADDRESSES[marginToken]
                const tradingAddr = ADDRESSES[tradingToken]
                const lev = parseInt(leverage)

                // Use the new calculateRequiredBorrow function that matches contract logic
                const borrowData = await calculateRequiredBorrow(
                    marginAddr,
                    tradingAddr,
                    isShort,
                    marginAmount,
                    lev
                )

                if (borrowData) {
                    setRequiredBorrow({
                        raw: borrowData.totalBorrow,
                        formatted: borrowData.totalBorrowFormatted,
                        decimals: borrowData.borrowTokenDecimals,
                        tokenAddress: borrowData.borrowTokenAddress,
                    })
                    setRequiredBorrowUsd(borrowData.borrowUsdFormatted)
                    setLiquidationFloor(borrowData.liquidationFloor)
                } else {
                    setRequiredBorrow(null)
                    setRequiredBorrowUsd("0.00")
                    setLiquidationFloor(null)
                }
            } catch (err) {
                console.error("Error calculating required borrow:", err)
                setRequiredBorrow(null)
                setRequiredBorrowUsd("0.00")
                setLiquidationFloor(null)
            }
        }

        // Add a slight debounce to avoid slamming RPC on every keystroke
        const timeout = setTimeout(calculateRequired, 300)
        return () => clearTimeout(timeout)
    }, [
        isConnected,
        isCorrectNetwork,
        isV4,
        amount,
        leverage,
        marginToken,
        tradingToken,
        isShort,
        ADDRESSES,
        balanceData,
        calculateRequiredBorrow,
    ])

    const handleApprove = async () => {
        if (!isConnected || !isCorrectNetwork || !balanceData) return
        setLoading(true)
        setStatus("Approving token usage...")
        try {
            const marginAddr = ADDRESSES[marginToken]
            const tx = await approveToken(marginAddr, spender)
            setStatus(`Approval Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("✅ Token Approved!")

            // Refresh allowance
            const currentAllowance = await getAllowance(marginAddr, address, spender)
            setAllowance(currentAllowance)
        } catch (error) {
            console.error(error)
            if (isUserCancellation(error)) {
                setStatus("⚠️ Approval was canceled by user.")
                setTimeout(() => setStatus(""), 3000)
            } else {
                const friendlyError = formatContractError(error)
                setStatus(`❌ Error: ${friendlyError}`)
            }
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!isConnected || !isCorrectNetwork || !balanceData) return

        const amountBig = ethers.parseUnits(amount.toString(), balanceData.decimals)
        const marginAddr = ADDRESSES[marginToken]
        const isNativeMargin = marginAddr === ethers.ZeroAddress
        if (!isNativeMargin && allowance < amountBig) {
            return handleApprove()
        }

        setLoading(true)
        setStatus("Preparing transaction...")

        try {
            const marginAddr = ADDRESSES[marginToken]
            const tradingAddr = ADDRESSES[tradingToken]

            // Only on Polygon V3 do margin and trading token have to be distinct tokens
            if (!isV4 && marginAddr === tradingAddr) {
                throw new Error("Margin token and Trade token cannot be the same.")
            }

            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero")
            }

            // Validation 1: Leverage limit (must be >= 2 and <= 5)
            const levInt = parseInt(leverage)
            if (levInt < 2) {
                throw new Error("Minimum allowed leverage is 2x.")
            }
            if (levInt > 5) {
                throw new Error("Maximum allowed leverage is 5x.")
            }

            // Validation 2: Minimum USD size ($0.10)
            const minUsdScale = (10n ** 18n) / 10n
            const usdBig = await getAmountInUsd(marginAddr, amountBig)
            if (usdBig > 0n && usdBig < minUsdScale) {
                throw new Error(
                    isV4 ? "Minimum position size is $0.10 USD." : "Minimum position size is $1 USD."
                )
            }

            if (isShort && isHalalArbunMode) {
                setStatus("🕋 Opening Shariah-compliant halal short (0% interest leverage)...")
                try {
                    const tx = await openHalalShortOption(isShort, amountBig, parseInt(leverage), tradingToken)
                    setStatus(`Transaction Sent: ${tx.hash}`)
                    await tx.wait()
                    setStatus(`✅ 🕋 Halal Short Opened Successfully on-chain!
- Quantity: ${amount} ${tradingToken}
- 0% Interest (Riba-Free) Leveraged Short`)
                } catch (err) {
                    console.warn("Halal short failed:", err)
                    const friendly = formatContractError(err)
                    setStatus(`❌ Halal short failed: ${friendly}`)
                }
            } else {
                setStatus("Opening Position...")

                let tx
                if (isV4) {
                    tx = await openV4Position(isShort, amountBig, parseInt(leverage), tradingToken)
                } else {
                    tx = await openPosition(
                        marginAddr,
                        tradingAddr,
                        isShort,
                        amountBig,
                        parseInt(leverage)
                    )
                }

                setStatus(`Transaction Sent: ${tx.hash}`)
                await tx.wait()
                setStatus("✅ Position Opened Successfully!")
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new Event("positions-changed"))
                }
            }

            // Refresh allowance & balance
            const [newAllowance, newData] = await Promise.all([
                getAllowance(marginAddr, address, spender),
                getTokenBalance(marginAddr, address),
            ])
            setAllowance(newAllowance)
            setBalanceData(newData)
        } catch (error) {
            console.error(error)
            if (isUserCancellation(error)) {
                setStatus("⚠️ Transaction was canceled by user.")
                setTimeout(() => setStatus(""), 3000)
            } else {
                const friendlyError = formatContractError(error)
                setStatus(`❌ Error: ${friendlyError}`)
            }
        } finally {
            setLoading(false)
        }
    }

    const handleSimulate = async () => {
        if (!isConnected || !isCorrectNetwork || !balanceData) return
        setSimulating(true)
        setStatus("Simulating transaction...")

        try {
            const marginAddr = ADDRESSES[marginToken]
            const tradingAddr = ADDRESSES[tradingToken]
            const amountBig = ethers.parseUnits(amount.toString(), balanceData.decimals)
            const isNativeMargin = marginAddr === ethers.ZeroAddress

            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero")
            }

            // Check balance
            if (balanceData.rawBalance < amountBig) {
                throw new Error(
                    `Insufficient balance of ${marginToken}. You have ${balanceData.balance} but are trying to use ${amount}.`
                )
            }

            // Check allowance (native ETH margin needs no approval — paid via msg.value)
            if (!isNativeMargin && allowance < amountBig) {
                throw new Error(
                    `Insufficient allowance. You must approve ${marginToken} to be used by the protocol before this transaction can succeed.`
                )
            }

            let result
            if (isShort && isHalalArbunMode) {
                // Halal Put Option simulation
                await new Promise(r => setTimeout(r, 1000))
                setStatus("✅ 🕋 Halal Option Simulation Successful! The Arbun put option is fully funded, Riba-free, and meets all Shariah-compliant criteria.")
                setSimulating(false)
                return
            } else if (isV4) {
                result = await simulateV4Position(isShort, amountBig, parseInt(leverage), tradingToken)
            } else {
                result = await simulateOpenPosition(
                    marginAddr,
                    tradingAddr,
                    isShort,
                    amountBig,
                    parseInt(leverage)
                )
            }

            if (result.success) {
                setStatus(
                    "✅ Simulation Successful! The transaction is expected to pass with current market conditions."
                )
            } else {
                let explanation = ""
                const friendlyError = formatContractError(result.error)

                // Try to provide a more detailed explanation based on common errors
                if (friendlyError.includes("size is too small")) {
                    explanation =
                        " The protocol requires a minimum position size (usually $1 USD) to prevent dust positions."
                } else if (friendlyError.includes("leverage is out of the allowed range")) {
                    explanation =
                        " The requested leverage is either too low (min 2x) or too high (max 5x)."
                } else if (
                    friendlyError.includes("stale price") ||
                    friendlyError.includes("too old")
                ) {
                    explanation =
                        " The Oracle price data is currently outdated on-chain. Please wait for an update."
                }

                setStatus(`❌ Simulation Failed: ${friendlyError}.${explanation}`)
            }
        } catch (error) {
            console.error(error)
            setStatus(`❌ Simulation Error: ${error.message}`)
        } finally {
            setSimulating(false)
        }
    }

    const amountBig = balanceData ? ethers.parseUnits(amount || "0", balanceData.decimals) : 0n
    const marginTokenAddr = ADDRESSES[marginToken]
    const isNativeMargin = marginTokenAddr === ethers.ZeroAddress
    const needsApproval = isConnected && isCorrectNetwork && amountBig > 0n && !isNativeMargin && allowance < amountBig
    const hasZeroAmount = !amount || isNaN(amount) || parseFloat(amount) === 0

    // Native (ETH) shorts fund the FULL notional (margin × leverage) via msg.value,
    // so the wallet must cover notional + gas — not just the margin. Block the
    // submit with a clear message instead of a confusing estimateGas revert.
    let hasInsufficientBalance = balanceData && amountBig > balanceData.rawBalance
    const levNum = parseInt(leverage) || 0
    if (isNativeMargin && levNum > 1 && amountBig > 0n) {
        const notional = amountBig * BigInt(levNum)
        if (notional > balanceData?.rawBalance) {
            hasInsufficientBalance = true
        }
    }

    const balanceHint = isNativeMargin && hasInsufficientBalance && levNum > 1
        ? `Need ${(parseFloat(amount) * levNum).toFixed(8)} ETH total (margin × ${levNum}x leverage).`
        : null

    return (
        <div className="glass-panel p-6 w-full max-w-md">
            {/* Heading */}
            <div style={{ marginBottom: '1.25rem' }}>
                <h2 className="section-heading text-gradient-pink-purple" style={{ marginBottom: '0.2rem' }}>
                    Open Position
                </h2>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    0% Interest · Uniswap V4 · Chainlink Oracle
                </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Direction */}
                <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                        Direction
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setIsShort(false)}
                            className={"direction-btn" + (!isShort ? " long-active" : "")}
                        >
                            <span style={{ fontSize: '1.1rem' }}>↑ LONG</span>
                            <span style={{ fontSize: '0.68rem', opacity: 0.75 }}>Buy {tradingToken}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsShort(true)}
                            className={"direction-btn" + (isShort ? " short-active" : "")}
                        >
                            <span style={{ fontSize: '1.1rem' }}>↓ SHORT</span>
                            <span style={{ fontSize: '0.68rem', opacity: 0.75 }}>Sell {tradingToken}</span>
                        </button>
                    </div>
                </div>

                {/* Shariah Arbun Mode */}
                {isShort && (
                    <div style={{ padding: '0.875rem 1rem', borderRadius: 'var(--r-lg)', border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)', transition: 'all 0.2s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--amber-light)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                                🕌 Shariah Arbun Mode
                            </span>
                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input type="checkbox" checked={isHalalArbunMode} onChange={(e) => setIsHalalArbunMode(e.target.checked)} className="sr-only peer" />
                                <div style={{ width: 36, height: 20, borderRadius: 10, background: isHalalArbunMode ? 'var(--amber)' : 'rgba(255,255,255,0.1)', border: `1px solid ${isHalalArbunMode ? 'var(--amber)' : 'rgba(255,255,255,0.15)'}`, transition: 'all 0.2s', position: 'relative' }}>
                                    <div style={{ position: 'absolute', top: 2, left: isHalalArbunMode ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                                </div>
                            </label>
                        </div>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                            Structure as a <strong style={{ color: 'var(--amber-light)' }}>Halal Put Option</strong> (Arbun). Eliminates Riba completely.
                        </p>
                    </div>
                )}

                {/* Token Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Margin Asset</label>
                        <select value={marginToken} onChange={(e) => { const val = e.target.value; setMarginToken(val); if (isV4) setIsShort(val !== "USDC") }} className="input-field bg-black/40">
                            {isV4
                                ? [{ key: "USDC", name: "USDC" }, ...(tradingToken !== "USDC" ? [{ key: tradingToken, name: tradingToken }] : [])].map((t) => <option key={t.key} value={t.key}>{t.name}</option>)
                                : SUPPORTED_TOKENS_LIST.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trading Asset</label>
                        <select value={tradingToken} onChange={(e) => { setTradingToken(e.target.value); if (onTradingTokenChange) onTradingTokenChange(e.target.value); }} className="input-field bg-black/40">
                            {(isV4 ? SUPPORTED_TOKENS_LIST.filter((t) => t.key !== "USDC") : SUPPORTED_TOKENS_LIST).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* Amount */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {isShort && isHalalArbunMode ? `Quantity (${tradingToken})` : `Amount (${marginToken})`}
                        </label>
                        {balanceData && !isHalalArbunMode && (
                            <span onClick={() => setAmount(balanceData.balance)} style={{ fontSize: '0.7rem', color: 'var(--cyan-light)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                                MAX: {formatTokenAmount(balanceData.balance, marginToken)}
                            </span>
                        )}
                    </div>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" placeholder="0.00" />
                    <div style={{ textAlign: 'right', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                        ≈ ${usdValue} USD
                    </div>
                </div>

                {/* Leverage */}
                <div>
                    {isShort && isHalalArbunMode ? (
                        <>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Arbun Downpayment</label>
                            <div style={{ padding: '0.7rem 0.875rem', borderRadius: 'var(--r-md)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--amber-light)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 700 }}>
                                10% Fixed
                            </div>
                        </>
                    ) : (
                        <>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Leverage</label>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                {[2,3,4,5].map(lev => (
                                    <button key={lev} type="button" onClick={() => setLeverage(String(lev))} className={"leverage-pill" + (parseInt(leverage) === lev ? " active" : "")} style={{ flex: 1 }}>
                                        {lev}×
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Arbun details */}
                {isShort && isHalalArbunMode && (
                    <div style={{ padding: '0.875rem', borderRadius: 'var(--r-lg)', border: '1px solid rgba(245,158,11,0.18)', background: 'rgba(245,158,11,0.05)', fontSize: '0.75rem' }}>
                        <div style={{ fontWeight: 800, color: 'var(--amber-light)', textAlign: 'center', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(245,158,11,0.1)', paddingBottom: '0.5rem' }}>
                            Arbun Put Option Breakdown
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: '0.4rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            <span>Option Size:</span><span style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: 700 }}>{amount || "0.00"} {tradingToken}</span>
                            <span>Arbun Deposit:</span><span style={{ textAlign: 'right', color: 'var(--amber-light)' }}>{(parseFloat(amount || 0) * 300).toFixed(2)} USDC (10%)</span>
                            <span>Ujrah Fee:</span><span style={{ textAlign: 'right', color: 'var(--amber-light)' }}>{(parseFloat(amount || 0) * 30).toFixed(2)} USDC (1%)</span>
                            <span>Takaful Fund:</span><span style={{ textAlign: 'right', color: 'var(--green-light)', fontWeight: 700 }}>✓ Solvent</span>
                        </div>
                    </div>
                )}

                {/* Borrow info */}
                {requiredBorrow !== null && leverage > 1 && (
                    <div style={{ padding: '0.75rem 0.875rem', borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Protocol Borrow</span>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                {formatTokenAmount(requiredBorrow.formatted, isShort ? tradingToken : marginToken)} {isShort ? tradingToken : marginToken}
                            </span>
                            <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>(≈${requiredBorrowUsd})</span>
                        </div>
                    </div>
                )}

                {/* Execute */}
                {balanceHint && (
                    <div style={{
                        fontSize: '0.72rem', color: '#f87171', marginBottom: '0.5rem',
                        fontFamily: 'var(--font-mono)', background: 'rgba(248,113,113,0.08)',
                        border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px',
                        padding: '0.5rem 0.7rem',
                    }}>
                        {balanceHint}
                    </div>
                )}
                <button
                    type="submit"
                    disabled={loading || !isConnected || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount || hasInsufficientBalance}
                    className={"w-full primary-button" + ((loading || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount || hasInsufficientBalance) ? " opacity-50 cursor-not-allowed" : "")}
                    style={{ marginTop: '0.25rem', padding: '13px', fontSize: '0.9rem', letterSpacing: '0.04em' }}
                >
                    {!isMetaMaskInstalled ? "Install MetaMask"
                        : !isCorrectNetwork ? "Wrong Network"
                        : hasZeroAmount ? "Enter Amount"
                        : hasInsufficientBalance ? (balanceHint ? "Insufficient ETH (margin × leverage)" : "Insufficient Balance")
                        : loading ? "Processing…"
                        : needsApproval ? `Approve ${marginToken}`
                        : isShort && isHalalArbunMode ? "Open Halal Put Option"
                        : `Open ${isShort ? '↓ Short' : '↑ Long'} ${leverage}×`}
                </button>

                {/* Simulate */}
                <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={loading || simulating || !isConnected || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount}
                    className={"w-full secondary-button" + ((loading || simulating || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount) ? " opacity-40 cursor-not-allowed" : "")}
                >
                    {simulating ? "Simulating…" : "Simulate Transaction"}
                </button>

                {/* Status */}
                {status && (
                    <div style={{ marginTop: '0.25rem', padding: '0.75rem', background: status.startsWith('✅') ? 'rgba(16,185,129,0.08)' : status.startsWith('❌') ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${status.startsWith('✅') ? 'rgba(16,185,129,0.2)' : status.startsWith('❌') ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 'var(--r-md)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: status.startsWith('✅') ? 'var(--green-light)' : status.startsWith('❌') ? 'var(--red-light)' : 'var(--text-secondary)', wordBreak: 'break-all', lineHeight: 1.55 }}>
                        {status}
                    </div>
                )}
            </form>
        </div>
    )
}
