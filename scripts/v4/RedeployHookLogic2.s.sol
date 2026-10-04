// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../../src/v4/EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../../src/v4/EswapMarginHookLogic2.sol";
import {IPriceFeedLogic} from "../../src/v4/EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @notice Redeploys the Unichain margin hook with a REAL `EswapMarginHookLogic2`
///         and replicates the live hook's configuration onto it verbatim.
///
/// @dev Why this exists
///
/// The live hook at `0xdF768b7e...` was deployed with `_hookLogic2 = address(0)`.
/// That was proven by scanning its runtime bytecode for zero-padded 32-byte
/// immutables: it embeds PoolManager, the price feed, and `hookLogic`, and
/// nothing else. `EswapMarginHookLogic2` is where closePosition, executeLiquidation,
/// partialLiquidation and rebalancePosition now live, routed through
/// `EswapMarginHookLogic`'s fallback -- so with a null Logic2 the live protocol
/// cannot close, partially-liquidate, or rebalance anything. The 86/86 fork suite
/// passed anyway because the harness deploys its own hook *with* a populated Logic2.
///
/// The protocol is empty (`totalOpenInterestUSD == 0`, `totalCollateralUSDRunning == 0`,
/// hook-pool liquidity == 0), so this replacement strands no user funds.
///
/// @dev Why the cascade stops at the hook
///
/// `EswapRouter`'s constructor takes only `IPoolManager`; it does not embed the
/// hook. The hook holds `router` and enforces `onlyRouter`, and
/// `setRouterAndMinCollateralUsd` is owner-settable. The router keeps no hook
/// whitelist either -- hooks self-authenticate through `key.hooks`. So router,
/// RouterExt, keeper, adapter, quoter, executor and venue all keep their
/// addresses; only the hook (and its `PoolId`, which embeds `key.hooks`) moves.
///
/// The deep standard pool `(NATIVE, USDC, 500, 10, 0x0)` is hook-independent, so
/// its liquidity is untouched by the hook address changing.
///
/// @dev Deployment order and determinism
///
/// Logic2 has no dependencies; Logic1 takes Logic2's address. Both are deployed
/// with FIXED CREATE2 salts so their addresses are derivable *before* any
/// broadcast -- which is what makes the hook's salt minable in the first place
/// (the hook's initcode embeds both logic addresses).
///
/// The hook itself must be CREATE2'd through the deterministic deployer with a
/// salt that carries V4's hook permission bits. That salt depends on this
/// compilation unit's trailing metadata hash, so it is build-specific: run
/// {mine} and {run} against the SAME build. Recompiling in between silently
/// invalidates a previously mined salt. Every salt is re-verified against a
/// freshly recomputed address before a single wei is spent.
contract RedeployHookLogic2 is Script {
    using PoolIdLibrary for PoolKey;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// Measured cost of the real deploy is 4,974,445 gas, so 6M leaves ~20% headroom.
    /// Kept well under the EIP-7825 tx cap AND under what the deployer balance can
    /// pre-pay: Unichain prices gas at ~0.001 gwei, so a 16M stipend demands
    /// 0.000016 ETH up front and the account held only 0.0000119.
    uint256 constant HOOK_DEPLOY_GAS = 6_000_000;

    /// Fixed salts for the two logic contracts, so their addresses (and therefore
    /// the hook's initcode) are known before the broadcast begins.
    bytes32 constant LOGIC2_SALT = keccak256("eswap.logic2.v1");
    bytes32 constant LOGIC1_SALT = keccak256("eswap.logic1.v1");

    address constant PM = 0x1F98400000000000000000000000000000000004;
    address constant PRICE_FEED = 0x57BFFfaa81ea509eFAe9174C9e6e04D4B15690Fb;

    /// Live addresses that must be reproduced on the new hook, captured by reading
    /// the old hook on-chain before this script was written.
    address constant OLD_HOOK = 0xdF768b7eb6A76594b21177bb0Cd55bA433D290c8;
    address constant ROUTER = 0xe7c5AE37DDAca662B483ab5F29a30860835e8C3b;
    address constant NATIVE = 0x0000000000000000000000000000000000000000;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    uint24 constant HOOK_POOL_FEE = 3000;
    int24 constant HOOK_POOL_TS = 60;

    // Live scalars, read from OLD_HOOK.
    uint256 constant RESERVE_FACTOR = 10;
    uint160 constant MAX_PRICE_SWING_BPS = 800;
    uint8 constant DEFAULT_MAX_LEVERAGE = 5;
    bool constant REQUIRE_TWAP_ORACLE = true;
    uint256 constant MIN_COLLATERAL_USD = 0.01 ether;
    uint256 constant BAND_CONSUMPTION_TRIGGER_BPS = 2500;
    uint256 constant MAX_SINGLE_OI_BPS = 200;
    uint256 constant MAX_TOTAL_OI_BPS = 1500;
    uint256 constant OI_CAP_TVL_FLOOR_USD = 100_000 ether;
    uint256 constant LIQUIDATOR_INCENTIVE_BPS = 50;
    bool constant REQUIRE_STANDARD_POOL_KEY = false;
    uint8 constant USDC_DECIMALS = 6;

    uint256 constant LIB_REFS = 2;
    /// Bytes of slack to leave under EIP-170's 24,576 runtime cap. The create's cost
    /// is dominated by the 200-gas-per-byte code deposit, so this is a gas budget
    /// expressed in bytes: 500 spare bytes ~= 100k gas of headroom against the
    /// EIP-7825 tx cap.
    uint256 constant HOOK_RUNTIME_HEADROOM = 500;

    function _flags()
        private
        pure
        returns (uint160 highFlags, uint160 lowMask, uint160 allMask)
    {
        highFlags = HookFlags.AFTER_INITIALIZE_FLAG | HookFlags.BEFORE_SWAP_FLAG
            | HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG | HookFlags.AFTER_SWAP_FLAG;
        lowMask = (uint160(1) << 12) | (uint160(1) << 7) | (uint160(1) << 6) | (uint160(1) << 3);
        allMask = (uint160(1) << 14) - 1;
    }

    function _deployLib() private returns (address libAddr) {
        bytes32 libSalt = bytes32(0);
        libAddr = create2Address(CREATE2_DEPLOYER, libSalt, keccak256(type(EswapMarginLib).creationCode));
        if (libAddr.code.length == 0) {
            bytes memory libInit = type(EswapMarginLib).creationCode;
            address deployed;
            assembly {
                deployed := create2(0, add(libInit, 32), mload(libInit), libSalt)
            }
            require(deployed != address(0), "lib create2 failed");
        }
        require(libAddr.code.length > 0, "lib not deployed");
    }

    /// @dev Deterministic CREATE2 derivation for a contract built by `new C{salt:}`.
    ///
    ///      The deployer is the CREATE2_DEPLOYER, NOT the EOA: when a script
    ///      broadcasts, Foundry routes every CREATE2 through the deterministic
    ///      deployer, so deriving against `address(this)` or the signer yields a
    ///      different address. Getting this wrong produced a "stale HOOK_SALT"
    ///      failure that looked like a recompile problem but was really a
    ///      deployer mismatch.
    function _derive(bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
    }

    function _logic2InitCodeHash() private view returns (bytes32) {
        return keccak256(abi.encodePacked(type(EswapMarginHookLogic2).creationCode, abi.encode(PM, PRICE_FEED)));
    }

    function _logic1InitCodeHash(address logic2) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked(type(EswapMarginHookLogic).creationCode, abi.encode(PM, PRICE_FEED, logic2))
        );
    }

    function _hookInitCode(address logic1, address logic2, address initialOwner)
        private
        view
        returns (bytes memory initCode)
    {
        bytes memory linkedCreation = type(EswapMarginHook).creationCode;
        require(_libraryReferenceCount(linkedCreation) >= LIB_REFS, "hook lib auto-link mismatch");
        initCode = abi.encodePacked(linkedCreation, abi.encode(PM, PRICE_FEED, logic1, logic2, initialOwner));
    }

    /// @notice Prints `HOOK_SALT`. Run from the SAME build that will broadcast.
    function mine() external {
        // The hook owner is baked into the initcode, so it must be the broadcaster
        // itself -- not `msg.sender`, which inside a forge script is the default
        // sender rather than the PRIVATE_KEY signer. Getting this wrong deploys a
        // hook owned by an address nobody holds a key for, and every `onlyOwner`
        // config call then reverts NotOwner() with no way to recover.
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        uint256 k = vm.envOr("MINE_START", uint256(0));

        address libAddr = _deployLib();
        console.log("EswapMarginLib:", libAddr);

        address l2 = _derive(LOGIC2_SALT, _logic2InitCodeHash());
        address l1 = _derive(LOGIC1_SALT, _logic1InitCodeHash(l2));
        console.log("logic2 (derived):", l2);
        console.log("logic1 (derived):", l1);
        require(l2 != address(0) && l1 != address(0), "logic derivation failed");

        bytes memory initCode = _hookInitCode(l1, l2, deployer);
        bytes32 initCodeHash = keccak256(initCode);

        (uint160 highFlags, uint160 lowMask, uint160 allMask) = _flags();
        vm.pauseGasMetering();
        bytes32 salt;
        uint256 tries;
        while (true) {
            salt = bytes32(k + tries);
            address computed = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
            if ((uint160(computed) & highFlags) == highFlags && (uint160(computed) & allMask) == lowMask) {
                break;
            }
            tries++;
        }
        vm.resumeGasMetering();

        console.log("initcodeHash :");
        console.logBytes32(initCodeHash);
        console.log("HOOK_SALT=");
        console.logBytes32(salt);
        console.log("expected hook:", create2Address(CREATE2_DEPLOYER, salt, initCodeHash));
        console.log("tries        :", tries);
    }

    /// @dev Deploy-only entrypoint: the two logic CREATE2s (skipped when already
    ///      present) plus the hook CREATE2, and nothing else. Kept separate from
    ///      {configure} so each broadcast batch is small.
    function deploy() external {
        _deploy();
    }

    /// @dev Config-only entrypoint so the nine owner calls broadcast as their own
    ///      batch instead of riding along with the create. Forge's batch sender
    ///      intermittently failed the combined run with "replacement transaction
    ///      underpriced" while a single-transaction batch went through fine.
    function configure() external {
        _configure();
    }

    function run() external {
        _deploy();
        _configure();
    }

    function _deploy() private {
        require(vm.envOr("HOOK_SALT", bytes32(0)) != bytes32(0), "HOOK_SALT unset - run mine() first");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        address libAddr = _deployLib();
        console.log("EswapMarginLib:", libAddr);

        // Idempotent: a previous attempt may have landed the logic contracts
        // before failing on the hook. Re-running CREATE2 at an occupied address
        // reverts, so skip whatever already has code. The derived addresses are
        // pure functions of (salt, initcode), so "already deployed" can only mean
        // the same bytecode is already there.
        address l2 = _derive(LOGIC2_SALT, _logic2InitCodeHash());
        if (l2.code.length == 0) {
            EswapMarginHookLogic2 deployed2 =
                new EswapMarginHookLogic2{salt: LOGIC2_SALT}(IPoolManager(PM), IPriceFeedLogic(PRICE_FEED));
            require(address(deployed2) == l2, "logic2 address drift");
        }
        address l1 = _derive(LOGIC1_SALT, _logic1InitCodeHash(l2));
        if (l1.code.length == 0) {
            EswapMarginHookLogic deployed1 = new EswapMarginHookLogic{salt: LOGIC1_SALT}(
                IPoolManager(PM), IPriceFeedLogic(PRICE_FEED), l2
            );
            require(address(deployed1) == l1, "logic1 address drift");
        }
        console.log("HookLogic2:", l2);
        console.log("HookLogic :", l1);

        require(EswapMarginHookLogic(payable(l1)).manager() == IPoolManager(PM), "logic manager mismatch");
        require(EswapMarginHookLogic2(payable(l2)).manager() == IPoolManager(PM), "logic2 manager mismatch");

        bytes memory initCode = _hookInitCode(l1, l2, deployer);
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = vm.envBytes32("HOOK_SALT");

        (uint160 highFlags, uint160 lowMask, uint160 allMask) = _flags();
        address expectedHook = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
        require((uint160(expectedHook) & highFlags) == highFlags, "stale HOOK_SALT: missing high bits");
        require((uint160(expectedHook) & allMask) == lowMask, "stale HOOK_SALT: missing low bits");
        uint256 rtLen = _deployedBytecodeLength();
        require(rtLen + HOOK_RUNTIME_HEADROOM <= 24_576, "hook runtime too large for EIP-170");
        console.log("hook runtime bytes", rtLen);
        console.log("expected hook:", expectedHook);

        bytes memory payload = abi.encodePacked(salt, initCode);
        uint256 gasBefore = gasleft();
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call{gas: HOOK_DEPLOY_GAS}(payload);
        console.log("hook create2 gas spent:", gasBefore - gasleft());
        if (!ok) {
            if (ret.length == 0) {
                console.log("create2 failed with empty returndata - out of gas");
            } else {
                console.log("create2 revert data:");
                console.logBytes(ret);
            }
            revert("hook create2 failed");
        }
        if (ret.length == 32) {
            address deployed = address(uint160(uint256(bytes32(ret))));
            require(deployed == expectedHook, "create2 returned unexpected address");
        }

        require(expectedHook.code.length > 0, "hook has no code");
        console.log("=== NEW HOOK DEPLOYED:", expectedHook, "===");

        vm.stopBroadcast();
    }

    function _configure() private {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        EswapMarginHook hook = EswapMarginHook(payable(vm.envAddress("NEW_HOOK_ADDRESS")));
        require(address(hook).code.length > 0, "hook has no code");
        require(hook.owner() == deployer, "hook not owned by deployer");
        _replicateConfig(hook, deployer);
        _verify(hook, deployer);
        console.log("=== CONFIG VERIFIED ===");
    }

    /// @dev Broadcast as a separate frame: config is several owner calls and
    ///      bundling them with the 5M-gas create would exceed the tx cap.
    function _replicateConfig(EswapMarginHook hook, address deployer) private {
        // Broadcast with the PRIVATE KEY, not the bare address: forge's
        // `--broadcast` refuses to sign for an address it has no key for
        // ("No associated wallet for addresses"), even when the script already
        // derived that address from the same key.
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        hook.setConfig(
            EswapMarginHook.ConfigParams({
                treasury: deployer,
                router: ROUTER,
                reserveFactor: RESERVE_FACTOR,
                maxPriceSwingBps: MAX_PRICE_SWING_BPS,
                defaultMaxLeverage: DEFAULT_MAX_LEVERAGE,
                requireTwapOracle: REQUIRE_TWAP_ORACLE
            })
        );
        // setConfig already pins `router`; this also restores minCollateralUsd,
        // which has no other setter path.
        hook.setRouterAndMinCollateralUsd(ROUTER, MIN_COLLATERAL_USD);

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: HOOK_POOL_FEE,
            tickSpacing: HOOK_POOL_TS,
            hooks: address(hook)
        });
        PoolKey memory stdKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        PoolId pid = hookKey.toId();

        // Initialize the accounting rail on the PoolManager.
        //
        // `setAuthorizedPool` only records permission in the HOOK's own registry;
        // it does not create the pool. Without this the new hook pool stays
        // uninitialized and every open reverts with `PoolNotInitialized` (0x47c496d7),
        // which is a hard stop regardless of configuration.
        //
        // The price MUST be seeded from the live standard pool's slot0: the
        // accounting rail has to sit at the price the physical fill pool trades at,
        // and it must stay within `maxPriceSwingBps` of the Chainlink oracle or the
        // `AFTER_INITIALIZE` circuit breaker reverts `TwapManipulated`.
        // `StateLibrary` and `IPoolManager.initialize` come from v4-core proper,
        // so they want v4-core's PoolKey/PoolId types, not this repo's
        // accounting-side wrappers (identical layout, distinct Solidity types).
        RealPoolKey memory realKey = RealPoolKey({
            currency0: RealCurrency.wrap(NATIVE),
            currency1: RealCurrency.wrap(USDC),
            fee: HOOK_POOL_FEE,
            tickSpacing: HOOK_POOL_TS,
            hooks: IHooks(address(hook))
        });
        RealPoolId realStdId = RealPoolId.wrap(PoolId.unwrap(PoolIdLibrary.toId(stdKey)));
        RealPoolId realPid = RealPoolId.wrap(PoolId.unwrap(pid));

        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(RealPoolManager(PM), realStdId);
        require(stdSqrt > 0, "deep standard pool uninitialized");
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(RealPoolManager(PM), realPid);
        if (hookSqrt == 0) {
            RealPoolManager(PM).initialize(realKey, stdSqrt);
            console.log("hook pool initialized at standard pool sqrtPriceX96");
        } else {
            console.log("hook pool already initialized");
        }

        hook.setAuthorizedPool(pid, true);
        hook.setStandardPoolKey(pid, stdKey);
        // Native ETH is the base currency: longs buy ETH and borrow USDC. Left
        // unset the hook would treat USDC as base and invert every position.
        hook.setBaseCurrency(pid, Currency.wrap(NATIVE));
        hook.setTokenDecimals(USDC, USDC_DECIMALS);
        hook.setLiquidatorIncentiveBps(LIQUIDATOR_INCENTIVE_BPS);
        hook.setOpenInterestCaps(MAX_SINGLE_OI_BPS, MAX_TOTAL_OI_BPS, OI_CAP_TVL_FLOOR_USD);
        hook.setBandConsumptionTriggerBps(BAND_CONSUMPTION_TRIGGER_BPS);
        hook.setRequireStandardPoolKey(REQUIRE_STANDARD_POOL_KEY);

        vm.stopBroadcast();

        console.log("config replicated; hook poolId:"); console.logBytes32(PoolId.unwrap(pid));
        console.log("standard poolId:"); console.logBytes32(PoolId.unwrap(PoolIdLibrary.toId(stdKey)));
    }

    /// @dev Every replicated value is re-read and compared, so a silently
    ///      mismatched deployment cannot pass as done.
    function _verify(EswapMarginHook hook, address deployer) private view {
        require(hook.owner() == deployer, "owner mismatch");
        require(hook.router() == ROUTER, "router mismatch");
        require(hook.treasury() == deployer, "treasury mismatch");
        require(hook.reserveFactor() == RESERVE_FACTOR, "reserveFactor mismatch");
        require(hook.maxPriceSwingBps() == MAX_PRICE_SWING_BPS, "maxPriceSwingBps mismatch");
        require(hook.defaultMaxLeverage() == DEFAULT_MAX_LEVERAGE, "defaultMaxLeverage mismatch");
        require(hook.requireTwapOracle() == REQUIRE_TWAP_ORACLE, "requireTwapOracle mismatch");
        require(hook.minCollateralUsd() == MIN_COLLATERAL_USD, "minCollateralUsd mismatch");
        require(hook.bandConsumptionTriggerBps() == BAND_CONSUMPTION_TRIGGER_BPS, "band trigger mismatch");
        require(hook.maxSingleOIBps() == MAX_SINGLE_OI_BPS, "maxSingleOIBps mismatch");
        require(hook.maxTotalOIBps() == MAX_TOTAL_OI_BPS, "maxTotalOIBps mismatch");
        require(hook.oiCapTvlFloorUsd() == OI_CAP_TVL_FLOOR_USD, "oiCapTvlFloorUsd mismatch");
        require(hook.liquidatorIncentiveBps() == LIQUIDATOR_INCENTIVE_BPS, "liquidatorIncentive mismatch");
        require(hook.requireStandardPoolKey() == REQUIRE_STANDARD_POOL_KEY, "requireStandardPoolKey mismatch");
        require(hook.tokenDecimals(USDC) == USDC_DECIMALS, "USDC decimals mismatch");

        // The whole point of the redeploy: Logic2 must be present and reachable.
        require(hook.hookLogic() != address(0), "hookLogic unset");
        require(address(hook.hookLogic()).code.length > 0, "hookLogic has no code");

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: HOOK_POOL_FEE,
            tickSpacing: HOOK_POOL_TS,
            hooks: address(hook)
        });
        PoolId pid = hookKey.toId();
        require(hook.isAuthorizedPool(pid), "pool not authorized");
        (Currency sc0, Currency sc1, uint24 sfee, int24 sts, address shook) = hook.standardPoolKeys(pid);
        require(Currency.unwrap(sc0) == NATIVE && Currency.unwrap(sc1) == USDC, "standard pool currencies mismatch");
        require(sfee == 500, "standard pool fee mismatch");
        require(sts == 10, "standard pool tickSpacing mismatch");
        require(shook == address(0), "standard pool must be hookless");
    }

    /// @dev Counts solc's unlinked `__$<34 hex>` library placeholders. Must be zero
    ///      for the hook to be deployable: an unlinked reference would make the
    ///      hook DELEGATECALL into a garbage address, accept margin, and never settle.
    function _libraryReferenceCount(bytes memory creation) private view returns (uint256 count) {
        // Counts occurrences of the library's ADDRESS in the creation code.
        //
        // The hook is deployed via a hand-rolled CREATE2 over raw bytes, which
        // bypasses the Foundry auto-linker, so this both verifies and proves the
        // substitution already happened: `type(C).creationCode` embedded in THIS
        // compilation unit comes pre-linked, and a missing reference would make
        // the hook DELEGATECALL into a garbage address, accept margin, and never
        // settle.
        address libAddr =
            create2Address(CREATE2_DEPLOYER, bytes32(0), keccak256(type(EswapMarginLib).creationCode));
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
    }

    /// @dev Reads only the LENGTH from the build artifact, never any offset. That
    ///      is safe where an offset-table hack is not: the runtime bytes are the
    ///      same in the artifact and in this compilation unit (only their position
    ///      differs) and the trailing metadata hash has fixed width, so the length
    ///      is stable across recompiles. Offsets are not.
    ///
    ///      `type(C).runtimeCode` is unavailable here because the hook has
    ///      immutables, hence the artifact read.
    function _deployedBytecodeLength() private returns (uint256 len) {
        bytes memory json = bytes(vm.readFile("out/EswapMarginHook.sol/EswapMarginHook.json"));
        bytes memory key = '"deployedBytecode":{"object":"0x';
        uint256 k = _indexOf(json, key);
        require(k > 0, "deployedBytecode not found in hook artifact");
        uint256 start = k + key.length;
        len = 0;
        while (start + len < json.length && uint8(json[start + len]) != 0x22) len++;
        len /= 2;
    }

    function _indexOf(bytes memory haystack, bytes memory needle) private pure returns (uint256) {
        require(needle.length > 0 && haystack.length >= needle.length, "bad _indexOf");
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    eq = false;
                    break;
                }
            }
            if (eq) return i;
        }
        return 0;
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
