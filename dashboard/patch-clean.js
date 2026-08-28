const fs = require('fs');
const path = require('path');

const tradeFormPath = path.join(__dirname, 'src/components/TradeForm.jsx');
let content = fs.readFileSync(tradeFormPath, 'utf8');

// Find handleApprove and rewrite both handleApprove and handleSubmit cleanly
const targetSection = `    const handleApprove = async () => {
        if (!isConnected || !isCorrectNetwork || !balanceData) return
        setLoading(true)
        setStatus("Approving token usage...")
        try {
            const marginAddr = ADDRESSES[marginToken]
            const tx = await approveToken(marginAddr, spender)
            setStatus(\`Approval Sent: \${tx.hash}\`)
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
                setStatus(\`❌ Error: \${friendlyError}\`)
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
                    setStatus(\`Transaction Sent: \${tx.hash}\`)
                    await tx.wait()
                    setStatus(\`✅ 🕋 Halal Short Opened Successfully on-chain!\n- Quantity: \${amount} \${tradingToken}\n- 0% Interest (Riba-Free) Leveraged Short\`)
                } catch (err) {
                    console.warn("Halal short failed:", err)
                    const friendly = formatContractError(err)
                    setStatus(\`❌ Halal short failed: \${friendly}\`)
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

                setStatus(\`Transaction Sent: \${tx.hash}\`)
                await tx.wait()
                setStatus("✅ Position Opened Successfully!")
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
                setStatus(\`❌ Error: \${friendlyError}\`)
            }
        } finally {
            setLoading(false)
        }
    }`;

// Replace from `const handleApprove = async () => {` up to `const handleSimulate = async () => {`
const startIdx = content.indexOf('    const handleApprove = async () => {');
const endIdx = content.indexOf('    const handleSimulate = async () => {');

if (startIdx === -1 || endIdx === -1) {
    console.error("Could not find delimiters!");
    process.exit(1);
}

content = content.slice(0, startIdx) + targetSection + '\n\n' + content.slice(endIdx);
fs.writeFileSync(tradeFormPath, content, 'utf8');
console.log("TradeForm.jsx cleanly patched!");
