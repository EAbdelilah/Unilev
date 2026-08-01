import { useState, useEffect } from "react"
import { useDeFi } from "../hooks/useDeFi"
import clsx from "clsx"
import { useAccount } from "wagmi"
import { polygon } from "wagmi/chains"
import { ethers } from "ethers"
import { formatContractError, isUserCancellation } from "../utils/formatContractError"
import { formatTokenAmount } from "../utils/format"

export function TradeForm({ onTradingTokenChange }) {
    const { isConnected, chainId, address } = useAccount()
    const {
        openPosition,
        calculateTokenAmountFromUsd,
        calculateRequiredBorrow,
        calculateRequiredBorrow,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        isMetaMaskInstalled,
        getTokenBalance,
        getAmountInUsd,
        getAllowance,
        approveToken,
        simulateOpenPosition,
    } = useDeFi()

    const [marginToken, setMarginToken] = useState("USDC")
    const [tradingToken, setTradingToken] = useState("WBTC")
    const [amount, setAmount] = useState("0")
    const [leverage, setLeverage] = useState("2")
    const [isShort, setIsShort] = useState(false)
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

    const isCorrectNetwork = chainId === polygon.id

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
                setUsdValue(parseFloat(ethers.formatUnits(usdBig, 18)).toFixed(2))
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

            const data = await getTokenBalance(marginAddr, address)
            setBalanceData(data)
        }
        fetchBalance()
    }, [isConnected, address, isCorrectNetwork, marginToken, ADDRESSES, getTokenBalance])

    // Fetch allowance for the selected margin token
    useEffect(() => {
        const fetchAllowance = async () => {
            if (!isConnected || !address || !isCorrectNetwork || !ADDRESSES.POSITIONS) return
            const marginAddr = ADDRESSES[marginToken]
            if (!marginAddr) return

            const currentAllowance = await getAllowance(marginAddr, address, ADDRESSES.POSITIONS)
            setAllowance(currentAllowance)
        }
        fetchAllowance()
    }, [isConnected, address, isCorrectNetwork, marginToken, ADDRESSES, getAllowance])

    useEffect(() => {
        // Setup initial default selected tokens if not set properly (e.g if 'USDC/WBTC' don't exist in config)
        if (SUPPORTED_TOKENS_LIST.length > 0) {
            if (!SUPPORTED_TOKENS_LIST.find((t) => t.key === marginToken)) {
                setMarginToken(SUPPORTED_TOKENS_LIST[0].key)
            }
            if (!SUPPORTED_TOKENS_LIST.find((t) => t.key === tradingToken)) {
                const initialAsset = SUPPORTED_TOKENS_LIST[Math.min(1, SUPPORTED_TOKENS_LIST.length - 1)].key;
                setTradingToken(initialAsset)
                if (onTradingTokenChange) onTradingTokenChange(initialAsset);
            }
        }
    }, [
        isConnected,
        isCorrectNetwork,
        marginToken,
        tradingToken,
        isShort,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
    ])

    // Calculate required borrow when amount/leverage changes using contract logic
    useEffect(() => {
        const calculateRequired = async () => {
            if (!isConnected || !isCorrectNetwork || !balanceData) {
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
            const tx = await approveToken(marginAddr, ADDRESSES.POSITIONS)
            setStatus(`Approval Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("✅ Token Approved!")

            // Refresh allowance
            const currentAllowance = await getAllowance(marginAddr, address, ADDRESSES.POSITIONS)
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
        if (allowance < amountBig) {
            return handleApprove()
        }

        setLoading(true)
        setStatus("Preparing transaction...")

        try {
            // "token0" is what trader SENDS as margin
            // "token1" is the other half of the pair to trade
            const marginAddr = ADDRESSES[marginToken] // sent by user
            const tradingAddr = ADDRESSES[tradingToken] // traded against

            // Check if they are trying illegal setups via the UI selector
            if (marginAddr === tradingAddr) {
                throw new Error("Margin token and Trade token cannot be the same.")
            }

            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero")
            }

            // Validation 1: Leverage limit (must be > 1 and <= 5)
            const levInt = parseInt(leverage)
            if (levInt < 2) {
                throw new Error("Minimum allowed leverage is 2x.")
            }
            if (levInt > 5) {
                throw new Error("Maximum allowed leverage is 5x.")
            }

            // Validation 2: Minimum USD amount ($1)
            // Only enforce when price feed returns a valid value —
            // if getAmountInUsd returns 0n due to a feed error, skip this check
            // and let the contract validate instead.
            const usdBig = await getAmountInUsd(marginAddr, amountBig)
            if (usdBig > 0n && usdBig < 1000000000000000000n) {
                // 1e18
                throw new Error("Minimum position size is $1 USD.")
            }

            setStatus("Opening Position...")

            const tx = await openPosition(
                marginAddr,
                tradingAddr,
                isShort,
                amountBig,
                parseInt(leverage)
            )

            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("✅ Position Opened Successfully!")

            // Refresh allowance & balance
            const [newAllowance, newData] = await Promise.all([
                getAllowance(marginAddr, address, ADDRESSES.POSITIONS),
                getTokenBalance(marginAddr, address),
            ])
            setAllowance(newAllowance)
            setBalanceData(newData)
        } catch (error) {
            console.error(error)
            if (isUserCancellation(error)) {
                setStatus("⚠️ Transaction was canceled by user.")
                // Clear the status after 3 seconds since it's just a cancellation
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

            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero")
            }

            // Check balance
            if (balanceData.rawBalance < amountBig) {
                throw new Error(
                    `Insufficient balance of ${marginToken}. You have ${balanceData.balance} but are trying to use ${amount}.`
                )
            }

            // Check allowance
            if (allowance < amountBig) {
                throw new Error(
                    `Insufficient allowance. You must approve ${marginToken} to be used by the protocol before this transaction can succeed.`
                )
            }

            const result = await simulateOpenPosition(
                marginAddr,
                tradingAddr,
                isShort,
                amountBig,
                parseInt(leverage)
            )

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
    const needsApproval = isConnected && isCorrectNetwork && amountBig > 0n && allowance < amountBig
    const hasZeroAmount = !amount || isNaN(amount) || parseFloat(amount) === 0
    const hasInsufficientBalance = balanceData && amountBig > balanceData.rawBalance

    return (
        <div className="glass-panel p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-500">
                Open Position
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Direction Selection */}
                <div>
                    <label className="text-xs text-gray-400 mb-2 block font-bold uppercase tracking-wider">
                        Position Direction
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setIsShort(false)}
                            className={clsx(
                                "py-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1",
                                !isShort
                                    ? "bg-green-500/10 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
                                    : "bg-black/40 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300"
                            )}
                        >
                            <span className="font-bold text-lg tracking-wider">LONG</span>
                            <span
                                className={clsx(
                                    "text-xs",
                                    !isShort ? "text-green-500/80" : "text-gray-500"
                                )}
                            >
                                Uses {marginToken} Pool
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsShort(true)}
                            className={clsx(
                                "py-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1",
                                isShort
                                    ? "bg-red-500/10 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                    : "bg-black/40 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300"
                            )}
                        >
                            <span className="font-bold text-lg tracking-wider">SHORT</span>
                            <span
                                className={clsx(
                                    "text-xs",
                                    isShort ? "text-red-500/80" : "text-gray-500"
                                )}
                            >
                                Uses {tradingToken} Pool
                            </span>
                        </button>
                    </div>
                </div>

                {/* Token Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">
                            Margin (Sent) Token
                        </label>
                        <select
                            value={marginToken}
                            onChange={(e) => setMarginToken(e.target.value)}
                            className="input-field bg-black/40"
                        >
                            {SUPPORTED_TOKENS_LIST.map((t) => (
                                <option key={t.key} value={t.key}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">
                            Trading (Asset) Token
                        </label>
                        <select
                            value={tradingToken}
                            onChange={(e) => {
                                setTradingToken(e.target.value);
                                if (onTradingTokenChange) onTradingTokenChange(e.target.value);
                            }}
                            className="input-field bg-black/40"
                        >
                            {SUPPORTED_TOKENS_LIST.map((t) => (
                                <option key={t.key} value={t.key}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Amount & Leverage Grid */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Amount */}
                    <div>
                        <div className="flex justify-between mb-1">
                            <label className="text-xs text-gray-400 block">
                                Amount ({marginToken})
                            </label>
                            {balanceData && (
                                <span
                                    onClick={() => setAmount(balanceData.balance)}
                                    className="text-xs text-blue-400 cursor-pointer hover:text-blue-300"
                                >
                                    Max: {formatTokenAmount(balanceData.balance, marginToken)}
                                </span>
                            )}
                        </div>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="input-field"
                            placeholder="0.00"
                        />
                    </div>

                    {/* Leverage */}
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">
                            Leverage (Max 5x)
                        </label>
                        <input
                            type="number"
                            value={leverage}
                            onChange={(e) => setLeverage(e.target.value)}
                            className="input-field"
                            min="2"
                            max="5"
                            step="1"
                        />
                    </div>
                </div>

                {/* Amount USD Display */}
                <div className="text-[10px] text-gray-500 text-right px-1">
                    Value: ≈ ${usdValue} USD
                </div>

                {/* Liquidity Information */}
                {requiredBorrow !== null && leverage > 1 && (
                    <div
                        className={clsx(
                            "p-3 rounded text-sm transition-colors",
                            "bg-white/5 text-gray-400"
                        )}
                    >
                        <div className="flex justify-between mb-1">
                            <span>Required Borrow:</span>
                            <div className="text-right">
                                <span className="font-mono">
                                    {formatTokenAmount(requiredBorrow.formatted, isShort ? tradingToken : marginToken)}{" "}
                                    {isShort ? tradingToken : marginToken}
                                </span>
                                <span className="text-[10px] text-gray-500 ml-2">
                                    (≈ ${requiredBorrowUsd} USD)
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={
                        loading ||
                        !isConnected ||
                        !isCorrectNetwork ||
                        !isMetaMaskInstalled ||
                        hasZeroAmount ||
                        hasInsufficientBalance
                    }
                    className={clsx(
                        "w-full primary-button mt-4",
                        (loading ||
                            !isCorrectNetwork ||
                            !isMetaMaskInstalled ||
                            hasZeroAmount ||
                            hasInsufficientBalance) &&
                            "opacity-50 cursor-not-allowed"
                    )}
                >
                    {!isMetaMaskInstalled
                        ? "Install MetaMask"
                        : !isCorrectNetwork
                        ? "Wrong Network"
                        : hasZeroAmount
                        ? "Enter Amount"
                        : hasInsufficientBalance
                        ? "Insufficient Balance"
                        : loading
                        ? "Processing..."
                        : needsApproval
                        ? `Approve ${marginToken}`
                        : "Open Position"}
                </button>

                <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={
                        loading ||
                        simulating ||
                        !isConnected ||
                        !isCorrectNetwork ||
                        !isMetaMaskInstalled ||
                        hasZeroAmount
                    }
                    className={clsx(
                        "w-full secondary-button mt-2",
                        (loading ||
                            simulating ||
                            !isCorrectNetwork ||
                            !isMetaMaskInstalled ||
                            hasZeroAmount) &&
                            "opacity-50 cursor-not-allowed"
                    )}
                >
                    {simulating ? "Simulating..." : "Simulate Transaction"}
                </button>
                {status && (
                    <div className="mt-4 p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all">
                        {status}
                    </div>
                )}
            </form>
        </div>
    )
}

// Small helper just for the UI so we aren't showing massive BigInts unformatted
function formatSmallDisplay(bigIntAmount, capacityData) {
    if (!capacityData || !bigIntAmount) return "0"
    // We expect capacityData to be derived from decimals, so we cheat here
    // to find decimals inversely, but it's simpler to just do this roughly:
    // Capacity BigInt / Capacity Formatted = 10^decimals
    try {
        const capacityNum = parseFloat(capacityData.capacityFormatted)
        if (capacityNum === 0 || capacityData.rawCapacity === 0n) return "0"

        // Approx ratio
        const display =
            (parseFloat(bigIntAmount.toString()) /
                parseFloat(capacityData.rawCapacity.toString())) *
            capacityNum
        return display.toFixed(4)
    } catch {
        return "0.00"
    }
}
