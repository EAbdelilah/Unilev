// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../EswapMarginHookLogic2.sol";
import {IPriceFeedLogic} from "../EswapMarginHookLogicStorage.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

/**
 * @title EswapHookDeployLib
 * @notice Test helper for the [EIP-3860 split] hook constructor.
 *
 * @dev `EswapMarginHook` no longer `new`s its two logic contracts inline; they
 *      are deployed separately and passed in as constructor arguments. Without
 *      that, the hook's initcode was 19,728 + 24,662 + 23,596 = 68,676 bytes
 *      against the EIP-3860 49,152-byte cap, so the hook could not be deployed
 *      on any EVM enforcing initcode limits. Wiring the children externally
 *      drops the initcode to 24,529 bytes.
 *
 *      Deployment order matters: `EswapMarginHookLogic2` first (it has no
 *      dependencies), then `EswapMarginHookLogic` (which takes the logic2
 *      address), then the hook itself.
 *
 *      `deployHookAt` mirrors forge-std's `deployCodeTo(what, args, 0, where)`
 *      exactly — `vm.getCode` for the creation code, `vm.etch` the
 *      creation-code-plus-args at the target, call it so the constructor runs,
 *      then `vm.etch` the returned runtime back. It exists as a library taking
 *      `Vm` explicitly so the 40+ call sites need only an import and a
 *      one-line replacement, with no base-contract or inheritance churn.
 *
 *      Hooks must live at flag-bearing addresses, so the address is supplied by
 *      the caller rather than derived.
 */
library EswapHookDeployLib {
    /// @notice Deploys both logic contracts, then the hook at `hookAddress`.
    /// @return hook       The typed hook handle for `hookAddress`.
    /// @return logic      The delegatecall'd settlement/collateral logic.
    /// @return logic2     The delegatecall'd close/liquidation/rebalance logic.
    function deployHookAt(Vm vm, address manager, address priceFeed, address owner, address hookAddress)
        internal
        returns (EswapMarginHook hook, address logic, address logic2)
    {
        (logic, logic2) = deployLogic(manager, priceFeed);
        _deployHookTo(vm, manager, priceFeed, logic, logic2, owner, hookAddress);
        hook = EswapMarginHook(payable(hookAddress));
    }

    /// @notice Deploys the two logic contracts alone (hook deployed elsewhere).
    /// @dev `manager` / `priceFeed` are taken as `address` so call sites can pass
    ///      whatever local type they already hold (`IPoolManager`, `IPriceFeed`,
    ///      a `PriceFeedMock`, or an already-`address`-cast value).
    function deployLogic(address manager, address priceFeed) internal returns (address logic, address logic2) {
        EswapMarginHookLogic2 l2 = new EswapMarginHookLogic2(IPoolManager(manager), IPriceFeedLogic(priceFeed));
        EswapMarginHookLogic l1 = new EswapMarginHookLogic(IPoolManager(manager), IPriceFeedLogic(priceFeed), address(l2));
        logic = address(l1);
        logic2 = address(l2);
    }

    function _deployHookTo(
        Vm vm,
        address manager,
        address priceFeed,
        address logic,
        address logic2,
        address owner,
        address hookAddress
    ) private {
        bytes memory creationCode = vm.getCode("EswapMarginHook.sol:EswapMarginHook");
        bytes memory args = abi.encode(manager, priceFeed, logic, logic2, owner);
        vm.etch(hookAddress, abi.encodePacked(creationCode, args));
        (bool success, bytes memory runtimeBytecode) = hookAddress.call("");
        require(success, "EswapHookDeployLib: hook constructor reverted");
        vm.etch(hookAddress, runtimeBytecode);
    }
}
