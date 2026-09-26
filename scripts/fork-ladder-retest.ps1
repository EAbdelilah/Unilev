# fork-ladder-retest.ps1
# [ONE-SHOT RETEST] Make the two V4-fork suites consume ZERO Alchemy quota on
# this retest run:
#   - ladder becomes [free-unichain, free-eth, UNICHAIN_RPC_URL env, ETH_RPC_URL env]
#   - the bound becomes r < 4 (walk all four slots until one works)
# Alchemy URLs from .env are still honoured, but only as LAST-resort slots
# (2 and 3), so a plain `forge test` on a machine with Alchemy configured
# now probes the free public tiers first and only falls through to Alchemy
# if the free tier is unreachable. No quota is spent just to re-run.
$ErrorActionPreference = "Stop"
$enc = New-Object System.Text.UTF8Encoding($false, $true)   # strict decode on read, UTF8-no-BOM on write

function Fix-Ladder([string] $file, [string] $anchor0, [string] $anchor1, [string] $bound) {
    $p = Get-ChildItem src -Recurse -Filter $file -File | Select-Object -First 1
    if (-not $p) { Write-Output ("!! not found: " + $file); return }
    $txt = $enc.GetString([IO.File]::ReadAllBytes($p.FullName))
    $did = $false

    if ($txt.Contains($anchor0)) {
        $newLadder = @'
        // [CRIT-SYS-01 RETEST] Free public tiers first so a fork rerun does
        // not spend Alchemy quota; the .env Alchemy URLs are kept ONLY as
        // last-resort slots (2..3). Free tier: Unichain + Ethereum publicnode.
        string[4] memory rpcCandidates;
        rpcCandidates[0] = "https://unichain-rpc.publicnode.com";
        rpcCandidates[1] = "https://ethereum-rpc.publicnode.com";
        rpcCandidates[2] = vm.envOr("UNICHAIN_RPC_URL", string(""));
        rpcCandidates[3] = vm.envOr("ETH_RPC_URL", string(""));
'@
        $txt = $txt.Replace($anchor0, $newLadder)
        $did = $true
        Write-Output ("  [" + $file + "] ladder replaced (4-slot, free-first)")
    } else {
        Write-Output ("  [" + $file + "] ladder anchor0 missing - SKIPPED ladder edit")
    }

    if ($txt.Contains($anchor1)) {
        $txt = $txt.Replace($anchor1, $bound)
        Write-Output ("  [" + $file + "] loop bound widened -> " + $bound.Trim())
        $did = $true
    } else {
        Write-Output ("  [" + $file + "] bound anchor missing - SKIPPED bound edit")
    }

    if ($did) {
        [IO.File]::WriteAllText($p.FullName, $txt, $enc)
        Write-Output ("  [" + $file + "] written.")
    }
    Write-Output ""
}

# --- EswapMainnetV4ForkTest.t.sol ---
Fix-Ladder "EswapMainnetV4ForkTest.t.sol" `
    'rpcCandidates[0] = vm.envOr("UNICHAIN_RPC_URL", string(""));
        rpcCandidates[1] = vm.envOr("ETH_RPC_URL", string(""));' `
    'for (uint256 r = 0; r < 2 && !rpcAvailable; r++) {' `
    'for (uint256 r = 0; r < 4 && !rpcAvailable; r++) {'

# --- EswapMainnetV4LiquidationForkTest.t.sol (may use slightly different env names) ---
Fix-Ladder "EswapMainnetV4LiquidationForkTest.t.sol" `
    'rpcCandidates[0] = vm.envOr("UNICHAIN_RPC_URL", string(""));
        rpcCandidates[1] = vm.envOr("ETH_RPC_URL", string(""));' `
    'for (uint256 r = 0; r < 2 && !rpcAvailable; r++) {' `
    'for (uint256 r = 0; r < 4 && !rpcAvailable; r++) {'

Write-Output ("=== verify (what forge now reads) ===")
Get-ChildItem src -Recurse -Include "EswapMainnetV4ForkTest.t.sol","EswapMainnetV4LiquidationForkTest.t.sol" -File | ForEach-Object {
    Write-Output ("--- " + $_.Name + " ---")
    Select-String -LiteralPath $_.FullName -Pattern 'rpcCandidates\[|rpcCandidates[0] = "|r < 4' | ForEach-Object {
        Write-Output ("  L" + $_.LineNumber + ": " + $_.Line.Trim().Substring(0, [Math]::Min(92, $_.Line.Trim().Length)))
    }
    Write-Output ""
}
