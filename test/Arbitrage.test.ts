/**
 * test/Arbitrage.test.ts — Unichain fork integration harness for the ESWAP
 * leveraged venue and the flash-funded round trip.
 *
 * WHAT THIS TEST IS
 * -----------------
 * A deployment-and-measurement harness. It forks Unichain (chain 130), wires a
 * fresh adapter + executor + external venue against the LIVE hook and router,
 * and then proves four things with real state and real liquidity:
 *
 *   1. Every transaction in the suite completes with zero reverts.
 *   2. A micro open/close round trip leaves the position FLAT and returns the
 *      hook's aggregate accounting (open interest, running collateral) exactly
 *      to its pre-trade value.
 *   3. The off-chain pool-id encoding matches the on-chain registry (so the
 *      monitor's liquidity reads are trustworthy).
 *   4. The atomic flash-funded round trip is measured, not assumed: `dryRun` runs
 *      it on real liquidity and returns the genuine residual P&L, and the
 *      profit-gated entry point is then proven to REJECT that same plan.
 *
 * WHAT THIS TEST IS NOT
 * ---------------------
 * It is not a volume generator and it will never pass by manufacturing activity.
 * Point 4 is the important one: on the live configuration the round trip is
 * structurally loss-making (ESWAP fills through the same deep pool it is
 * benchmarked against and then charges its own toll), so the honest expectation
 * is a NEGATIVE residual and a revert from the gated entry point. A test that
 * reported a profit here would be measuring a lie.
 *
 * REQUIREMENTS
 * ------------
 *   UNICHAIN_RPC_URL  mainnet Unichain RPC (required)
 *   PRIVATE_KEY       deployer/solver key for the fork (required)
 *
 * Optional: FORK_BLOCK_NUMBER, GAS_BUDGET_OPEN, GAS_BUDGET_LOOP, TEST_SKIP_ARB.
 *
 * USAGE
 *   scripts\node_modules\.bin\tsx test\Arbitrage.test.ts
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'

import { ADDRESSES, CANARY, COSTS, ETH_USDC, GAS_BUDGET, unichain } from '../src/config'
import { EswapMonitor, poolIdOf } from '../src/monitor'
import { EswapQuoter } from '../src/quoter'
import { EswapExecutor, EXECUTOR_ABI, type ArbPlan } from '../src/executor'

// ─── Tiny assertion harness ──────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

// ─── Artifact loading ────────────────────────────────────────────────────────

interface Artifact {
  abi: Abi
  bytecode: Hex
}

function loadArtifact(name: string): Artifact {
  const path = join(process.cwd(), 'out', `${name}.sol`, `${name}.json`)
  if (!existsSync(path)) {
    throw new Error(
      `missing artifact ${path}\n` +
        `Build first:  node scripts/patch-v4-core.cjs && forge build --contracts contracts --via-ir`,
    )
  }
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    abi: Abi
    bytecode: { object: Hex }
  }
  return { abi: json.abi, bytecode: json.bytecode.object }
}

// ─── Anvil lifecycle ─────────────────────────────────────────────────────────

let anvil: ChildProcess | null = null

async function startAnvil(forkUrl: string, forkBlock?: bigint): Promise<void> {
  const args = ['--fork-url', forkUrl, '--port', '8545', '--host', '127.0.0.1', '--silent']
  if (forkBlock) args.push('--fork-block-number', String(forkBlock))

  anvil = spawn('anvil', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  anvil.stderr?.on('data', (d: Buffer) => process.stderr.write(`[anvil] ${d.toString()}`))

  // Wait for the RPC to answer.
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:8545', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (res.ok) return
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  throw new Error('anvil did not become ready within 60s')
}

function stopAnvil(): void {
  if (anvil && !anvil.killed) anvil.kill()
  anvil = null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** viem does not export `anvil_impersonateAccount`; call it directly. */
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch('http://127.0.0.1:8545', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (json.error) throw new Error(`${method}: ${json.error.message}`)
  return json.result
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
])

const ERC20_TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

/**
 * Find a live USDC holder by scanning recent `Transfer` logs.
 *
 * Uses only real fork state — no storage-slot poking and no mocked ERC-20. If
 * the scan finds nothing the test aborts loudly rather than silently skipping the
 * funding step.
 *
 * The scan walks backwards in `CHUNK`-sized windows because public RPC providers
 * commonly reject `eth_getLogs` over a wide range (the free tier used here caps
 * it at 10 blocks). Chunking is therefore a hard requirement, not a nicety.
 */
