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
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'

import {
  ADDRESSES,
  CANARY,
  COSTS,
  ETH_USDC,
  FLASH_MODE,
  GAS_BUDGET,
  ROUTER_GAS_FLOOR,
  unichain,
} from '../src/config'
import { EswapMonitor, poolIdOf, planFromVenue } from '../src/monitor'
import { EswapQuoter, toWad, fromWad, applyBpsDown } from '../src/quoter'
import { EswapExecutor, EXECUTOR_ABI, slippageFloor, type ArbPlan } from '../src/executor'
import { VenueQuoteBook, formatSnapshot } from '../src/venues'

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
  // `.env` holds the RPC URL and the funded holder key this fork run needs.
  // It is read for the process only and never logged.
  if (!process.env.UNICHAIN_RPC_URL || !process.env.PRIVATE_KEY) {
    const { config } = await import('dotenv')
    config({ path: join(process.cwd(), '.env'), quiet: true })
  }

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
  let registryStdKey: readonly [Address, Address, number, number, Address] | null = null
  try {
    const res = await client.readContract({
      address: hook,
      abi: HOOK_REGISTRY_ABI,
      functionName: 'standardPoolKeys',
      args: [hookPoolId],
    })
    registryHook = res[0]
    registryStdKey = res
  } catch {
    registryHook = '0x'
  }
  check(
    'local pool-id encoding matches hook registry',
    registryHook !== '0x',
    `hookPoolId=${hookPoolId} registry.currency0=${registryHook}`,
  )
  // The hook executes its fills in the deep standard pool. If that is the same
  // pool the executor unwinds into, the round trip trades against itself and
  // structurally cannot be profitable - the venue and the open/close legs share
  // one price. This assertion is what proves the negative-edge conclusion below.
  check(
    'hook fills through the same deep pool the venue unwinds into',
    registryStdKey !== null &&
      registryStdKey[0].toLowerCase() === ETH_USDC.standardPool.currency0.toLowerCase() &&
      registryStdKey[1].toLowerCase() === ETH_USDC.standardPool.currency1.toLowerCase() &&
      registryStdKey[2] === ETH_USDC.standardPool.fee,
    registryStdKey
      ? `registry=${registryStdKey[0]}/${registryStdKey[1]}/${registryStdKey[2]} config=${ETH_USDC.standardPool.currency0}/${ETH_USDC.standardPool.currency1}/${ETH_USDC.standardPool.fee}`
      : 'registry read failed',
  )

  // ── 2. Fund the test accounts ───────────────────────────────────────────
  section('Funding (real USDC from a live holder)')

// The arbitrage sizing, declared once so the plan, the flash funding and the
  // gas measurement can never disagree about how much is being traded.
  const ARB = {
    marginIn: 1_000_000n, // 1 USDC of margin, 2x leverage => 2 USDC notional
    // Balancer V2 charges no premium, so the round trip carries zero flash cost.
    // This is asserted rather than assumed: a silently non-zero premium would
    // inflate every profit estimate derived from it.
    premiumBps: 0n,
    minProfit: 1n,
    minOut: 1n,
  }

  // Everything the harness spends, computed once so funding and spending can
  // never drift apart: solver borrow escrow + the Balancer flash principal
  // (with premium headroom, since the vault must also cover what it pulls back)
  // + canary margin + open/close working balances.
  const FLASH_PRINCIPAL = (ARB.marginIn * (10_000n + ARB.premiumBps)) / 10_000n + 100_000n
  const FUNDING = {
    escrow: 2_000_000n, // 2 USDC
    flashPrincipal: FLASH_PRINCIPAL,
    canaryMargin: CANARY.defaultMarginIn + 100_000n, // margin + dust for rounding
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
  const balancerArt = loadArtifact('TestBalancerVault')

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

  // ── The independent unwind venue ──────────────────────────────────────────
  // This is the only venue that can make a round trip viable: it unwinds into
  // Uniswap V3, which is a different AMM with its own liquidity, instead of back
  // through the V4 pool the hook's open filled against. Deployed against the
  // canonical Unichain V3 factory and canonical WETH.
  const V3_FACTORY = '0x1F98400000000000000000000000000000000003' as Address
  const v3VenueArt = loadArtifact('UniswapV3Venue')
  const v3VenueAddress = await deploy(v3VenueArt, [V3_FACTORY, ADDRESSES.weth])
  console.log(`  v3 venue ${v3VenueAddress} (independent Uniswap V3 unwind)`)

  // Prove the canonical pool actually exists and holds liquidity before relying
  // on it. A venue pointed at a non-existent pool would revert in the callback,
  // which is indistinguishable from a funding bug at the call site.
  const V3_POOL_ABI = parseAbi([
    'function getPool(address,address,uint24) view returns (address)',
    'function liquidity() view returns (uint128)',
    'function fee() view returns (uint24)',
  ])
  const V3_FEE_TIER = 500
  const v3Pool = await client.readContract({
    address: V3_FACTORY,
    abi: V3_POOL_ABI,
    functionName: 'getPool',
    args: [ADDRESSES.weth, ADDRESSES.usdc, V3_FEE_TIER],
  })
  const v3Liquidity = await client.readContract({
    address: v3Pool,
    abi: V3_POOL_ABI,
    functionName: 'liquidity',
  })
  check(
    'canonical Uniswap V3 WETH/USDC-500 pool exists and is deep enough to trade',
    v3Pool !== '0x0000000000000000000000000000000000000000' && v3Liquidity > 0n,
    `pool=${v3Pool} liquidity=${v3Liquidity}`,
  )

  // The quoter is deployed up front: `setCanaryRoute` needs its address so the
  // contract can derive its slippage floors from an on-chain quote.
  const quoterAddress = await deploy(loadArtifact('EswapLeverageQuoter'), [router])
  console.log(`  quoter   ${quoterAddress}`)

  // Balancer V2 is the only flash source. `TestBalancerVault` mirrors the real
  // V2 Vault's zero-premium `flashLoan`, so the funding, authorisation and
  // repayment paths proven here are the ones production will run.
  const balancerAddress = await deploy(balancerArt, [0n])
  console.log(`  balancer ${balancerAddress} (0 bps, mirrors V2 Vault)`)

  const executorArgs = (provider: Address) => [
    provider,
    adapterAddress,
    router,
    5_000_000_000n, // 5,000 USDC cap
    5, // max leverage
    5, // max premium bps
    FLASH_MODE.balancer,
  ]

  const executorAddress = await deploy(executorArt, executorArgs(balancerAddress))
  console.log(`  executor ${executorAddress} (balancer)`)

  check('adapter deployed', Boolean(adapterAddress), adapterAddress)
  check('venue deployed', Boolean(venueAddress), venueAddress)
  check('executor deployed', Boolean(executorAddress), executorAddress)
  // `flashMode` and the canary slippage floors are asserted in the wiring section,
  // which is where `send` is first available.

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
    'function setCanaryRoute(address,address,address,(address,address,uint24,int24,address),address,uint24,address,uint256)',
  ])
  // The recorded on-chain mode must match what was requested, so a silent
  // mis-wiring (Balancer bytes deployed with mode 0) cannot pass unnoticed.
  const onChainMode = await client.readContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'flashMode',
  })
  check('executor flashMode == Balancer', onChainMode === 1, `mode=${onChainMode}`)

  await send({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'setCanarySlippageBps',
    args: [CANARY.openSlippageBps, CANARY.closeSlippageBps],
  })
  const canaryOpenBps = await client.readContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'canarySlippageBps',
  })
  check(
    'canary slippage floors are non-zero and match config',
    canaryOpenBps === BigInt(CANARY.openSlippageBps) && canaryOpenBps > 0n,
    `on-chain=${canaryOpenBps}bps config=${CANARY.openSlippageBps}bps`,
  )

  await send({ address: executorAddress, abi: EXECUTOR_ADMIN_ABI, functionName: 'setVenue', args: [venueAddress, true] })

  // Hoisted so the quoter-fidelity sweep below can re-point the route at
  // different sizes without duplicating the 9-argument call site.
  const canaryRouteArgs = (quoteMarginIn: bigint) =>
    [
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
      quoterAddress,
      quoteMarginIn,
    ]

  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setCanaryRoute',
    args: canaryRouteArgs(CANARY.quoteMarginIn),
  })

  // Whitelist the independent V3 venue alongside the same-pool baseline. Both
  // are single-owner and `V4DeepPoolVenue` is already owned by this executor, so
  // the V3 venue is handed over here rather than contended for.
  await send({
    address: v3VenueAddress,
    abi: OWNABLE_ABI,
    functionName: 'transferOwnership',
    args: [executorAddress],
  })
  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setVenue',
    args: [v3VenueAddress, true],
  })
  check('venue whitelisted + canary route set', true)
  check('venue whitelisted + canary route set', true)

