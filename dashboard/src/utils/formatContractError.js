export function isUserCancellation(error) {
    if (!error) return false;
    
    // Handle nested error structure from some providers (e.g., MetaMask via ethers)
    const nestedError = error.info?.error;
    const errorCode = error.code || nestedError?.code;
    
    const errorMsg = (error.message || error.reason || nestedError?.message || error.toString()).toLowerCase();
    
    return (
        errorCode === 'ACTION_REJECTED' || 
        errorCode === 4001 || 
        errorMsg.includes("user rejected action") || 
        errorMsg.includes("user denied transaction signature") ||
        errorMsg.includes("rejected by user") ||
        errorMsg.includes("ethers-user-denied") ||
        errorMsg.includes("user denied")
    );
}

export function formatContractError(error) {
    if (!error) return "Unknown Error";

    if (isUserCancellation(error)) {
        return "Operation was canceled by the user.";
    }

    const errorMsg = error.message || error.reason || error.toString();

    // Map of custom error names (from ABI) or text to readable messages
    const errorMap = {
        "LiquidityPool__NOT_ENOUGH_LIQUIDITY": "Not enough liquidity in the pool for this operation.",
        "PriceFeedL1__TOKEN_NOT_SUPPORTED": "This token is not supported by the price feed.",
        "PriceFeedL1__STALE_PRICE": "The price feed data is currently stale.",
        "PriceFeedL1__PRICE_TOO_OLD": "The price data is too old.",
        "PriceFeedL1__INVALID_PRICE": "The price feed returned an invalid price.",
        "PriceFeedL1__ANSWER_IN_ROUND_INVALID": "The price feed answer in round is invalid.",
        "LiquidityPoolFactory__POOL_ALREADY_EXIST": "A liquidity pool for this token already exists.",
        "LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED": "Positions contract is already defined.",
        "Positions__POSITION_NOT_OPEN": "This position is not open.",
        "Positions__POSITION_NOT_LIQUIDABLE_YET": "This position cannot be liquidated yet.",
        "Positions__POSITION_NOT_OWNED": "You do not own this position.",
        "Positions__POOL_NOT_OFFICIAL": "The specified Uniswap V3 pool is not supported.",
        "Positions__TOKEN_NOT_SUPPORTED": "This token is not supported by the protocol.",
        "Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN": "This token is not supported for margin trading.",
        "Positions__NO_PRICE_FEED": "No price feed available for the given token pair.",
        "Positions__LEVERAGE_NOT_IN_RANGE": "The specified leverage is out of the allowed range (min: 2x, max: 5x).",
        "Positions__AMOUNT_TO_SMALL": "The position size is too small; it must meet the minimum USD requirement.",
        "Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT": "Limit order price is inconsistent with the market.",
        "Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT": "Stop loss price is inconsistent with the market.",
        "Positions__NOT_LIQUIDABLE": "This position is not eligible for liquidation.",
        "Positions__WAIT_FOR_LIMIT_ORDER_TO_COMPLET": "A limit order is already pending for this position.",
        "Positions__TOKEN_RECEIVED_NOT_CONCISTENT": "Inconsistent token amount received from swap.",
        "User denied transaction signature": "Transaction was cancelled by the user.",
        "insufficient funds for gas": "Insufficient native token balance to pay for gas.",
        "ERC20: transfer amount exceeds balance": "Insufficient token balance.",
        "ERC20: transfer amount exceeds allowance": "Insufficient token allowance.", // Generic ERC20

        // --- Uniswap V4 (Unichain) hook/router errors ---
        "PositionAlreadyOpen":
            "You already have a position open on this pool. Close it before opening a new one.",
        "SwapOutputZero":
            "The swap produced zero output. This pool may lack liquidity for this size/direction.",
        "NoActivePosition": "No active position was found to close.",
        "LeverageTooHigh": "Leverage exceeds the maximum allowed (5x).",
        "MaxLeverageExceeded": "Leverage exceeds the maximum allowed (5x).",
        "InvalidLeverageRange": "Leverage is outside the allowed range.",
        "CollateralTooLow": "Position size is too small to meet the minimum collateral requirement.",
        "NotOwner": "Only the position owner can perform this action.",
        "NotAuthorizedPool": "This trading pool is not authorized in the protocol.",
        "SlippageExceeded": "Price moved more than the allowed slippage. Try again.",
        "StalePrice": "Oracle price data is stale — please retry.",
        "TwapManipulated": "Oracle TWAP looks manipulated — retrying automatically.",
        "OraclePriceOutOfBounds": "Oracle price is outside acceptable bounds — please retry.",
        "NotAdmin": "Only an admin can perform this action.",
        "Insufficient native input":
            "Insufficient native ETH to cover the full position notional (margin × leverage)."
    };

    // check if the error is a known custom error
    if (error.data && error.data.message) {
        for (const [key, msg] of Object.entries(errorMap)) {
            if (error.data.message.includes(key)) {
                return msg;
            }
        }
    }

    // check if it's stringyfied in the message or reason
    for (const [key, msg] of Object.entries(errorMap)) {
        if (errorMsg.includes(key)) {
            return msg;
        }
    }

    // Attempt to extract the custom error name if it's formatted like `ErrorName(...)`
    const customErrorMatch = errorMsg.match(/([a-zA-Z0-9_]+)\(/);
    if (customErrorMatch && customErrorMatch[1]) {
        const name = customErrorMatch[1];
        if (errorMap[name]) return errorMap[name];
        
        // If not in map, try to make the name readable
        // e.g. "LiquidityPool__NOT_ENOUGH_LIQUIDITY" -> "Not Enough Liquidity"
        const readableName = name
            .split('__').pop()
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        
        return `Protocol Error: ${readableName}`;
    }

    // If it's a generic revert, ethers sometimes puts it in `reason`
    if (error.reason) {
        return error.reason;
    }

    if (error.code === 'CALL_EXCEPTION' && !error.reason && !error.data) {
        return "Transaction execution reverted. This commonly occurs if there's insufficient liquidity or if the token pair does not have an active Uniswap pool for the entered configuration.";
    }

    // Fallback: take the first line or a short snippet
    const shortErr = errorMsg.split('\n')[0];
    if (shortErr.length > 100) {
        return shortErr.substring(0, 100) + '...';
    }

    return shortErr;
}