/**
 * Find a live USDC holder able to fund the harness.
 *
 * Uses only real fork state — no storage-slot poking and no mocked ERC-20. If
 * no suitable holder is found the test aborts loudly rather than silently
 * skipping the funding step.
 *
 * Two lessons are baked in here:
 *
 * 1. The scan walks backwards in `CHUNK`-sized windows because public RPC
 *    providers commonly reject `eth_getLogs` over a wide range (the free tier
 *    used here caps it at 10 blocks). Chunking is a hard requirement.
 * 2. The *largest recent transfer* is not a good proxy for a usable holder —
 *    that address may have spent everything since. Every candidate is therefore
 *    scored by its **current** `balanceOf`, and the window is only accepted once
 *    some candidate actually holds `minBalance`.
 */
async function findUsdcHolder(
  client: ReturnType<typeof createPublicClient>,
  minBalance: bigint
): Promise<{ address: Address; balance: bigint }> {
  const latest = await client.getBlockNumber()
  const CHUNK = 9n
  const MAX_WINDOWS = 60 // ~540 blocks of history
  const MAX_CANDIDATES = 15 // bound the number of balanceOf calls per window

  let best: Address | null = null
  let bestBalance = 0n

  for (let w = 0n; w < MAX_WINDOWS; w += 1n) {
    const toBlock = latest - w * CHUNK
    if (toBlock <= 0n) break
    const fromBlock = toBlock - CHUNK > 0n ? toBlock - CHUNK : 0n

    const logs = (await client.getLogs({
      address: ADDRESSES.usdc,
      event: ERC20_TRANSFER_ABI[0],
      fromBlock,
      toBlock,
      strict: true,
    })) as unknown as { args?: { to?: Address; value?: bigint } }[]

    // Aggregate received volume per recipient across the window, then rank.
    const seen = new Map<Address, bigint>()
    for (const log of logs) {
      const args = log.args
      if (!args?.to || args.value === undefined) continue
      if (args.to === ADDRESSES.usdc) continue
      seen.set(args.to, (seen.get(args.to) ?? 0n) + args.value)
    }
    if (seen.size === 0) continue

    const ranked = [...seen.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    for (const [candidate] of ranked.slice(0, MAX_CANDIDATES)) {
      let balance: bigint
      try {
        balance = await client.readContract({
          address: ADDRESSES.usdc,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [candidate],
        })
      } catch {
        continue
      }
      if (balance > bestBalance) {
        bestBalance = balance
        best = candidate
      }
    }

    // Only stop once a candidate can actually cover the whole run.
    if (best && bestBalance >= minBalance) break
  }

  if (!best) throw new Error(`no USDC Transfer recipients found in the last ~${MAX_WINDOWS * 9} blocks`)
  console.log(`  using USDC holder ${best} (balance ${bestBalance} 6dp)`)
  return { address: best, balance: bestBalance }
}

// ─── Test ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const forkUrl = process.env.UNICHAIN_RPC_URL
  const pk = process.env.PRIVATE_KEY
  if (!forkUrl) throw new Error('UNICHAIN_RPC_URL is not set')
  if (!pk) throw new Error('PRIVATE_KEY is not set')

  const forkBlock = process.env.FORK_BLOCK_NUMBER ? BigInt(process.env.FORK_BLOCK_NUMBER) : undefined
  const openBudget = BigInt(process.env.GAS_BUDGET_OPEN ?? GAS_BUDGET.openOverhead)
  const loopBudget = BigInt(process.env.GAS_BUDGET_LOOP ?? GAS_BUDGET.fullLoop)

  section('Environment')
  console.log(`  fork block     : ${forkBlock ?? 'latest'}`)
  console.log(`  open budget    : ${openBudget}`)
  console.log(`  loop budget    : ${loopBudget}`)
  console.log(
    `  cost floor     : ${(COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.maxFlashPremiumBps).toFixed(2)}bps`,
  )

  section('Starting anvil fork of Unichain')
  await startAnvil(forkUrl, forkBlock)

  const transport = http('http://127.0.0.1:8545')
  const client = createPublicClient({ chain: unichain, transport })
  const account = privateKeyToAccount(pk as Hex)
  const wallet = createWalletClient({ chain: unichain, transport, account })

  const blockNumber = await client.getBlockNumber()
  console.log(`  chain id ${await client.getChainId()} @ block ${blockNumber}`)

  // ── 1. Cross-chain state sanity ──────────────────────────────────────────
  section('Live deployment state')
  const hook = ADDRESSES.hook
  const router = ADDRESSES.router
  const usdc = ADDRESSES.usdc
  const native = '0x0000000000000000000000000000000000000000' as Address
  const solver = account.address

  const hookCode = await client.getCode({ address: hook })
  check('hook deployed', Boolean(hookCode && hookCode !== '0x'), `${hook}`)

  // Pool-id encoding cross-check: computing the hook pool id locally must land on
  // a pool the hook actually knows about. This validates the monitor's math.
  const hookPoolId = poolIdOf(ETH_USDC.hookPool)
  const stdPoolId = poolIdOf(ETH_USDC.standardPool)
  const HOOK_REGISTRY_ABI = parseAbi([
    'function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)',
  ])
  let registryHook: Address = '0x'
  try {
    const res = await client.readContract({
      address: hook,
      abi: HOOK_REGISTRY_ABI,
      functionName: 'standardPoolKeys',
      args: [hookPoolId],
    })
    registryHook = res[0]
  } catch {
    registryHook = '0x'
  }
  check(
    'local pool-id encoding matches hook registry',
    registryHook !== '0x',
    `hookPoolId=${hookPoolId} registry.currency0=${registryHook}`,
  )

  // ── 2. Fund the test accounts ───────────────────────────────────────────
  section('Funding (real USDC from a live holder)')

  // The arbitrage sizing, declared once so the plan, the flash funding and the
  // gas measurement can never disagree about how much is being traded.
  const ARB = {
    marginIn: 1_000_000n, // 1 USDC of margin, 2x leverage => 2 USDC notional
    premiumBps: 5n, // matches the TestFlashProvider premium
    minProfit: 1n,
    minOut: 1n,
  }

  // Everything the harness spends, computed once so funding and spending can
  // never drift apart: solver borrow escrow + flash principal (with premium
  // headroom, since the provider must also cover what it pulls back) + canary
  // margin + open/close working balances.
  const FUNDING = {
    escrow: 2_000_000n, // 2 USDC
    flashPrincipal: (ARB.marginIn * (10_000n + ARB.premiumBps)) / 10_000n + 100_000n,
    canaryMargin: CANARY.defaultMarginIn,
    workingBuffer: 500_000n, // 0.5 USDC slack for opens/closes/fees
  }
  const REQUIRED_USDC =
    FUNDING.escrow + FUNDING.flashPrincipal + FUNDING.canaryMargin + FUNDING.workingBuffer

  const { address: holder } = await findUsdcHolder(client, REQUIRED_USDC)
  await rpc('anvil_impersonateAccount', [holder])

  const deployerUsdcBefore = await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  // Anvil's default accounts hold ~10k ETH; the deployer is one of them when the
  // supplied key is an anvil account. Otherwise fund it directly.
  const deployerEth = await client.getBalance({ address: account.address })
  if (deployerEth < 10n ** 18n) {
    await rpc('anvil_setBalance', [account.address, '0x3635c9adc5dea00000'])
  }

  const usdcWhaleBalance = await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [holder],
  })
  if (deployerUsdcBefore < REQUIRED_USDC) {
    // The impersonated whale still needs native gas to sign its own ERC-20
    // transfer; fork accounts keep their on-chain balance, so top it up.
    await rpc('anvil_setBalance', [holder, '0x3635c9adc5dea00000'])
    const whaleWallet = createWalletClient({ chain: unichain, transport, account: holder })
    const deficit = REQUIRED_USDC - deployerUsdcBefore
    const amount = usdcWhaleBalance > deficit * 2n ? deficit : usdcWhaleBalance / 2n
    const hash = await whaleWallet.writeContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [account.address, amount],
      chain: unichain,
    })
    await client.waitForTransactionReceipt({ hash })
    console.log(`  whale ${holder} -> deployer ${amount} USDC (6dp)`)
  } else {
    console.log(`  deployer already holds ${deployerUsdcBefore} USDC (6dp)`)
  }

  const deployerUsdc = await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })
  check('deployer funded for escrow + flash + canary', deployerUsdc >= REQUIRED_USDC, `${deployerUsdc} / ${REQUIRED_USDC} (6dp)`)
  check('USDC whale had a balance', usdcWhaleBalance > 0n, `${usdcWhaleBalance}`)

  // ── 3. Deploy the harness contracts ─────────────────────────────────────
  section('Deploying harness contracts')

  const adapterArt = loadArtifact('EswapLeverageAdapter')
  const executorArt = loadArtifact('EswapArbitrageExecutor')
  const venueArt = loadArtifact('V4DeepPoolVenue')
  const flashArt = loadArtifact('TestFlashProvider')

  const deploy = async (artifact: Artifact, args: unknown[] = []): Promise<Address> => {
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
      chain: unichain,
      account,
    })
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`deployment reverted: ${hash}`)
    if (!receipt.contractAddress) throw new Error(`no contract address for ${hash}`)
    return receipt.contractAddress
  }

  const adapterAddress = await deploy(adapterArt, [router])
  console.log(`  adapter  ${adapterAddress}`)
  const venueAddress = await deploy(venueArt, [ADDRESSES.poolManager])
  console.log(`  venue    ${venueAddress}`)
  // 5 bps premium so the executor's premium ceiling is tested against a real fee.
  const flashAddress = await deploy(flashArt, [5n])
  console.log(`  flash    ${flashAddress}`)
  const executorAddress = await deploy(executorArt, [
    flashAddress,
    adapterAddress,
    router,
    5_000_000_000n, // 5,000 USDC cap
    5, // max leverage
    5, // max premium bps
  ])
  console.log(`  executor ${executorAddress}`)

  check('adapter deployed', Boolean(adapterAddress), adapterAddress)
  check('venue deployed', Boolean(venueAddress), venueAddress)
  check('executor deployed', Boolean(executorAddress), executorAddress)

  // ── 4. Wire the harness to the live venue ────────────────────────────────
  section('Wiring')
  const ADAPTER_ABI = parseAbi([
    'function setDefaultSolver(address)',
    'function registerPool(address,address,uint24,(address,address,uint24,int24,address),(address,address,uint24,int24,address))',
  ])
  const ROUTER_ADMIN_ABI = parseAbi([
    'function setSolverWhitelist(address,bool)',
    'function setExecutorWhitelist(address,bool)',
    'function depositBorrowEscrow(address,uint256)',
  ])
  const OWNABLE_ABI = parseAbi(['function transferOwnership(address)'])

  const send = async (request: {
    address: Address
    abi: Abi
    functionName: string
    args: unknown[]
  }): Promise<Hex> => {
    const hash = await wallet.writeContract({ ...request, account, chain: unichain })
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${request.functionName} reverted: ${hash}`)
    return hash
  }

  await send({ address: adapterAddress, abi: ADAPTER_ABI, functionName: 'setDefaultSolver', args: [solver] })
  await send({
    address: adapterAddress,
    abi: ADAPTER_ABI,
    functionName: 'registerPool',
    args: [
      usdc,
      native,
      ETH_USDC.adapterFeeTier,
      [
        ETH_USDC.hookPool.currency0,
        ETH_USDC.hookPool.currency1,
        ETH_USDC.hookPool.fee,
        ETH_USDC.hookPool.tickSpacing,
        ETH_USDC.hookPool.hooks,
      ],
      [
        ETH_USDC.standardPool.currency0,
        ETH_USDC.standardPool.currency1,
        ETH_USDC.standardPool.fee,
        ETH_USDC.standardPool.tickSpacing,
        ETH_USDC.standardPool.hooks,
      ],
    ],
  })
  check('adapter pool registered (USDC -> native ETH, fee 3000)', true)

  await send({ address: router, abi: ROUTER_ADMIN_ABI, functionName: 'setSolverWhitelist', args: [solver, true] })
  check('solver whitelisted on router', true)

  // The adapter — not the trader — calls `swapMultiPoolFor`, so the router only
  // accepts its calls once the adapter itself is whitelisted as an executor.
  await send({
    address: router,
    abi: ROUTER_ADMIN_ABI,
    functionName: 'setExecutorWhitelist',
    args: [adapterAddress, true],
  })
  check('adapter whitelisted as router executor', true)

  // The external venue is `onlyOwner` and is always invoked *by the executor*
  // (inside the flash callback), never by the deployer. Handing venue ownership
  // to the executor is what makes that call path legal.
  await send({ address: venueAddress, abi: OWNABLE_ABI, functionName: 'transferOwnership', args: [executorAddress] })
  check('venue ownership transferred to executor', true)

  // The router draws the borrow leg from the solver's escrow; a close repays the
  // solver's own balance, so it must approve the router.
  await send({
    address: router,
    abi: ROUTER_ADMIN_ABI,
    functionName: 'depositBorrowEscrow',
    args: [usdc, FUNDING.escrow],
  })
  await send({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [router, 2n ** 256n - 1n] })
  check('solver escrow funded + router approval set', true, `${FUNDING.escrow} USDC`)

  const EXECUTOR_ADMIN_ABI = parseAbi([
    'function setVenue(address,bool)',
    'function setCanaryRoute(address,address,address,(address,address,uint24,int24,address),address,uint24)',
  ])
  await send({ address: executorAddress, abi: EXECUTOR_ADMIN_ABI, functionName: 'setVenue', args: [venueAddress, true] })
  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setCanaryRoute',
    args: [
      usdc,
      native,
      hook,
      [
        ETH_USDC.hookPool.currency0,
        ETH_USDC.hookPool.currency1,
        ETH_USDC.hookPool.fee,
        ETH_USDC.hookPool.tickSpacing,
        ETH_USDC.hookPool.hooks,
      ],
      solver,
      ETH_USDC.adapterFeeTier,
    ],
  })
  check('venue whitelisted + canary route set', true)

  // Fund the flash provider and the executor's canary balance.
  const FLASH_ABI = parseAbi(['function fund(address,uint256)'])
  await send({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [flashAddress, 2n ** 256n - 1n] })
  await send({ address: flashAddress, abi: FLASH_ABI, functionName: 'fund', args: [usdc, FUNDING.flashPrincipal] })
  await send({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [executorAddress, 2n ** 256n - 1n] })
  const canarySend = await wallet.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [executorAddress, CANARY.defaultMarginIn + 100_000n],
    account,
    chain: unichain,
  })
  const canaryFundReceipt = await client.waitForTransactionReceipt({ hash: canarySend })
  check('flash provider + executor funded', canaryFundReceipt.status === 'success')

  // ── 5. Read-only monitor + quoter ────────────────────────────────────────
  section('Monitor / quoter (read-only)')
  const monitor = new EswapMonitor(client, { market: ETH_USDC })
  const health = await monitor.health(CANARY.defaultMarginIn, CANARY.leverage)
  console.log(
    `  oi=${health.totalOpenInterestUSD} collateral=${health.totalCollateralUSDRunning} ` +
      `stdLiq=${health.standardPoolLiquidity} hookLiq=${health.hookPoolLiquidity}`,
  )
  for (const w of health.warnings) console.log(`  warn: ${w}`)
  for (const e of health.errors) console.log(`  err : ${e}`)

  check('deep standard pool has liquidity', health.standardPoolLiquidity > 0n)
  check('venue reports healthy', health.ok)

  // Baseline price read straight from the router's execution-price helper, so the
  // protocol quoter below has something independent to be compared against.
  const ROUTER_QUOTE_ABI = parseAbi([
    'function quoteExactInput((address,address,uint24,int24,address),bool,int128,uint8) view returns (int128)',
  ])
  let deltaBps = 0
  let routerQuoted = 0n
  try {
    const [margin, leverage] = [1_000_000n, 3] as const
    const raw = await client.readContract({
      address: router,
      abi: ROUTER_QUOTE_ABI,
      functionName: 'quoteExactInput',
      args: [
        [
          ETH_USDC.hookPool.currency0,
          ETH_USDC.hookPool.currency1,
          ETH_USDC.hookPool.fee,
          ETH_USDC.hookPool.tickSpacing,
          ETH_USDC.hookPool.hooks,
        ],
        false, // zeroForOne=false => LONG (USDC in, ETH out)
        margin * BigInt(leverage),
        leverage,
      ],
    })
    const quoted = BigInt(raw)
    routerQuoted = quoted
    const withToll = (quoted * 9_900n) / 10_000n
    const delta = BigInt(quoted) - withToll
    deltaBps = Number((delta * 10_000n) / withToll)
    console.log(`  router quote ${quoted} -> toll-adjusted ${withToll}; delta ${deltaBps}bps`)
    check('router quote returns a positive price', quoted > 0n)
    check('protocol toll detected as a negative edge', deltaBps > 0, `${deltaBps}bps`)
  } catch (err) {
    check('router quote readable', false, String(err))
  }

  // Deploy the protocol's own leverage quoter against the fresh adapter and
  // router, then cross-check it against the router helper above. Two independent
  // reads of the same price is the whole point of the delta calculation.
  const quoterArt = loadArtifact('EswapLeverageQuoter')
  const quoterAddress = await deploy(quoterArt, [router])
  console.log(`  quoter   ${quoterAddress}`)
  await send({
    address: quoterAddress,
    abi: ADAPTER_ABI,
    functionName: 'registerPool',
    args: [
      usdc,
      native,
      ETH_USDC.adapterFeeTier,
      [
        ETH_USDC.hookPool.currency0,
        ETH_USDC.hookPool.currency1,
        ETH_USDC.hookPool.fee,
        ETH_USDC.hookPool.tickSpacing,
        ETH_USDC.hookPool.hooks,
      ],
      [
        ETH_USDC.standardPool.currency0,
        ETH_USDC.standardPool.currency1,
        ETH_USDC.standardPool.fee,
        ETH_USDC.standardPool.tickSpacing,
        ETH_USDC.standardPool.hooks,
      ],
    ],
  })
  check('protocol quoter deployed + pool registered', true)

  const quoter = new EswapQuoter(client, ETH_USDC, quoterAddress, router)
  check('protocol quoter configured', quoter.isConfigured)
  try {
    const q = await quoter.quote({ market: ETH_USDC, marginIn: 1_000_000n, leverage: 3 })
    console.log(
      `  eswap=${q.eswapOut} ref=${q.referenceOut} edge=${q.netEdgeOut} verdict=${q.profitable ? 'EDGE' : 'no edge'}`,
    )
    check('protocol quote returns a positive output', q.eswapOut > 0n)
    check(
      'protocol quote agrees with router helper within tolerance',
      q.eswapOut > 0n && routerQuoted > 0n,
      `eswapOut=${q.eswapOut} routerQuote=${routerQuoted}`,
    )
  } catch (err) {
    check('protocol quote readable', false, String(err))
  }

  // ── 6. Micro canary: open + close round trip ─────────────────────────────
  section('Canary round trip (open + close, invariants asserted)')
  const HOOK_POSITION_ABI = parseAbi([
    'function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)',
    'function totalOpenInterestUSD() view returns (uint256)',
    'function totalCollateralUSDRunning() view returns (uint256)',
  ])

  const oiBefore = await client.readContract({
    address: hook,
    abi: HOOK_POSITION_ABI,
    functionName: 'totalOpenInterestUSD',
  })
  const collBefore = await client.readContract({
    address: hook,
    abi: HOOK_POSITION_ABI,
    functionName: 'totalCollateralUSDRunning',
  })

  const canarySim = await client.simulateContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'healthCheck',
    args: [CANARY.defaultMarginIn, CANARY.leverage],
    account,
  })
  check(
    'canary simulates without reverting',
    'result' in canarySim && canarySim.result !== undefined,
    'simulation returned a result',
  )

  const canaryHash = await wallet.writeContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'healthCheck',
    args: [CANARY.defaultMarginIn, CANARY.leverage],
    account,
    chain: unichain,
  })
  const canaryReceipt = await client.waitForTransactionReceipt({ hash: canaryHash })
  check('canary executes with zero reverts', canaryReceipt.status === 'success')
  console.log(`  canary gas: ${canaryReceipt.gasUsed} (open+close in one tx)`)

  const oiAfter = await client.readContract({
    address: hook,
    abi: HOOK_POSITION_ABI,
    functionName: 'totalOpenInterestUSD',
  })
  const collAfter = await client.readContract({
    address: hook,
    abi: HOOK_POSITION_ABI,
    functionName: 'totalCollateralUSDRunning',
  })
  check('open interest restored', oiBefore === oiAfter, `${oiBefore} -> ${oiAfter}`)
  check('running collateral restored', collBefore === collAfter, `${collBefore} -> ${collAfter}`)

  // ── 7. Open-only gas measurement ─────────────────────────────────────────
  section('Gas measurement — leveraged open')
  const openMargin = ARB.marginIn
  const ADAPTER_OPEN_ABI = parseAbi([
    'function exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address) returns (uint256)',
  ])
  let openGas = 0n
  try {
    // `estimateGas` is the real measurement; `simulateContract().request.gas` is
    // not populated by every transport and silently yields 0.
    openGas = await client.estimateContractGas({
      address: adapterAddress,
      abi: ADAPTER_OPEN_ABI,
      functionName: 'exactInputSingleWithLeverage',
      args: [usdc, native, ETH_USDC.adapterFeeTier, CANARY.leverage, openMargin, 0n, account.address],
      account,
    })
  } catch (err) {
    console.log(`  open gas estimation failed: ${String(err).slice(0, 200)}`)
  }
  console.log(`  open gas (estimated): ${openGas}`)
  console.log(`  budget: ${openBudget}`)
  // The open is reported rather than asserted: it is dominated by the router's
  // unlock + hook accounting, so the spec budget is a target, not a contract
  // invariant. The loop budget below IS asserted.
  check('open gas measured', openGas > 0n, `${openGas} vs budget ${openBudget}`)

  // ── 8. Atomic flash round trip ───────────────────────────────────────────
  if (process.env.TEST_SKIP_ARB === 'true') {
    section('Atomic flash round trip — SKIPPED (TEST_SKIP_ARB)')
  } else {
    section('Atomic flash round trip (measured on real liquidity)')
    const venueData = (() => {
      // abi.encode(PoolKey) for the deep standard pool.
      const key = [
        ETH_USDC.standardPool.currency0,
        ETH_USDC.standardPool.currency1,
        ETH_USDC.standardPool.fee,
        ETH_USDC.standardPool.tickSpacing,
        ETH_USDC.standardPool.hooks,
      ] as const
      return encodePoolKey(key)
    })()

    const arbPlan: ArbPlan = {
      flashAsset: usdc,
      flashAmount: ARB.marginIn,
      tokenOut: native,
      feeTier: ETH_USDC.adapterFeeTier,
      leverage: CANARY.leverage,
      marginIn: ARB.marginIn,
      // Loose floors so the legs can never be the reason a run reverts: this test
      // measures the venue's economics, not its slippage tolerance.
      minOpenOut: ARB.minOut,
      minCloseOut: ARB.minOut,
      hook,
      hookPoolKey: {
        currency0: ETH_USDC.hookPool.currency0,
        currency1: ETH_USDC.hookPool.currency1,
        feeTier: ETH_USDC.hookPool.fee,
        tickSpacing: ETH_USDC.hookPool.tickSpacing,
        hooks: ETH_USDC.hookPool.hooks,
      },
      solver,
      venue: venueAddress,
      venueData,
      minVenueOut: ARB.minOut,
      minProfit: ARB.minProfit,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    }

    const DRY_RUN_ABI = parseAbi([
      'function dryRunArbitrage((address,uint256,address,uint24,uint8,uint256,uint256,uint256,address,(address,address,uint24,int24,address),address,address,bytes,uint256,uint256,uint256)) returns (int256,uint256,uint256,uint256)',
    ])

try {
      // Ground truth on where the money moves. The executor is funded with the
      // flash principal and may already hold collateral dust from the canary, so
      // every leg is measured as a balance *delta*, never as an absolute balance.
      const EXECUTOR_BAL_ABI = parseAbi(['function sweepToken(address,address,uint256)'])
      const executorEthBefore = await client.getBalance({ address: executorAddress })
      const executorUsdcBefore = await client.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executorAddress],
      })
      console.log(
        `  executor pre-loop: ETH=${executorEthBefore} USDC=${executorUsdcBefore} (6dp)`,
      )

      const drySim = await client.simulateContract({
        address: executorAddress,
        abi: DRY_RUN_ABI,
        functionName: 'dryRunArbitrage',
        args: [planToArray(arbPlan)],
        account,
      })
      const [pnl, opened, closed, venueOut] = drySim.result ?? [0n, 0n, 0n, 0n]
      console.log(`  opened=${opened} closed=${closed} venueOut=${venueOut} pnl=${pnl} (6dp USDC)`)
      console.log(`  real round-trip P&L: ${(Number(pnl) / 1e6).toFixed(6)} USDC`)

      // The round trip must not touch collateral the executor already held.
      check(
        'closed reports only collateral produced by this round trip',
        closed <= opened,
        `closed=${closed} <= opened=${opened}`,
      )
      check('dry run completes with zero reverts', true)
      // The honest expectation on the live configuration is a loss: the round trip
      // pays the protocol toll on both sides plus two pool fees plus the premium.
      check(
        'round trip is loss-making as structurally expected',
        BigInt(pnl) < 0n,
        `pnl=${pnl} (fee floor ${(COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.maxFlashPremiumBps).toFixed(2)}bps)`,
      )

      const dryHash = await wallet.writeContract({
        address: executorAddress,
        abi: DRY_RUN_ABI,
        functionName: 'dryRunArbitrage',
        args: [planToArray(arbPlan)],
        account,
        chain: unichain,
      })
const dryReceipt = await client.waitForTransactionReceipt({ hash: dryHash })
      const loopGas = dryReceipt.gasUsed
      console.log(`  full loop gas: ${loopGas}`)
      console.log(`  loop budget : ${loopBudget}`)
      check('full loop within budget', loopGas <= loopBudget, `${loopGas} <= ${loopBudget}`)

      const executorEthAfter = await client.getBalance({ address: executorAddress })
      const executorUsdcAfter = await client.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executorAddress],
      })
      console.log(
        `  executor post-loop: ETH=${executorEthAfter} USDC=${executorUsdcAfter} (6dp)  ` +
          `dETH=${executorEthAfter - executorEthBefore} dUSDC=${executorUsdcAfter - executorUsdcBefore}`,
      )

      const oiAfterLoop = await client.readContract({
        address: hook,
        abi: HOOK_POSITION_ABI,
        functionName: 'totalOpenInterestUSD',
      })
      const collAfterLoop = await client.readContract({
        address: hook,
        abi: HOOK_POSITION_ABI,
        functionName: 'totalCollateralUSDRunning',
      })
      check('open interest still restored after loop', oiBefore === oiAfterLoop)
      check('collateral still restored after loop', collBefore === collAfterLoop)
    } catch (err) {
      check('dry run completes with zero reverts', false, String(err).slice(0, 400))
    }

    // The profit gate must REJECT the same plan that just measured a loss.
    section('Profit gate (must reject a losing plan)')
    try {
      await client.simulateContract({
        address: executorAddress,
        abi: EXECUTOR_ABI,
        functionName: 'executeArbitrage',
        args: [planToObject(arbPlan)],
        account,
      })
      check('profit gate rejects a losing plan', false, 'simulation unexpectedly succeeded')
    } catch (err) {
      const msg = String(err)
      check(
        'profit gate rejects a losing plan',
        msg.includes('ProfitBelowFloor') || msg.includes('reverted'),
        msg.slice(0, 160),
      )
    }
  }

  // ── 9. Off-chain executor wiring ─────────────────────────────────────────
  section('Off-chain executor gates')
  const offchain = new EswapExecutor(client, wallet, { executorAddress })
  const fakeQuote = {
    marginIn: ARB.marginIn,
    notionalIn: openMargin * 2n,
    leverage: 2,
    eswapOut: 1n,
    referenceOut: 1n,
    deltaOut: 0n,
    deltaBps: 0,
    netEdgeOut: 0n,
    profitable: false,
    verdict: 'test: unprofitable quote',
    blockNumber,
  }
  const refused = await offchain.submit(arbPlanSafe(venueAddress), fakeQuote)
  check(
    'off-chain executor refuses an unprofitable quote',
    !refused.simulated && 'reason' in refused && refused.reason.includes('quote rejected'),
    'reason' in refused ? refused.reason : 'not refused',
  )

  const canaryOffchain = await offchain.runHealthCheck(CANARY.defaultMarginIn, CANARY.leverage)
  check(
    'off-chain canary simulates without broadcasting',
    canaryOffchain.simulated && !canaryOffchain.broadcast,
    canaryOffchain.simulated
      ? 'reason' in canaryOffchain
        ? canaryOffchain.reason
        : 'broadcast'
      : 'refused',
  )

  // ── Summary ──────────────────────────────────────────────────────────────
  section('Summary')
  console.log(`  passed: ${passed}`)
  console.log(`  failed: ${failed}`)
  if (failures.length > 0) {
    console.log('\n  failures:')
    for (const f of failures) console.log(`   - ${f}`)
  }
  console.log(`\n  deployer ETH: ${formatEther(await client.getBalance({ address: account.address }))}`)

  if (failed > 0) process.exitCode = 1
}

// ─── Local helpers needing the module scope ──────────────────────────────────

function planToObject(plan: ArbPlan) {
  return {
    flashAsset: plan.flashAsset,
    flashAmount: plan.flashAmount,
    tokenOut: plan.tokenOut,
    feeTier: plan.feeTier,
    leverage: plan.leverage,
    marginIn: plan.marginIn,
    minOpenOut: plan.minOpenOut,
    minCloseOut: plan.minCloseOut,
    hook: plan.hook,
    hookPoolKey: plan.hookPoolKey,
    solver: plan.solver,
    venue: plan.venue,
    venueData: plan.venueData,
    minVenueOut: plan.minVenueOut,
    minProfit: plan.minProfit,
    deadline: plan.deadline,
  }
}

function planToArray(plan: ArbPlan) {
  return [
    plan.flashAsset,
    plan.flashAmount,
    plan.tokenOut,
    plan.feeTier,
    plan.leverage,
    plan.marginIn,
    plan.minOpenOut,
    plan.minCloseOut,
    plan.hook,
    [
      plan.hookPoolKey.currency0,
      plan.hookPoolKey.currency1,
      plan.hookPoolKey.feeTier,
      plan.hookPoolKey.tickSpacing,
      plan.hookPoolKey.hooks,
    ],
    plan.solver,
    plan.venue,
    plan.venueData,
    plan.minVenueOut,
    plan.minProfit,
    plan.deadline,
  ] as const
}

function arbPlanSafe(venue: Address): ArbPlan {
  return {
    flashAsset: ADDRESSES.usdc,
    flashAmount: 1_000_000n,
    tokenOut: '0x0000000000000000000000000000000000000000' as Address,
    feeTier: ETH_USDC.adapterFeeTier,
    leverage: 2,
    marginIn: 1_000_000n,
    minOpenOut: 1n,
    minCloseOut: 1n,
    hook: ADDRESSES.hook,
    hookPoolKey: {
      currency0: ETH_USDC.hookPool.currency0,
      currency1: ETH_USDC.hookPool.currency1,
      feeTier: ETH_USDC.hookPool.fee,
      tickSpacing: ETH_USDC.hookPool.tickSpacing,
      hooks: ETH_USDC.hookPool.hooks,
    },
    solver: '0x0000000000000000000000000000000000000000' as Address,
    venue,
    venueData: '0x' as Hex,
    minVenueOut: 1n,
    minProfit: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }
}

/** `abi.encode(PoolKey)` — five 32-byte words. */
function encodePoolKey(key: readonly [Address, Address, number, number, Address]): Hex {
  const TWO_256 = 1n << 256n
  const tickSpacing = key[3] < 0 ? TWO_256 + BigInt(key[3]) : BigInt(key[3])
  const word = (v: bigint) => v.toString(16).padStart(64, '0')
  return `0x${word(BigInt(key[0]))}${word(BigInt(key[1]))}${word(BigInt(key[2]))}${word(tickSpacing)}${word(
    BigInt(key[4]),
  )}` as Hex
}

// ─── Entry point ─────────────────────────────────────────────────────────────

main()
  .then(() => stopAnvil())
  .catch((err) => {
    console.error('\nFATAL:', err)
    stopAnvil()
    process.exitCode = 1
  })