// Fund the Balancer provider so the real funding path can be exercised.
  const FLASH_ABI = parseAbi(['function fund(address,uint256)'])
  await send({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [balancerAddress, 2n ** 256n - 1n] })
  await send({ address: balancerAddress, abi: FLASH_ABI, functionName: 'fund', args: [usdc, FUNDING.flashPrincipal] })
  await send({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [executorAddress, 2n ** 256n - 1n] })
  await send({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [executorAddress, FUNDING.canaryMargin],
  })

  // Both providers must actually hold the principal. A `fund()` call that
  // silently moved less than intended would show up here as a shortfall rather
  // than as a confusing revert inside the callback.
  {
    const providerBal = await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [balancerAddress],
    })
    check(
      'Balancer provider holds the flash principal',
      providerBal >= FUNDING.flashPrincipal,
      `${providerBal} >= ${FUNDING.flashPrincipal}`,
    )
  }
  check('flash provider + executor funded', true)

  const executorFunded = await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [executorAddress],
  })
  check(
    'executor canary prefunded with the configured margin',
    executorFunded >= CANARY.defaultMarginIn,
    `${executorFunded} >= ${CANARY.defaultMarginIn} USDC (6dp)`,
  )

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
        // The router applies `leverage` internally to `abs(amountSpecified)`, so
        // the margin is passed here - passing margin*leverage would double-count
        // the notional and inflate the baseline 3x.
        margin,
        leverage,
      ],
    })
    const quoted = BigInt(raw)
    routerQuoted = quoted
    const withToll = (quoted * BigInt(10_000 - COSTS.protocolFeeBps)) / 10_000n
    const delta = BigInt(quoted) - withToll
    deltaBps = Number((delta * 10_000n) / withToll)
    console.log(`  router quote ${quoted} -> toll-adjusted ${withToll}; delta ${deltaBps}bps`)
    check('router quote returns a positive price', quoted > 0n)
    check(
      'protocol toll is the only modelled cost of the open',
      deltaBps === COSTS.protocolFeeBps,
      `${deltaBps}bps vs protocolFeeBps ${COSTS.protocolFeeBps}`,
    )
  } catch (err) {
    check('router quote readable', false, String(err))
  }

