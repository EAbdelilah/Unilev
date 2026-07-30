import { useCallback } from "react"

export function useProtocol() {
    const getProtocolBalances = useCallback(async () => ({}), [])
    const getFeeDefaults = useCallback(async () => ({ treasuryFee: 0, liquidationReward: 0 }), [])
    const updateFeeDefaults = useCallback(async () => null, [])

    return { getProtocolBalances, getFeeDefaults, updateFeeDefaults }
}
