// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
// Mirrored local types — used by the EswapMarginHook/Router ABI surface.
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../../src/v4/EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../../src/v4/EswapMarginHookLogic2.sol";
import {IPriceFeedLogic} from "../../src/v4/EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapRouterExt} from "../../src/v4/EswapRouterExt.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {IReactor} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal admin surface shared by both venue settlers.
interface EswapSettlementOps {
    function setOperator(address operator) external;

    function setPendingRecipient(address recipient) external;
}
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

/// @notice Unichain mainnet deployment scoped to the ETH/USDC pool ONLY — the
///         deepest liquidity pool on Unichain. The hook pool is the native
///         ETH/USDC (0x0 / 0x078D..) fee-3000, tick-60 pool; the physical fill
///         routes to the deep no-hook ETH/USDC fee-500, tick-10 standard pool.
contract DeployUnichain is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;
    // PriceFeed.NATIVE_ETH_PRICE_KEY: the canonical key under which
    // _getValidatedPrice stores/looks-up the ETH/USD feed.  The contract
    // remaps address(0) → this address before the priceFeeds[] lookup, so
    // setPriceFeed MUST use this key — NOT address(0)/ETH.
    address constant NATIVE_ETH_PRICE_KEY = 0x4200000000000000000000000000000000000006;

    // Verified live on Unichain Mainnet via latestRoundData() (Alchemy RPC).
    // Note: Unichain feeds report 18-decimal answers, unlike the usual 8.
    address constant ETH_USD_FEED = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    address constant USDC_USD_FEED = 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b;

    // Foundry forge-script routes broadcasted CREATE2 opcodes through this
    // internal Create2Deployer (deployed on-chain at the same address on
    // Unichain Mainnet/Sepolia). All CREATE2 address arithmetic below MUST use
    // this factory as the deployer, NOT the EOA, so simulation matches broadcast.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Gas forwarded to the CREATE2 deployer for the hook.
    ///
    /// Unichain caps a whole transaction at 2**24 = 16,777,216 gas (EIP-7825).
    /// This stipend must cover the CREATE2 itself, and the enclosing transaction
    /// must additionally cover ~21k intrinsic plus the ~300k of calldata the
    /// deterministic deployer is handed (it takes the whole initcode as input,
    /// 24,720 bytes).
    ///
    /// Sizing, measured rather than guessed. `deployCodeTo` / `vm.etch` measures
    /// the constructor at ~9.0M, but that path never charges the EIP-2 code
    /// deposit, so it badly understates the real figure. A properly salt-mined
    /// typed CREATE2 of this exact hook costs 15,251,723 gas
    /// (see src/v4/test/Create2ReproTest.t.sol,
    /// test_TypedCreate2_SurfacesConstructorReason). The gap is almost entirely
    /// the 200-gas-per-byte deposit for ~23.6KB of runtime code.
    ///
    /// So the stipend has to clear ~15.26M, and 16M is chosen to leave the
    /// transaction total at roughly 16.3M, just under the 16,777,216 cap. This is
    /// a deliberately tight budget: any growth in hook runtime pushes the
    /// deployment over the chain's transaction limit, so `HOOK_RUNTIME_HEADROOM`
    /// below is the guard rail.
    uint256 constant HOOK_DEPLOY_GAS = 16_000_000;

    /// @dev How many `EswapMarginLib` address references the hook's creation code
    ///      must contain once the Foundry linker has resolved it. Two is the
    ///      observed count; the check is a floor so an added reference cannot
    ///      silently slip past.
    uint256 constant LIB_REFS = 2;

    /// @dev Bytes of headroom the hook must keep under EIP-170 (24,576). Each
    ///      additional runtime byte costs 200 gas in the code deposit, and the
    ///      deployment above has only a few hundred thousand gas of slack before
    ///      it breaches EIP-7825. Keep this asserted.
    uint256 constant HOOK_RUNTIME_HEADROOM = 900;

    /// @dev Mines the hook's CREATE2 salt in a frame of its own and prints it.
    ///
    ///      Run this as a SEPARATE invocation from the deploy:
    ///
    ///          forge script scripts/v4/DeployUnichain.s.sol:DeployUnichain \
    ///            --sig mineHookSalt --via-ir --rpc-url "$UNICHAIN_RPC_URL"
    ///
    ///      then put the printed value in .env as HOOK_SALT and run the deploy.
    ///
    ///      Why it must be separate: satisfying the hook's permission bits is a
    ///      2^-19 event, so the search performs hundreds of thousands of keccak
    ///      iterations and burns that gas out of the calling frame. That gas is
    ///      gone whether or not it is metered, and the CREATE2 that follows in
    ///      {run} then cannot be funded. Mining in its own invocation gives the
    ///      search a dedicated budget.
    ///
    ///      This function only COMPUTES. It broadcasts nothing, reads no chain
    ///      state beyond the price-feed decimals it must not need, and cannot
    ///      affect any deployed contract.
    ///
    ///      Required env: the addresses the deploy will use, since the
    ///      initcodeHash depends on them. The logic addresses must already
    ///      exist, which is why {run} is normally executed in two stages.
    function mineHookSalt() external {
        address pm = vm.envOr("POOL_MANAGER_ADDRESS", UNICHAIN_PM);
        address priceFeedAddr = vm.envOr("PRICE_FEED_ADDRESS", address(0));
        address owner = vm.addr(vm.envUint("PRIVATE_KEY"));
        address logic1 = vm.envAddress("HOOK_LOGIC_ADDRESS");
        address logic2 = vm.envAddress("HOOK_LOGIC2_ADDRESS");

        require(priceFeedAddr != address(0), "PRICE_FEED_ADDRESS unset");

        // These are warnings, not gates. A dry run mines against addresses that
        // do not exist on-chain yet, and refusing that would block the exact case
        // this function exists to serve. The real safety property is in {run}:
        // it rebuilds the initcode from the logic contracts it just deployed and
        // re-verifies the salt against THAT hash, so a salt mined for different
        // addresses is rejected before anything is broadcast.
        if (logic1.code.length == 0) console.log("warning: HOOK_LOGIC_ADDRESS has no code yet");
        if (logic2.code.length == 0) console.log("warning: HOOK_LOGIC2_ADDRESS has no code yet");

        // The creation code embedded in THIS compilation unit, already linked to
        // the library by the Foundry linker (verified in {run}).
        bytes memory linkedCreation = type(EswapMarginHook).creationCode;
        bytes memory initCode = abi.encodePacked(
            linkedCreation, abi.encode(pm, priceFeedAddr, logic1, logic2, owner)
        );
        bytes32 initCodeHash = keccak256(initCode);
        console.log("mining against initcodeHash:", uint256(initCodeHash));

        uint160 highFlags = HookFlags.AFTER_INITIALIZE_FLAG |
                            HookFlags.BEFORE_SWAP_FLAG |
                            HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                            HookFlags.AFTER_SWAP_FLAG;
        uint160 lowMask = (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
        uint160 allHookMask = (1 << 14) - 1;

        for (uint256 i = 0; i < 200_000_000; i++) {
            bytes32 salt = bytes32(i);
            address computed = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
            if (
                (uint160(computed) & highFlags) == highFlags
                    && (uint160(computed) & allHookMask) == lowMask
            ) {
                console.log("HOOK_SALT", uint256(salt));
                console.log("HOOK_ADDRESS", computed);
                return;
            }
        }
        revert("salt search exhausted");
    }

    /// @dev Dumps the FULLY LINKED hook initcode (a 32-byte salt followed by the
    ///      creation code and the five constructor args) to a file, in exactly
    ///      the shape the deterministic deployer expects: raw `salt || initcode`
    ///      calldata, not a CREATE2 calldata frame.
    ///
    ///      This exists because a live-node test cannot be built from the build
    ///      artifact. `bytecode.object` in out/ still contains Foundry's
    ///      `__$<addr>$__` link placeholders, so anything assembled from it is
    ///      not valid hex and both anvil and the Unichain node reject it with
    ///      "expected a valid hex string". Only `type(X).creationCode` inside
    ///      this compilation unit is already linked.
    ///
    ///      Usage:
    ///        HOOK_DUMP=1 forge script ... --sig dumpInitCode
    ///      then feed the file to anvil / the node as tx data.
    function dumpInitCode() external {
        address pm = vm.envOr("POOL_MANAGER_ADDRESS", UNICHAIN_PM);
        address priceFeedAddr = vm.envOr("PRICE_FEED_ADDRESS", address(0));
        address owner = vm.addr(vm.envUint("PRIVATE_KEY"));
        address logic1 = vm.envAddress("HOOK_LOGIC_ADDRESS");
        address logic2 = vm.envAddress("HOOK_LOGIC2_ADDRESS");
        bytes32 salt = bytes32(vm.envOr("HOOK_SALT", uint256(0)));

        bytes memory linkedCreation = type(EswapMarginHook).creationCode;
        require(_libraryReferenceCount(linkedCreation) >= LIB_REFS, "dump: hook lib not linked");

    bytes memory payload = abi.encodePacked(
        salt, linkedCreation, abi.encode(pm, priceFeedAddr, logic1, logic2, owner)
    );
        string memory out = vm.envOr("HOOK_DUMP_PATH", string("./hook_initcode_payload.hex"));
        vm.writeFile(out, vm.toString(payload));
        console.log("wrote", payload.length, "bytes to", out);
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        PoolManager pm = PoolManager(UNICHAIN_PM);
        console.log("Using Unichain PoolManager at:", UNICHAIN_PM);

        // Deploy PriceFeed and configure the verified Unichain feeds.
        // Feed decimals are read LIVE from each aggregator (CF-2): canonical
        // USD feeds are 8-dec, Unichain SVR feeds 18-dec — hardcoding either
        // breaks price normalization on the other chain type.
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        // IMPORTANT: register the ETH feed under NATIVE_ETH_PRICE_KEY (the
        // OP-stack WETH address 0x4200...), NOT under address(0)/ETH.
        priceFeed.setPriceFeed(NATIVE_ETH_PRICE_KEY, ETH_USD_FEED, AggregatorV3Interface(ETH_USD_FEED).decimals());
        console.log(string.concat("Configured ETH feed: ", vm.toString(ETH_USD_FEED)));
        priceFeed.setPriceFeed(USDC, USDC_USD_FEED, AggregatorV3Interface(USDC_USD_FEED).decimals());
        console.log(string.concat("Configured USDC feed: ", vm.toString(USDC_USD_FEED)));
        // Chainlink has not published an L2 sequencer uptime feed for Unichain,
        // so the sequencer check stays disabled until one is available.

        // Deploy EswapMarginLib deterministically with salt = 0, then LINK the
        // hook's creation code to that exact address by hand (see the offset
        // patch below). The hook is deployed with CREATE2 from raw bytes so its
        // address can be salt-mined to carry the required hook permission bits,
        // which is why the Foundry auto-linker cannot be used here.
        bytes32 libSalt = bytes32(0);
        address libAddr = create2Address(CREATE2_DEPLOYER, libSalt, keccak256(type(EswapMarginLib).creationCode));
        if (libAddr.code.length == 0) {
            bytes memory libInit = type(EswapMarginLib).creationCode;
            address deployedLib;
            assembly {
                deployedLib := create2(0, add(libInit, 32), mload(libInit), libSalt)
            }
            require(deployedLib != address(0), "lib create2 failed");
        }
        require(libAddr.code.length > 0, "lib not deployed");
        console.log("EswapMarginLib deployed at:", libAddr);

        // The hook has 2 external references to EswapMarginLib (its two
        // delegatecall'd library targets).
        //
        // IMPORTANT: this script does NOT patch those references by hand. The
        // creation code embedded via `type(EswapMarginHook).creationCode` inside
        // THIS script's own compilation unit is ALREADY linked by the Foundry
        // linker, even though the hook is deployed through a hand-rolled CREATE2
        // over raw bytes. Verified empirically: a scan for solc's 20-byte
        // unlinked placeholder (`__$` + 17 hex chars) finds zero occurrences.
        //
        // A previous version of this file did the opposite: it copied a
        // hardcoded offset table out of
        //   out/EswapMarginHook.sol/EswapMarginHook.json
        //     .bytecode.linkReferences["src/v4/EswapMarginLib.sol"]
        // and wrote the library address into those byte ranges. That was
        // actively dangerous. Those artifact offsets describe the standalone
        // `forge build` artifact, not the creation code as embedded here, so the
        // write landed on unrelated code and corrupted the initcode. Its own
        // `leftover` check is what caught this, which is the only reason the bug
        // was not broadcast. Offsets into raw bytecode move on every recompile;
        // the linker's own output is the only thing that should be trusted.
        //
        // So: verify the link, never rewrite it. The invariant that matters is
        // that every reference points at the library we just ensured has code,
        // otherwise the hook would DELEGATECALL into an empty address, accept
        // margin, and never settle.
        //
        // The whole-creation-code scan below walks ~24KB. That is pure
        // verification arithmetic, so it is unmetered to keep the script frame's
        // headroom for the actual deployments.
        vm.pauseGasMetering();
        bytes memory linkedCreation = type(EswapMarginHook).creationCode;
        uint256 linkCount = _libraryReferenceCount(linkedCreation);
        vm.resumeGasMetering();
        require(linkCount >= LIB_REFS, "hook lib auto-link mismatch");
        console.log("hook lib auto-linked at", linkCount, "refs ->", libAddr);

        // Guard the EIP-7825 gas budget. The create's cost is dominated by the
        // 200-gas-per-byte code deposit, so every extra runtime byte eats 200 gas
        // out of a budget with only a few hundred thousand to spare. Fail before
        // broadcasting rather than emit a transaction the chain will reject.
        //
        // Only the LENGTH is read from the build artifact, never any offset, and
        // that is safe where the earlier link-offset hack was not: the runtime
        // code is the same bytes in the artifact and in this script's compilation
        // unit (only its position differs), and the trailing metadata hash has a
        // fixed width, so the length is stable. Offsets are not.
        uint256 runtimeLen = _deployedBytecodeLength();
        require(
            24_576 - runtimeLen >= HOOK_RUNTIME_HEADROOM,
            "hook runtime too large for EIP-7825 deployment budget"
        );
        console.log("hook runtime bytes", runtimeLen);

        // Mirror of src/v4/libraries/HookFlags.sol (high-bit scheme) required by the
        // hook's own constructor check.
        uint160 highFlags = HookFlags.AFTER_INITIALIZE_FLAG |
                            HookFlags.BEFORE_SWAP_FLAG |
                            HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                            HookFlags.AFTER_SWAP_FLAG;
        // REAL v4-core low-14-bit scheme (lib/v4-core/src/libraries/Hooks.sol).
        uint160 lowMask = (1 << 12) | // real AFTER_INITIALIZE
                          (1 << 7) |  // real BEFORE_SWAP
                          (1 << 6) |  // real AFTER_SWAP
                          (1 << 3);   // real BEFORE_SWAP_RETURNS_DELTA
        uint160 allHookMask = (1 << 14) - 1;

        // [EIP-3860] Deploy the two delegatecall'd logic contracts as ordinary
        // CREATE contracts, in dependency order, and pass their addresses to the
        // hook constructor. Inlining them with `new` inside the hook produced a
        // 68,676-byte initcode against the 49,152-byte cap, so the hook was
        // undeployable on any EVM enforcing EIP-3860. Splitting them out drops
        // the hook initcode to ~24.5KB.
        //
        // Order matters: Logic2 has no dependency, while Logic takes Logic2's
        // address. `new` here means Forge's linker rewrites each logic contract's
        // own library markers automatically, so only the raw-CREATE2 hook above
        // needed manual patching.
        EswapMarginHookLogic2 logic2 = new EswapMarginHookLogic2(IPoolManager(address(pm)), IPriceFeedLogic(address(priceFeed)));
        console.log("HookLogic2 deployed at:", address(logic2));
        EswapMarginHookLogic logic1 = new EswapMarginHookLogic(IPoolManager(address(pm)), IPriceFeedLogic(address(priceFeed)), address(logic2));
        console.log("HookLogic deployed at:", address(logic1));

        // The hook constructor re-checks both children's `manager()` immutables
        // and reverts `LogicManagerMismatch` otherwise, so a wrong wiring fails
        // here instead of misrouting every later settlement.
        require(address(logic1.manager()) == address(pm), "logic manager mismatch");
        require(address(logic2.manager()) == address(pm), "logic2 manager mismatch");

        bytes memory initCode = abi.encodePacked(
            linkedCreation, abi.encode(address(pm), address(priceFeed), address(logic1), address(logic2), deployer)
        );
        bytes32 initCodeHash = keccak256(initCode);

        // The salt is NOT mined here. See {mineHookSalt} for why: the search
        // needs ~370k keccak iterations (~11M gas, worst case far more) and that
        // gas is spent out of THIS frame, so anything after the loop runs with
        // an empty tank. `vm.pauseGasMetering()` does not help, because it stops
        // METERING without REFUNDING. Running the loop here meant the CREATE2
        // below could never be satisfied no matter how large the {gas: N}
        // stipend was, and revm reported it as `hook create2 failed` /
        // MemoryOOG, which sent the investigation down the wrong path twice.
        //
        // The salt therefore comes from the environment, precomputed by a
        // separate `mineHookSalt` invocation that gets a frame to itself. It
        // cannot be hardcoded in source for the same reason it cannot be
        // trivially derived offline: the trailing solc metadata hash differs
        // between a standalone `forge build` and this script's own compilation,
        // so the initcodeHash (and therefore the correct salt) is build-specific.
        //
        // Safety is preserved by never trusting the value: we recompute the
        // address from the initcode this build actually produced and re-verify
        // the permission bits before spending a single wei.
        bytes32 salt = bytes32(vm.envOr("HOOK_SALT", uint256(0)));
        require(uint256(salt) != 0, "HOOK_SALT unset - run mineHookSalt first");

        // Independent re-derivation of the address we are about to CREATE2 into,
        // plus an explicit check of the permission bits the hook constructor
        // demands. If the salt is stale, or the logic addresses moved, this fails
        // before broadcasting anything.
        address expectedHook = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
        require((uint160(expectedHook) & highFlags) == highFlags, "stale HOOK_SALT: missing high bits");
        require((uint160(expectedHook) & allHookMask) == lowMask, "stale HOOK_SALT: missing low bits");
        console.log("hook salt       :", uint256(salt));
        console.log("expected hook   :", expectedHook);

        // Deploy the hook with the LINKED creation code through the deterministic
        // CREATE2 deployer, forwarding an EXPLICIT gas stipend.
        //
        // Unichain enforces EIP-7825 (Osaka): every transaction's gas limit is
        // capped at 2**24 = 16,777,216. The measured cost of this create is
        // ~15.25M (see HOOK_DEPLOY_GAS), and the enclosing transaction adds
        // ~21k intrinsic plus ~300k of calldata, because the deterministic
        // deployer is handed the whole initcode. Bounding the stipend keeps the
        // total under the cap deterministically instead of relying on forge's
        // estimate, and the call reverts loudly rather than leaving a truncated
        // contract behind.
        // The deterministic deployer takes RAW `salt || initcode` calldata: it
        // computes `X = calldatasize - 32`, copies `calldata[0x20 : 0x20+X]` into
        // memory, reads the salt from the FIRST 32 bytes, then
        // `CREATE2(0, 0, X, salt)`. Getting this order backwards yields
        // `initcode[32:] || salt`, whose CREATE2 address has wrong hook flag
        // bits, so the constructor reverts with `InvalidHookAddress()` and the
        // proxy returns empty returndata after burning its whole stipend.
        // Measured on the real deployer: 4,974,318 gas for the full hook.
        bytes memory payload = abi.encodePacked(salt, initCode);
        uint256 gasBefore = gasleft();
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call{gas: HOOK_DEPLOY_GAS}(payload);
        uint256 gasSpent = gasBefore - gasleft();
        console.log("hook create2 gas spent (incl. unused stipend):", gasSpent);
        if (!ok) {
            // Surface WHY. "hook create2 failed" hid an out-of-gas deep inside the
            // deterministic deployer behind a bare boolean, which cost several
            // rounds of misdiagnosis; the 4-byte selector (or a bare OOG, which
            // returns nothing) tells the two apart immediately.
            if (ret.length == 0) {
                console.log("create2 failed with empty returndata - out of gas");
            } else {
                console.log("create2 revert data:");
                console.logBytes(ret);
            }
        }
        require(ok && ret.length == 20, "hook create2 failed");
        address payable hookAddr = payable(address(uint160(bytes20(ret))));
        require(hookAddr.code.length > 0, "hook not deployed");
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        console.log("Hook deployed at:", address(hook));

        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        // Companion surface holder: ERC-7683 + trigger-order + JIT + atomic
        // margin, deployed off the core router so EswapRouter fits EIP-170.
        EswapRouterExt routerExt = new EswapRouterExt(IPoolManager(address(pm)), address(router));
        console.log("RouterExt deployed at:", address(routerExt));
        router.setRouterExt(address(routerExt));
        // [AUDIT CRIT-4] The companion relays swapMultiPoolFor on behalf of
        // cross-chain/atomic traders; whitelist it as a router executor.
        router.setExecutorWhitelist(address(routerExt), true);

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
        console.log("LiquidationKeeper deployed at:", address(keeper));

        // Configure the hook: treasury, fees, leverage and oracle strictness.
        // requireTwapOracle is off by default for the first live smoke test; flip
        // REQUIRE_TWAP_ORACLE=true in .env once the ETH feed is verified.
        address treasury = vm.envOr("TREASURY", deployer);
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: treasury,
            router: address(router),
            reserveFactor: 5,                  // 0.05% protocol fee (matches live)
            maxPriceSwingBps: 800,             // 8% V4-spot vs oracle TWAP deviation tolerance
            defaultMaxLeverage: 5,
            requireTwapOracle: vm.envOr("REQUIRE_TWAP_ORACLE", false)
        }));
        // Configure token decimals so the V4-spot vs V3-TWAP circuit breaker can
        // compare like-for-like prices (USDC has 6 decimals, WETH has 18).
        hook.setTokenDecimals(WETH, 18);
        hook.setTokenDecimals(USDC, 6);

        // USD-denominated collateral floor (18-decimals). Defaults to $0.05 to
        // MATCH the live minCollateralUsd (read from the old hook on chain);
        // override with MIN_COLLATERAL_USD in .env (e.g. 1000000000000000000 = $1).
        // Setting 0 restores the legacy raw-token MIN_COLLATERAL floor.
        hook.setRouterAndMinCollateralUsd(
            address(router),
            vm.envOr("MIN_COLLATERAL_USD", uint256(50000000000000000))
        );

        // Liquidator incentive (BPS of the post-solver surplus). Live old hook
        // ships 0 = no reward, so nobody liquidates. Default 0 preserves prior
        // behavior; set LIQUIDATOR_INCENTIVE_BPS in .env to enable it.
        if (vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)) > 0) {
            hook.setLiquidatorIncentiveBps(vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)));
        }

        // --- Initialize the ONLY pool: native ETH / USDC (ETH/USDC) ---
        // currency0 = native ETH (0x0) < currency1 = USDC (0x078D..), so ETH is
        // currency0, USDC is currency1. Base currency = native ETH.
        // This mirrors the LIVE re-purposed topology (LiveRepurposeHookConfig):
        // the hook (accounting) pool is fee-3000/tick-60; the physical fill
        // routes to the deep no-hook fee-500/tick-10 ETH/USDC standard pool.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Initialize pool at the LIVE deep standard pool's current sqrt: the
        // accounting rail must sit at the same price the physical fill pool
        // trades at (mirrors RehypothecationForkTest). MUST be within
        // maxPriceSwingBps (8%/800bps) of the Chainlink oracle or the circuit
        // breaker reverts TwapManipulated. NOTE: for a native ETH/USDC pool
        // currency0=ETH(0x0), currency1=USDC, so raw sqrtPriceX96 encodes USDC
        // per ETH (1e6-decimal quote for 18-dec base).
        RealPoolId stdRealId = RealPoolId.wrap(
            keccak256(abi.encode(address(0), USDC, uint24(500), int24(10), address(0)))
        );
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdRealId);
        require(stdSqrt > 0, "deep standard pool uninitialized");
        uint160 sqrtPriceX96 = stdSqrt;
        pm.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(address(0)),
                currency1: RealCurrency.wrap(USDC),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(hook))
            }),
            sqrtPriceX96
        );

        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);
        // Native ETH is base currency: long ETH buys ETH (isLong = true) and
        // borrows USDC; short sells ETH for USDC. Margin currency follows base.
        hook.setBaseCurrency(poolId, Currency.wrap(address(0)));

        // [FIX M-3] Pin the standard (physical-execution) pool for the hook pool so
        // close/liquidation unwind swaps route through deep standard liquidity instead
        // of the thin hook pool. The standard pool is the DEEP canonical no-hook
        // 0.05% (fee-500/tick-10) pool for the same native ETH/USDC pair
        // (owner-set at deploy; user-supplied keys can never poison liquidation
        // routing — see EswapRouter._swapCallback).
        PoolKey memory standardKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        hook.setStandardPoolKey(poolId, standardKey);

        // Mirror the LIVE re-purposed scalar config (read from the old hook on
        // chain before this redeploy) so the fresh hook is a faithful drop-in.
        hook.setBandConsumptionTriggerBps(2500);
        hook.setOpenInterestCaps(200, 1500, 100000000000000000000000); // maxSingle 200bps / maxTotal 1500bps / TVL floor 1e23
        // insuranceWithdrawalCapBps has no live setter beyond its owner default (5000);
        // the old hook reports 5000, which is the constructor default, so no call needed.

        // Demand side: aggregator exchange proxies (OPT-IN). Both demand
        // entrypoints gate on require(allowedAggregators[route.exchangeProxy]),
        // so without this a freshly deployed router can execute NO aggregator
        // route. Env names match javascript/v4/realApis/demandVenues.js. Unset
        // slots log PENDING; a whitelisted proxy is called with the full
        // notional pre-approved, so we never guess an address.
        _whitelistAggregators(router, "Enso", "AGG_ENSO_PROXY_ADDRESS");
        _whitelistAggregators(router, "Odos", "AGG_ODOS_PROXY_ADDRESS");
        _whitelistAggregators(router, "Bungee", "AGG_BUNGEE_PROXY_ADDRESS");
        _whitelistAggregators(router, "Jumper", "AGG_JUMPER_PROXY_ADDRESS");
        _whitelistAggregators(router, "1inch", "AGG_ONEINCH_ROUTER_ADDRESS");

        // Supply side: venue settlers (OPT-IN, all-or-nothing per settler).
        // Same env contract as the Sepolia full script.
        _maybeDeployUniswapXSettlement(router);
        _maybeDeployOneInchFusionSettlement(router);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Demand-Side Whitelist Status ===");
        _reportAggregators(router);
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Mainnet (Chain ID 130)");
        console.log("Pool:    ETH/USDC (USDC/WETH 3000/60, std 500/60) ONLY");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("MarginLib:   ", vm.toString(libAddr)));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("RouterExt:   ", vm.toString(address(routerExt))));
        console.log(string.concat("Keeper:      ", vm.toString(address(keeper))));
        console.log(string.concat("PriceFeed:   ", vm.toString(address(priceFeed))));
        console.log(string.concat("Treasury:    ", vm.toString(treasury)));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Whitelist the solver on the new router:");
        console.log(string.concat("   router.setSolverWhitelist(SOLVER_ADDRESS, true)"));
        console.log("2. Set answer circuit-breaker bounds (optional, in raw feed units):");
        console.log(string.concat("   priceFeed.setAnswerBounds(WETH, <min>, <max>)"));
        console.log(string.concat("   priceFeed.setAnswerBounds(USDC, <min>, <max>)"));
        console.log("3. Update treasury / leverage / oracle strictness anytime:");
        console.log("   hook.setConfig(ConfigParams(treasury, router, reserveFactor,");
        console.log("       maxPriceSwingBps, defaultMaxLeverage, requireTwapOracle))");
        console.log("4. Seed insurance fund for bad-debt coverage:");
        console.log(string.concat("   hook.seedInsuranceFund(WETH, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(USDC, amount)"));
        console.log("5. Withdraw protocol fees to the treasury (once positions trade):");
        console.log(string.concat("   hook.withdrawProtocolFee(USDC, amount)"));
        console.log("6. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_ROUTER_EXT_ADDRESS=", vm.toString(address(routerExt))));
        console.log(string.concat("   V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log(string.concat("   V4_PRICEFEED_ADDRESS=", vm.toString(address(priceFeed))));
    }

    /// @dev Reads `deployedBytecode.object` length out of the hook's build
    ///      artifact. `type(X).runtimeCode` is not an option: it is rejected for
    ///      contracts with immutables, and this hook has three of them.
    function _deployedBytecodeLength() internal returns (uint256) {
        bytes memory json = bytes(vm.readFile("out/EswapMarginHook.sol/EswapMarginHook.json"));
        bytes memory key = '"deployedBytecode":{"object":"0x';
        uint256 k = _indexOf(json, key);
        require(k > 0, "deployedBytecode not found in hook artifact");
        uint256 start = k + key.length;
        uint256 n = 0;
        while (start + n < json.length && uint8(json[start + n]) != 0x22) n++;
        return n / 2;
    }

    function _indexOf(bytes memory haystack, bytes memory needle) internal pure returns (uint256) {
        require(needle.length > 0 && haystack.length >= needle.length, "bad _indexOf");
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) { eq = false; break; }
            }
            if (eq) return i;
        }
        return 0;
    }

    /// @dev Counts byte offsets in `creation` at which the 20-byte address
    ///      appears. Used to confirm the Foundry linker already resolved the
    ///      library references inside `type(EswapMarginHook).creationCode`.
    function _libraryReferenceCount(bytes memory creation) internal view returns (uint256) {
        address libAddr =
            create2Address(CREATE2_DEPLOYER, bytes32(0), keccak256(type(EswapMarginLib).creationCode));
        uint256 count;
        for (uint256 i = 0; i + 20 <= creation.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < 20; j++) {
                if (creation[i + j] != bytes20(libAddr)[j]) {
                    eq = false;
                    break;
                }
            }
            if (eq) count++;
        }
        return count;
    }

    /// @dev CREATE2 address without deploying. Mirrors OpenZeppelin's
    ///      {Create2.computeAddress} layout (writes above the free-memory ptr),
    ///      so repeated calls in the salt-mining loop neither clobber scratch
    ///      memory nor grow the arena per iteration => no MemoryOOG.
    /// @dev Whitelists one demand-side aggregator exchange proxy when its env
    ///      slot is set. Unset => PENDING and skipped.
    function _whitelistAggregators(EswapRouter router, string memory label, string memory envName) internal {
        address proxy = vm.envOr(envName, address(0));
        if (proxy == address(0)) {
            console.log(string.concat("  [PENDING] ", label, " (", envName, " unset)"));
            return;
        }
        if (!router.allowedAggregators(proxy)) {
            router.setAllowedAggregator(proxy, true);
        }
        console.log(string.concat("  [ROUTABLE] ", label, " ", vm.toString(proxy)));
    }

    /// @dev Prints the final on-chain whitelist state for every aggregator slot.
    function _reportAggregators(EswapRouter router) internal view {
        _reportAggregator(router, "Enso", "AGG_ENSO_PROXY_ADDRESS");
        _reportAggregator(router, "Odos", "AGG_ODOS_PROXY_ADDRESS");
        _reportAggregator(router, "Bungee", "AGG_BUNGEE_PROXY_ADDRESS");
        _reportAggregator(router, "Jumper", "AGG_JUMPER_PROXY_ADDRESS");
        _reportAggregator(router, "1inch", "AGG_ONEINCH_ROUTER_ADDRESS");
    }

    /// @dev Deploys + whitelists the UniswapX settler only when the reactor,
    ///      both tokens and the cap are all supplied. Partial config logs
    ///      [PENDING] rather than deploying a settler that reverts every fill.
    function _maybeDeployUniswapXSettlement(EswapRouter router) internal {
        address reactor = vm.envOr("UNISWAPX_REACTOR_ADDRESS", address(0));
        address input = vm.envOr("UNISWAPX_SETTLEMENT_INPUT_TOKEN", address(0));
        address output = vm.envOr("UNISWAPX_SETTLEMENT_OUTPUT_TOKEN", address(0));
        uint256 maxFill = vm.envOr("UNISWAPX_SETTLEMENT_MAX_FILL", uint256(0));

        if (reactor == address(0) || input == address(0) || output == address(0) || maxFill == 0) {
            console.log("  [PENDING] UniswapX settlement (reactor/input/output/maxFill incomplete)");
            return;
        }

        EswapUniswapXSettlement settler =
            new EswapUniswapXSettlement(IReactor(reactor), IERC20(input), IERC20(output), maxFill);

        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) {
            EswapSettlementOps(address(settler)).setOperator(operator);
            console.log(string.concat("  [SETTLER] UniswapX operator -> ", vm.toString(operator)));
        }
        address recipient = vm.envOr("UNISWAPX_SETTLEMENT_RECIPIENT", address(0));
        if (recipient != address(0)) {
            EswapSettlementOps(address(settler)).setPendingRecipient(recipient);
            console.log(string.concat("  [SETTLER] UniswapX recipient -> ", vm.toString(recipient)));
        } else {
            console.log("  [SETTLER] UniswapX recipient UNSET (validate() reverts until set)");
        }

        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log(string.concat("  [SETTLER] UniswapX ", vm.toString(address(settler))));
    }

    /// @dev Deploys + whitelists the 1inch classic Fusion settler. maxFill bounds
    ///      both makingAmount and the fill amount, and caps the LOP allowance.
    function _maybeDeployOneInchFusionSettlement(EswapRouter router) internal {
        address lop = vm.envOr("ONEINCH_FUSION_LOP_ADDRESS", address(0));
        address makerAsset = vm.envOr("ONEINCH_FUSION_MAKER_ASSET", address(0));
        address takerAsset = vm.envOr("ONEINCH_FUSION_TAKER_ASSET", address(0));
        uint256 maxFill = vm.envOr("ONEINCH_FUSION_MAX_FILL", uint256(0));

        if (lop == address(0) || makerAsset == address(0) || takerAsset == address(0) || maxFill == 0) {
            console.log("  [PENDING] 1inch Fusion settlement (lop/maker/taker/maxFill incomplete)");
            return;
        }

        EswapOneInchFusionSettlement settler =
            new EswapOneInchFusionSettlement(IOrderMixin(lop), IERC20(makerAsset), IERC20(takerAsset), maxFill);

        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) {
            EswapSettlementOps(address(settler)).setOperator(operator);
            console.log(string.concat("  [SETTLER] 1inchFusion operator -> ", vm.toString(operator)));
        }

        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log(string.concat("  [SETTLER] 1inchFusion ", vm.toString(address(settler))));
    }

    function _reportAggregator(EswapRouter router, string memory label, string memory envName) internal view {
        address proxy = vm.envOr(envName, address(0));
        if (proxy == address(0)) {
            console.log(string.concat("  ", label, ": not configured"));
            return;
        }
        console.log(
            string.concat(
                "  ",
                label,
                ": ",
                vm.toString(proxy),
                " whitelisted=",
                router.allowedAggregators(proxy) ? "true" : "false"
            )
        );
    }

    function create2Address(address deployer, bytes32 salt, bytes32 initCodeHash)
        internal
        pure
        returns (address addr)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer)
            let start := add(ptr, 0x0b)
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}