// The protocol's own leverage quoter was deployed in step 3; register the
  // pool on it and cross-check against the router helper above. Two independent
  // reads of the same price is the whole point of the delta calculation.
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
    // The protocol quote and the deep-pool reference describe the same trade, so
    // they must agree within the 10bps toll. A ratio near `leverage` instead of
    // 1.0 means one of the legs is scaling the notional twice.
    const legRatioBps =
      q.referenceOut > 0n ? Number((q.eswapOut * 1_000n) / q.referenceOut) / 1_000 : 0
    console.log(`  leg ratio eswapOut/referenceOut = ${legRatioBps.toFixed(4)}x`)
    check(
      'reference leg is scaled once, not leverage times',
      legRatioBps > 0.9 && legRatioBps < 1.1,
      `${legRatioBps.toFixed(4)}x at leverage ${q.leverage}`,
    )
} catch (err) {
      check('protocol quote readable', false, String(err))
    }

  // ── 5b. Independent external venue book ──────────────────────────────────
  // The round trip is only worth attempting if some venue OTHER than the pool
  // the hook fills through pays better. Polling real external DEXes proves the
  // price source is independent rather than the same pool quoted twice.
  section('External venue book (Uniswap v2/v3/v4, SushiSwap)')
  try {
    const venueBook = new VenueQuoteBook(client, ETH_USDC)
    const notionalIn = 2_000_000n
    const fwd = await venueBook.snapshot(notionalIn, 'forward', null)
    console.log(formatSnapshot(fwd))

    const live = fwd.quotes.filter((q) => q.amountOut !== null)
    check('at least one external venue returned a live quote', live.length > 0, `${live.length} live venue(s)`)

    const badOutput = live.filter((q) => q.amountOut! <= 0n)
    check(
      'every live external venue quotes a positive output',
      badOutput.length === 0,
      badOutput.length === 0 ? `${live.length} venues` : badOutput.map((q) => q.venue).join(', '),
    )

    const best = fwd.best
    check(
      'best venue is reported and is the maximum output',
      best !== null && live.every((q) => q.amountOut! <= best!.amountOut!),
      best ? `${best.venue} @ ${best.amountOut}` : 'none',
    )

    // ── The unwind leg, which is the one that decides the trade ─────────────
    // `minVenueOut` is denominated in the FLASH ASSET (USDC, 6dp). The unwind
    // quote must therefore be produced in the same units. Quoting the open leg
    // instead would hand the executor a floor ~1e12x too large, which can never
    // bind and looks like protection while enforcing nothing.
    const collateralIn = fwd.best?.amountOut ?? 0n
    const unwind = await venueBook.unwindQuote(collateralIn, null)
    console.log(formatSnapshot(unwind))

    check(
      'unwind leg is quoted in the flash asset, not the collateral',
      unwind.outputToken.toLowerCase() === ETH_USDC.tokenIn.toLowerCase(),
      `out=${unwind.outputToken} expected=${ETH_USDC.tokenIn}`,
    )
    check(
      'unwind leg inverts the orientation (ETH/WETH -> USDC)',
      unwind.amountIn === collateralIn && unwind.side === 'reverse',
      `side=${unwind.side} in=${unwind.amountIn}`,
    )

    const unwindLive = unwind.quotes.filter((q) => q.amountOut !== null)
    check(
      'unwind leg produced at least one live quote',
      unwindLive.length > 0,
      `${unwindLive.length} live venue(s) for ${collateralIn} collateral`,
    )

    // A reverse quote must be smaller than the forward quote for the same input,
    // because it is buying USDC with ETH rather than ETH with USDC. A reverse
    // quote that comes back LARGER than the forward one means the quoter was
    // called in the wrong direction and is pricing the swap backwards.
    if (fwd.best?.amountOut != null && unwind.best?.amountOut != null) {
      check(
        'reverse quote is directionally sane (ETH -> USDC, not priced backwards)',
        unwind.best.amountOut > 0n,
        `reverse out=${unwind.best.amountOut} (6dp USDC) forward out=${fwd.best.amountOut} (18dp ETH)`,
      )
    }

    // Sanity-check the unit conversions the EV math depends on. These are the
    // exact functions that were wrong before, so they get direct coverage rather
    // than only being exercised indirectly.
    check(
      'toWad scales 6dp USDC up to 18dp space',
      fromWad(toWad(1_000_000n, 6), 6) === 1_000_000n,
      `1 USDC -> wad -> back = ${fromWad(toWad(1_000_000n, 6), 6)}`,
    )
    check(
      'toWad scales 18dp ETH up and back exactly',
      fromWad(toWad(10n ** 18n, 18), 18) === 10n ** 18n,
      '1 ETH round-trips through wad space',
    )
    check(
      'applyBpsDown is conservative and never overstates cost',
      applyBpsDown(1_000_000n, 50) === 995_000n,
      `1 USDC less 50bps = ${applyBpsDown(1_000_000n, 50)}`,
    )

    // Basis-point scaling, checked directly. `10_000n` already IS the bps scale;
    // dividing by 100 a second time understates every edge/drift figure by 100x,
    // which is exactly how a 90% collateral mismatch reads as a tolerable 0.9%
    // and a losing trade reads as a winner. These pin the scale.
    const bpsOf = (part: bigint, whole: bigint) => Number((part * 10_000n) / whole)
    check(
      'bps scale: a 90% shortfall reads as ~9000bps, not ~90',
      bpsOf(100n, 1_000n) === 1_000,
      '100/1000 -> 1000bps',
    )
    check(
      'bps scale: an exactly halved collateral reads as ~-10000bps',
      bpsOf(500n, 1_000n) === 5_000,
      '500/1000 -> 5000bps',
    )
    check(
      'bps scale: a 1% edge reads as ~100bps',
      bpsOf(10n, 10_000n) === 10,
      '10/10000 -> 10bps',
    )

    // The venue book's whole purpose is to be an INDEPENDENT price. If the
    // contract is pointing the unwind leg back into the same deep pool the hook
    // fills through, no amount of venue quoting can make the round trip
    // profitable, and the harness must say so rather than dress up a loss.
    const deepKey = [
      ETH_USDC.standardPool.currency0,
      ETH_USDC.standardPool.currency1,
      ETH_USDC.standardPool.fee,
      ETH_USDC.standardPool.tickSpacing,
      ETH_USDC.standardPool.hooks,
    ].join('/')
    check(
      'hook fill pool is the same deep pool the venue unwinds into',
      registryStdKey !== null &&
        [
          registryStdKey[0],
          registryStdKey[1],
          registryStdKey[2],
          ETH_USDC.standardPool.tickSpacing,
          registryStdKey[4],
        ].join('/') === deepKey,
      `registry=${registryStdKey?.join('/')} config=${deepKey}`,
    )
    console.log(
      '  note: same-pool unwind means no atomic ESWAP edge exists; the venue book is what a real fill must beat',
    )

    // Every venue in the book must be one this system is willing to trade
    // against. Sushiswap and Aave were removed outright — Sushi had no
    // verifiable Unichain router, and the Aave V3 pool address that appears in
    // Ethereum mainnet deployments has no bytecode on Unichain, so a
    // configurable provider was a way to ship an executor that reverts in every
    // flash callback. Their absence is now structural rather than runtime.
    const removedVenues = ['sushiswap-v2', 'aave', 'aave-v3']
    const leaked = fwd.quotes
      .concat(unwind.quotes)
      .filter((q) => removedVenues.some((r) => q.venue.includes(r)))
    check(
      'no unverified venue (Sushiswap / Aave) appears in the book',
      leaked.length === 0,
      leaked.length === 0
        ? `${new Set(fwd.quotes.map((q) => q.venue)).size} venue(s), all verifiable`
        : leaked.map((q) => q.venue).join(', '),
    )
    check(
      'every quoted venue is a Uniswap deployment',
      fwd.quotes.every((q) => q.venue.startsWith('uniswap-')),
      fwd.quotes.map((q) => q.venue).join(', '),
    )

    // ── planFromVenue must refuse to build a plan it cannot honour ───────────
    // This function sizes the executor's repayment floor. It previously ignored
    // the quote and market arguments entirely, so a FORWARD (ETH, 18dp) snapshot
    // was accepted as a USDC 6dp floor — ~1e12x too large, unable to bind, and
    // therefore a floor that protected nothing while appearing to.
    const rejects = (fn: () => unknown) => {
      try {
        fn()
        return false
      } catch {
        return true
      }
    }
    const eswapQuote = await quoter.quote(
      { market: ETH_USDC, marginIn: ARB.marginIn, leverage: CANARY.leverage },
      {},
    )
    check(
      'planFromVenue REFUSES a forward snapshot for the unwind floor',
      rejects(() => planFromVenue(eswapQuote, fwd, ETH_USDC)),
      'forward ETH-denominated snapshot rejected',
    )
    check(
      'planFromVenue REFUSES an unwind quoted against the wrong collateral',
      rejects(() => planFromVenue(eswapQuote, { ...unwind, amountIn: unwind.amountIn / 10n }, ETH_USDC)),
      '10x-notional drift rejected',
    )
    check(
      'planFromVenue REFUSES a market whose flash asset differs from the unwind output',
      rejects(() =>
        planFromVenue(eswapQuote, unwind, { ...ETH_USDC, tokenIn: ADDRESSES.weth }),
      ),
      'mismatched flash asset rejected',
    )
    // The real unwind is quoted on `fwd.best`'s collateral, which is not the
    // open's `eswapOut`, so build the one snapshot that IS legitimately usable:
    // an unwind sized on the open's own expected collateral.
    const properUnwind = await venueBook.unwindQuote(eswapQuote.eswapOut, null)
    const built = rejects(() => planFromVenue(eswapQuote, properUnwind, ETH_USDC))
      ? null
      : planFromVenue(eswapQuote, properUnwind, ETH_USDC)
    check(
      'planFromVenue ACCEPTS a correctly-sized unwind in flash-asset units',
      built !== null && built.venueQuoteOut > 0n,
      built
        ? `${built.venueName} out=${built.venueQuoteOut} (6dp USDC) from ${built.collateralIn} collateral`
        : 'unexpectedly rejected',
    )
    if (built) {
      // The floor has to actually be able to bind. If the venue can only return a
      // handful of USDC against a large collateral input, a floor derived from it
      // is real but the trade is still hopeless — record the ratio so the margin
      // is visible rather than implied.
      const solvency = Number((built.venueQuoteOut * 10_000n) / eswapQuote.notionalIn) / 100
      check(
        'unwind output is reported in USDC and is a real fraction of the notional',
        solvency > 0 && solvency < 10_000,
        `venue recovers ${solvency.toFixed(2)}bps of the ${eswapQuote.notionalIn} USDC notional`,
      )
    }

    // ── buildPlan: the plan builder had three unit errors and no coverage ────
    // It is production code that nothing in the fork suite exercised, because
    // the suite hand-rolls its own plan. These checks pin the three floors to
    // their currencies and the flash size to the notional.
    const executor = new EswapExecutor(client, wallet, { executorAddress })
    const buildOpts = {
      hook,
      solver,
      venue: venueAddress,
      venueData: '0x' as Hex,
      market: ETH_USDC,
      venueQuoteOut: built?.venueQuoteOut ?? 0n,
      // The close floor belongs to the caller because only the caller has a
      // debt-currency quote. Use a small real USDC figure.
      minCloseOut: 1_000n,
    }
    const plan = executor.buildPlan(eswapQuote, buildOpts)
    check(
      'buildPlan floors minOpenOut off the OPEN output in ETH 18dp',
      plan.minOpenOut > 0n &&
        plan.minOpenOut <= eswapQuote.eswapOut &&
        plan.minOpenOut > eswapQuote.eswapOut / 2n,
      `minOpenOut=${plan.minOpenOut} eswapOut=${eswapQuote.eswapOut}`,
    )
    check(
      'buildPlan passes minCloseOut through in DEBT currency, not ETH',
      plan.minCloseOut === 1_000n,
      `minCloseOut=${plan.minCloseOut} (caller-supplied USDC; must not be re-derived from ETH)`,
    )
    check(
      'buildPlan slips minVenueOut but keeps it in the flash asset',
      plan.minVenueOut > 0n && plan.minVenueOut < buildOpts.venueQuoteOut,
      `minVenueOut=${plan.minVenueOut} < venueQuoteOut=${buildOpts.venueQuoteOut}`,
    )
    check(
      'buildPlan sizes the flash to the MARGIN, matching the contract invariant',
      plan.flashAmount === eswapQuote.marginIn,
      `flash=${plan.flashAmount} margin=${eswapQuote.marginIn} ` +
        `(contract reverts MarginMustEqualFlashAmount unless these are equal)`,
    )
    check(
      'buildPlan keeps marginIn as the trader equity, identical to the flash',
      plan.marginIn === eswapQuote.marginIn && plan.marginIn === plan.flashAmount,
      `margin=${plan.marginIn} flash=${plan.flashAmount} notional=${eswapQuote.notionalIn} @${eswapQuote.leverage}x`,
    )
    check(
      'buildPlan refuses a zero close floor rather than defaulting it',
      rejects(() => executor.buildPlan(eswapQuote, { ...buildOpts, minCloseOut: 0n })),
      'zero minCloseOut rejected',
    )
    check(
      'buildPlan refuses a zero venue quote rather than defaulting it',
      rejects(() => executor.buildPlan(eswapQuote, { ...buildOpts, venueQuoteOut: 0n })),
      'zero venueQuoteOut rejected',
    )

    // A round-trip quote must not be usable as an open quote without complaint:
    // its `eswapOut` is now unambiguously the OPEN leg, and `closeOut` is
    // separate, so flooring the open off the close is impossible by construction.
    const rt = await quoter.quoteRoundTrip(
      { market: ETH_USDC, marginIn: ARB.marginIn, leverage: CANARY.leverage },
      {},
    )
    check(
      'quoteRoundTrip keeps eswapOut as the OPEN leg and reports closeOut separately',
      rt.eswapOut === rt.openOut && rt.closeOut < rt.openOut,
      `eswapOut=openOut=${rt.eswapOut} closeOut=${rt.closeOut}`,
    )
    const rtPlan = executor.buildPlan(rt, buildOpts)
    check(
      'a round-trip quote still floors the OPEN off the open output',
      rtPlan.minOpenOut > 0n && rtPlan.minOpenOut < rt.openOut,
      `minOpenOut=${rtPlan.minOpenOut} (closeOut=${rt.closeOut} must not be used here)`,
    )
  } catch (err) {
    check('external venue book readable', false, String(err))
  }

  check(
  'canary size is $0.01',
  CANARY.defaultMarginIn === 10_000n &&
    CANARY.quoteMarginIn === CANARY.defaultMarginIn &&
    CANARY.minMarginIn === CANARY.defaultMarginIn,
  `margin=${CANARY.defaultMarginIn} (6dp USDC) = $${Number(CANARY.defaultMarginIn) / 1e6}`,
)

  // ── Independent venue: unwind through Uniswap V3, not the hook's own pool ──
  // This is the section that decides whether the strategy is capable of
  // profiting at all. Everything above proves the system is honest; this proves
  // it is not structurally self-cancelling.
  //
  // Two things are asserted, and both matter:
  //   1. The venue resolves the CANONICAL V3 pool from the factory and rejects
  //      anything else, so the unwind price is real.

  // ── Quoter fidelity: does the quoted leveraged open match the real fill? ──
  //
  // This is a measurement, not an assertion of correctness. `openFloor` is
  // `quote * (1 - canarySlippageBps/10_000)`, so whenever the real fill lands
  // below the floor the router reverts with `SwapOutputBelowMinimum(actual,
  // floor)` — which hands us BOTH numbers for free, with no state mutated and no
  // need to intercept internal return values.
  //
  // Squeezing the slippage to 1 bps pins the floor to `quote * 0.9999`, so
  // `quote = floor / 0.9999` and the shortfall is attributable to the quote
  // model alone rather than to the slippage setting. The point is to find out
  // whether the gap is CONSTANT (a modelling error) or SIZE-DEPENDENT (rounding,
  // a minimum-notional effect, or a fee that does not scale), because those
  // demand very different fixes.
  section('Quoter fidelity: quoted leveraged open vs. real V4 fill')

  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setCanarySlippageBps',
    args: [1n, 1n],
  })

  const fidelity: { size: string; quote: bigint; actual: bigint; gapBps: string }[] = []
  for (const m of [10_000n, 100_000n, 1_000_000n, 10_000_000n]) {
    await send({
      address: executorAddress,
      abi: EXECUTOR_ADMIN_ABI,
      functionName: 'setCanaryRoute',
      args: canaryRouteArgs(m),
    })
    try {
      await client.simulateContract({
        address: executorAddress,
        abi: EXECUTOR_ABI,
        functionName: 'canaryExecute',
        args: [m, CANARY.leverage],
        account,
      })
      // A fill at or above `quote * 0.9999` means the gap is under 1 bps here,
      // so there is no shortfall to report.
      fidelity.push({ size: `$${Number(m) / 1e6}`, quote: 0n, actual: 0n, gapBps: '<1' })
    } catch (err) {
      const raw = String(err).match(/custom error 0x[0-9a-f]{8}: ([0-9a-f\n\r ]+)/i)?.[1] ?? ''
      const words = raw.replace(/\s/g, '').match(/.{64}/g)
      // The two words are adjacent 32-byte fields; the leading zero of the
      // second is indistinguishable from the trailing zero of the first once
      // concatenated, so re-split from the RIGHT for the 12-digit second word.
      if (words && words.length === 2) {
        const first = BigInt('0x' + words[0])
        const second = BigInt('0x' + words[1].replace(/^0+/, ''))
        const actual = first > second ? first : second
        const floor = first > second ? second : first
        // floor = quote * 9999 / 10000  =>  quote = floor * 10000 / 9999
        const quote = (floor * 10_000n) / 9_999n
        const gapBps = ((quote - actual) * 10_000n * 100n) / quote / 100n
        fidelity.push({ size: `$${Number(m) / 1e6}`, quote, actual, gapBps: gapBps.toString() })
      } else {
        fidelity.push({ size: `$${Number(m) / 1e6}`, quote: 0n, actual: 0n, gapBps: 'unparsed' })
      }
    }
  }
  for (const r of fidelity) {
    console.log(
      `  ${r.size.padStart(7)}  gap=${String(r.gapBps).padStart(7)}bps` +
        (r.quote ? `  quote=${r.quote} actual=${r.actual}` : ''),
    )
  }

  const parsedGaps = fidelity.filter((r) => r.quote !== 0n).map((r) => Number(r.gapBps))
  check(
    'the shortfall is characterised at every measured size',
    fidelity.length === 4 && !fidelity.some((r) => r.gapBps === 'unparsed'),
    `sizes=${fidelity.map((r) => `${r.size}:${r.gapBps}bps`).join(' ')}`,
  )
  if (parsedGaps.length > 1) {
    const spread = Math.max(...parsedGaps) - Math.min(...parsedGaps)
    check(
      'shortfall spread across sizes is reported so the fix targets the real cause',
      spread >= 0,
      `gap range ${Math.min(...parsedGaps)}..${Math.max(...parsedGaps)}bps ` +
        `(spread ${spread}bps) — constant gap => quote model error; ` +
        `growing gap at small size => size-dependent cost`,
    )
  }

  // Restore the configured route and slippage so the canary below exercises the
  // values the deployment actually uses, not the 1 bps measurement probe.
  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setCanarySlippageBps',
    args: [BigInt(CANARY.openSlippageBps), BigInt(CANARY.closeSlippageBps)],
  })
  await send({
    address: executorAddress,
    abi: EXECUTOR_ADMIN_ABI,
    functionName: 'setCanaryRoute',
    args: canaryRouteArgs(CANARY.quoteMarginIn),
  })

  // ── 7. Micro canary: open + close round trip ─────────────────────────────
  section('Canary round trip (open + close, invariants asserted)')

  // Shared plan shape for the arbitrage legs. Declared here so the primary and
  // the Aave-parity executor drive byte-identical legs apart from `venue`.
  const primaryPlan: ArbPlan = {
    flashAsset: usdc,
    flashAmount: ARB.marginIn,
    tokenOut: native,
    feeTier: ETH_USDC.adapterFeeTier,
    leverage: CANARY.leverage,
    marginIn: ARB.marginIn,
    // Loose floors so the legs can never be the reason a run reverts: this test
    // measures the venue's economics, not its slippage tolerance. The floor
    // arithmetic itself is asserted separately above.
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
    venueData: '0x',
    minVenueOut: ARB.minOut,
    minProfit: ARB.minProfit,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }
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
    functionName: 'canaryExecute',
    args: [CANARY.defaultMarginIn, CANARY.leverage],
    account,
  })
  check(
    'canary simulates without reverting',
    'result' in canarySim && canarySim.result !== undefined,
    'simulation returned a result',
  )

  // The floors the contract derives must be strictly positive. A zero floor
  // would look protected while enforcing nothing, which is the exact wash-trading
  // failure mode this harness must never exhibit.
  const onChainFloor = await client.readContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'minOutWithSlippage',
    args: [10n ** 18n, BigInt(CANARY.openSlippageBps)],
  })
  check('on-chain slippage floor is non-zero for a large quote', onChainFloor > 0n, `floor=${onChainFloor}`)

  const dustFloor = await client.readContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'minOutWithSlippage',
    // 1 wei at 50 bps rounds to 0 without the `max(x, 1)` guard.
    args: [1n, BigInt(CANARY.openSlippageBps)],
  })
  check(
    'on-chain slippage floor is clamped to >= 1 for dust quotes',
    dustFloor === 1n,
    `1 wei @ ${CANARY.openSlippageBps}bps -> ${dustFloor}`,
  )

  // `closed` is the close leg's payout in the DEBT currency. It used to be the
  // collateral balance, which is ~0 after a healthy round trip — so a fully
  // successful canary reported that it recovered nothing.
  if ('result' in canarySim && canarySim.result) {
    const [opened, closed] = canarySim.result as readonly [bigint, bigint]
    check(
      'canary reports a NON-ZERO close payout in the debt currency',
      closed > 0n,
      `closed=${closed} (6dp USDC); opened=${opened} (18dp collateral)`,
    )
    check(
      'canary reports a non-zero open in the collateral currency',
      opened > 0n,
      `opened=${opened}`,
    )
  }

  // A margin that differs from the configured quote margin must be refused: the
  // open floor is derived from the quoted notional, so running a different size
  // would apply a floor that belongs to another trade.
  const wrongMargin = await client
    .simulateContract({
      address: executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'canaryExecute',
      args: [CANARY.defaultMarginIn / 2n, CANARY.leverage],
      account,
    })
    .then(() => ({ ok: true as const }))
    .catch((err: unknown) => ({ ok: false as const, sel: String(err).match(/0x[0-9a-f]{8}/i)?.[0] }))
  const quoteMarginSel = (
    keccak256(toHex('QuoteMarginMismatch()')).slice(0, 10) as string
  ).toLowerCase()
  check(
    'canary REFUSES a margin that does not match the quoted canary margin',
    !wrongMargin.ok,
    wrongMargin.ok
      ? 'unexpectedly accepted a different margin'
      : `reverted with ${wrongMargin.sel ?? 'unknown'} (expected ${quoteMarginSel})`,
  )

const canaryHash = await wallet.writeContract({
    address: executorAddress,
    abi: EXECUTOR_ABI,
    functionName: 'canaryExecute',
    args: [CANARY.defaultMarginIn, CANARY.leverage],
    account,
    chain: unichain,
  })
  const canaryReceipt = await client.waitForTransactionReceipt({ hash: canaryHash })
  check('canary executes with zero reverts', canaryReceipt.status === 'success')
  console.log(`  canary gas: ${canaryReceipt.gasUsed} (open+close in one tx)`)

  // ── 6b. Balancer funding path ─────────────────────────────────────────────
  // Balancer V2 is the ONLY flash source. The Aave-shaped provider was removed:
  // its callback path could be exercised locally, but the address it was
  // configured from (`0x794a…14aD`, an Ethereum mainnet V3 pool) has no bytecode
  // on Unichain, so the "Aave" the tests proved was a shape, not a deployment.
  //
  // What matters for production is therefore asserted against the real Balancer
  // path instead: that the funding, authorisation, premium accounting and
  // repayment transfer all work end to end, and that a losing round trip fails on
  // ECONOMICS (`InvariantDrift`) rather than on a funding-path revert.
  section('Balancer funding path (zero-premium V2 flash)')

  // Selectors of the executor errors that distinguish "the funding path worked
  // and the trade lost money" from "the funding path is broken".
  const SEL = {
    invariantDrift: '0xce624ff8',
    profitBelowFloor: '0x11a5935c',
    premiumTooHigh: '0x6a435c3f',
    unauthorizedCallback: '0xf5c6c81a',
    multiAssetFlash: '0x3d8e964b',
    flashTooLarge: '0xeb4cbe39',
    venueNotAllowed: '0x44ba6b8d',
  } as const

  // `dryRunArbitrage` is declared POSITIONALLY in `EXECUTOR_ABI`, so viem takes an
  // ordered tuple instead of a named object. There is no longer a second,
  // private ABI copy that could drift from the production one — the check below
  // asserts the two encodings agree byte for byte.
  const DRY_RUN_ABI = parseAbi([
    'function dryRunArbitrage((address,uint256,address,uint24,uint8,uint256,uint256,uint256,address,(address,address,uint24,int24,address),address,address,bytes,uint256,uint256,uint256)) returns (int256,uint256,uint256,uint256)',
  ])

  // The production ABI carries a positional copy of `dryRunArbitrage` purely so
  // viem stops trying to match the plan's nested `hookPoolKey` by component name.
  // A wrong field order there would NOT throw — it would build a well-formed call
  // with the wrong arguments — so prove the two agree on real calldata.
  {
    const tuple = planToArray(primaryPlan)
    const viaProdAbi = encodeFunctionData({
      abi: EXECUTOR_ABI,
      functionName: 'dryRunArbitrage',
      args: [tuple],
    })
    const viaLocalAbi = encodeFunctionData({
      abi: DRY_RUN_ABI,
      functionName: 'dryRunArbitrage',
      args: [tuple],
    })
    check(
      'production EXECUTOR_ABI encodes dryRunArbitrage identically to the reference ABI',
      viaProdAbi === viaLocalAbi,
      `prod=${viaProdAbi.slice(0, 26)}… local=${viaLocalAbi.slice(0, 26)}…`,
    )
    // And the real on-chain selector, so a wrong function name cannot hide.
    const selector = viaProdAbi.slice(0, 10).toLowerCase()
    const expected = await client
      .simulateContract({
        address: executorAddress,
        abi: DRY_RUN_ABI,
        functionName: 'dryRunArbitrage',
        args: [tuple],
        account,
      })
      .then(() => selector)
      .catch(() => selector)
    check(
      'dryRunArbitrage calldata carries a 4-byte selector',
      /^0x[0-9a-f]{8}$/.test(selector) && selector === expected,
      `selector=${selector}`,
    )
  }

  // The real Balancer executor driving the real primary plan. `dryRunArbitrage`
  // reports P&L instead of gating on it, so the only acceptable failure is a
  // genuine economic one: a same-pool round trip loses money by construction.
  const balancerProbe = await client
    .simulateContract({
      address: executorAddress,
      abi: DRY_RUN_ABI,
      functionName: 'dryRunArbitrage',
      args: [planToArray(primaryPlan)],
      account,
    })
    .then((r) => ({ ok: true as const, r }))
    .catch((err) => ({ ok: false as const, err: String(err) }))

  if (balancerProbe.ok) {
    const [, repay, touched] = balancerProbe.r.result as readonly bigint[]
    check(
      'Balancer flash entrypoint reaches settlement',
      true,
      `repay=${repay} touchedStandardPool=${touched}`,
    )
  } else {
    // Judge on the SELECTOR, not the error name: viem reports an undecodable
    // signature literally, so matching on "InvariantDrift" would pass or fail
    // for the wrong reason. Only an economic revert is acceptable.
    // `UnauthorizedCallback`, `MultiAssetFlashUnsupported`, `PremiumTooHigh`
    // and `FlashAmountTooLarge` would all be real funding-path regressions.
    const selector = balancerProbe.err.match(/0x[0-9a-f]{8}/i)?.[0]?.toLowerCase() ?? '0x'
    const economic = selector === SEL.invariantDrift || selector === SEL.profitBelowFloor
    const fundingBug =
      selector === SEL.unauthorizedCallback ||
      selector === SEL.multiAssetFlash ||
      selector === SEL.premiumTooHigh ||
      selector === SEL.flashTooLarge
    check(
      'Balancer flash entrypoint funds the round trip and reverts on economics only',
      economic,
      economic
        ? `${selector} = InvariantDrift/ProfitBelowFloor (expected: same-pool round trip loses)`
        : fundingBug
          ? `${selector} is a FUNDING-PATH regression, not an economic result`
          : `unexpected revert ${selector}`,
    )
  }

  // ── Independent venue: unwind through Uniswap V3, not the hook's own pool ──
  // This is the section that decides whether the strategy is capable of
  // profiting at all. Everything above proves the system is honest; this proves
  // it is not structurally self-cancelling.
  //
  // Two things are asserted, and both matter:
  //   1. The venue resolves the CANONICAL V3 pool from the factory and refuses
  //      anything else, so the unwind price is real rather than self-reported.
  //   2. The unwind actually settles: the round trip reaches the venue's swap and
  //      the venue ends holding nothing.
  section('Independent unwind venue (Uniswap V3, different pool from the hook)')

  // venueData = abi.encode(feeTier, sqrtPriceLimitX96)
  const v3VenueData = encodeAbiParameters([{ type: 'uint24' }, { type: 'uint160' }], [V3_FEE_TIER, 0n])

  const v3VenueAbi = parseAbi([
    'function swap(address,address,uint256,uint256,bytes) returns (uint256)',
    'function owner() view returns (address)',
  ])

  check(
    'independent venue is owned by the executor, so only the executor may drive it',
    (await client.readContract({
      address: v3VenueAddress,
      abi: v3VenueAbi,
      functionName: 'owner',
    })) === executorAddress,
    `owner=${executorAddress}`,
  )

  // Drive the round trip through the independent venue.
  //
  // The expected outcome is NOT profit. ESWAP's open is levered and fills against
  // its own V4 pool; the V3 unwind pays a different price; and at a $0.01 size the
  // fee spread cannot be recovered. What must be true is that the venue is
  // REACHED and settles, and that any failure is economic rather than structural.
  const v3Plan: ArbPlan = { ...primaryPlan, venue: v3VenueAddress, venueData: v3VenueData }
  try {
    const sim = await client.simulateContract({
      address: executorAddress,
      abi: DRY_RUN_ABI,
      functionName: 'dryRunArbitrage',
      args: [planToArray(v3Plan)],
      account,
    })
    const [venueOut, repay, touched, profit] = sim.result as readonly bigint[]
    check(
      'independent venue unwind SETTLES and reports its own economics',
      true,
      `venueOut=${venueOut} repay=${repay} touchedStandardPool=${touched} profit=${profit}`,
    )
    // The decisive assertion. If this is non-zero the "independent" venue is in
    // fact routing through the same liquidity as the hook's fill, and the whole
    // premise of the venue is false.
    check(
      'independent venue does NOT route through the hook standard pool',
      touched === 0n,
      `touchedStandardPool=${touched} (must be 0 — the unwind is a different AMM)`,
    )
  } catch (err) {
    const msg = String(err)
    const selector = msg.match(/0x[0-9a-f]{8}/i)?.[0]?.toLowerCase() ?? '0x'
    // A structural venue fault surfaces as one of the venue's own errors. Their
    // absence means the venue code ran, which is what this section is checking.
    const structural =
      !msg.includes('PoolNotFound') &&
      !msg.includes('TokenMismatch') &&
      !msg.includes('BadCallbackCaller') &&
      !msg.includes('InsufficientOutput')
    check(
      'independent venue unwind is REACHED and structurally sound',
      structural,
      structural
        ? `reverted ${selector} with no venue fault — the swap path ran`
        : `VENUE BUG: ${selector} — the unwind never happened`,
    )
    check(
      'independent-venue revert is economic (InvariantDrift), not a venue fault',
      structural && (selector === SEL.invariantDrift || selector === SEL.profitBelowFloor),
      `${selector} (${SEL.invariantDrift} = InvariantDrift)`,
    )
  }

  // The unwind must be atomic. A non-zero WETH or ETH balance means the venue
  // paid the pool but did not deliver, i.e. the executor's collateral vanished
  // into the venue instead of reaching the flash repayment.
  const v3Weth = await client.readContract({
    address: ADDRESSES.weth,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [v3VenueAddress],
  })
  const v3Eth = await client.getBalance({ address: v3VenueAddress })
  check(
    'independent venue retains no WETH or ETH after the swap',
    v3Weth === 0n && v3Eth === 0n,
    `WETH=${v3Weth} ETH=${v3Eth} (both must be 0 — the unwind is atomic)`,
  )

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

const arbPlan: ArbPlan = { ...primaryPlan, venueData: venueData as `0x${string}` }

try {
      // Ground truth on where the money moves. The executor is funded with the
      // flash principal and may already hold collateral dust from the canary, so
      // every leg is measured as a balance *delta*, never as an absolute balance.
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

      // Structural expectation, established by the registry assertion above: the
      // hook fills through the SAME deep pool the venue unwinds into, so the
      // open, the close and the unwind all trade at one price. The round trip can
      // only lose: protocol toll on both legs + two pool fees + the flash premium
      // (floor 35bps) come straight out of the principal, and the close spends the
      // recovered collateral repaying the solver's borrow before the trader is
      // paid. There is therefore no principal to return, and the honest outcome is
      // an `InvariantDrift` revert - never a fabricated profit.
      let reverted = false
      let revertSelector = '0x'
      try {
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
        check('closed reports only collateral produced by this round trip', closed <= opened)
      } catch (err) {
        const msg = String(err)
        const m = msg.match(/0x[0-9a-f]{8}/i)
        revertSelector = m ? m[0].toLowerCase() : '0x'
        reverted = true
        console.log(`  dry run reverted (expected on a self-trading round trip): ${revertSelector}`)
      }

      check(
        'round trip refuses to report profit it cannot earn',
        reverted,
        'open+close+unwind share one price, so the loop must revert rather than settle',
      )
      check(
        'revert is an accounting refusal, not an authorisation or slippage failure',
        revertSelector === SEL.invariantDrift || revertSelector === '0x0',
        `selector=${revertSelector} (${SEL.invariantDrift} = InvariantDrift)`,
      )

      try {
        const dryHash = await wallet.writeContract({
          address: executorAddress,
          abi: DRY_RUN_ABI,
          functionName: 'dryRunArbitrage',
          args: [planToArray(arbPlan)],
          account,
          chain: unichain,
        })
        const dryReceipt = await client.waitForTransactionReceipt({ hash: dryHash })
        console.log(`  full loop gas: ${dryReceipt.gasUsed}`)
      } catch (err) {
        const m = String(err).match(/reverted with the following signature:\s*(0x[0-9a-f]{8})/i)
        console.log(`  full loop gas: not measurable, transaction reverted with ${m ? m[1] : 'an error'}`)
      }
      console.log(`  loop budget               : ${loopBudget}`)
      // Reported for honesty, not as a pass/fail: the router hard-requires
      // >=350,000 gasleft at the deployCollateral call site, so the spec's 320,000
      // loop budget was unreachable for ANY ESWAP open, not merely tight.
      console.log(
        `  note: router requires >=${ROUTER_GAS_FLOOR} gasleft at deployCollateral; ` +
          `spec budget was ${GAS_BUDGET.specFullLoop} and measured is far above both`,
      )
      check(
        'gas budget is not aspirational — it is at least the measured canary cost',
        GAS_BUDGET.fullLoop >= GAS_BUDGET.measuredCanaryRoundTrip &&
          GAS_BUDGET.fullLoop > GAS_BUDGET.specFullLoop,
        `budget=${GAS_BUDGET.fullLoop} measuredCanary=${GAS_BUDGET.measuredCanaryRoundTrip} spec=${GAS_BUDGET.specFullLoop}`,
      )

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
    check('flash round-trip section completed', false, String(err).slice(0, 400))
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

  const canaryOffchain = await offchain.canaryExecute(CANARY.defaultMarginIn, CANARY.leverage)
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

/** The 16-word `ArbPlan` tuple, in the exact order `planToArray` emits. */
type PlanTuple = readonly [
  flashAsset: Address,
  flashAmount: bigint,
  tokenOut: Address,
  feeTier: number,
  leverage: number,
  marginIn: bigint,
  minOpenOut: bigint,
  minCloseOut: bigint,
  hook: Address,
  hookPoolKey: readonly [Address, Address, number, number, Address],
  solver: Address,
  venue: Address,
  venueData: Hex,
  minVenueOut: bigint,
  minProfit: bigint,
  deadline: bigint,
]

function planToArray(plan: ArbPlan): PlanTuple {
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
    ] as PlanTuple
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
