// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "@solmate/tokens/ERC20.sol";

import "@solmate/utils/FixedPointMathLib.sol";
import "@uniswapCore/contracts/libraries/FullMath.sol";
import "@uniswapPeriphery/contracts/libraries/TransferHelper.sol";
import "@uniswapPeriphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswapPeriphery/contracts/interfaces/ISwapRouter.sol";
import {UniswapV3Pool} from "@uniswapCore/contracts/UniswapV3Pool.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IUniswapV3Factory} from "@uniswapCore/contracts/interfaces/IUniswapV3Factory.sol";

/**
 * @title UniswapV3Helper
 * @author Based on original work, with security enhancements
 * @notice This contract is a helper to interact with Uniswap V3, simplifying swaps and liquidity management.
 * @dev SECURITY: This contract is entirely dependent on the correct and secure functioning of the Uniswap V3
 * protocol, including the INonfungiblePositionManager and ISwapRouter. Any vulnerability, bug, or unexpected
 * behavior in Uniswap could directly and negatively impact this helper contract and any contracts that rely on it.
 * Users and developers should be aware of the inherent risks of such deep integration.
 */
contract UniswapV3Helper is IERC721Receiver {
    using FixedPointMathLib for uint256;
    ISwapRouter public immutable swapRouter;
    INonfungiblePositionManager public immutable nonfungiblePositionManager;

    // Hardcoded max slippage for security without changing the ABI
    uint256 private constant MAX_SLIPPAGE_BIPS = 200; // 2% in basis points

    /// @notice Represents the deposit of an NFT
    struct Deposit {
        address owner;
        uint128 liquidity;
        address token0;
        address token1;
    }

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public deposits;
    address private feeRecipient;

    constructor(address _nonfungiblePositionManager, address _swapRouter) {
        // SECURITY: Ensure addresses are not zero
        require(_nonfungiblePositionManager != address(0), "Invalid position manager address");
        require(_swapRouter != address(0), "Invalid swap router address");
        nonfungiblePositionManager = INonfungiblePositionManager(_nonfungiblePositionManager);
        swapRouter = ISwapRouter(_swapRouter);
        feeRecipient = msg.sender;
    }

    // ------ SWAP ------

    /** @dev Swap Helper */
    function swapExactInputSingle(
        address _token0,
        address _token1,
        uint24 _fee,
        uint256 _amountIn
    ) public returns (uint256 amountOut) {
        uint256 feeAmount = (_amountIn * 1) / 100;
        TransferHelper.safeTransferFrom(_token0, msg.sender, address(this), _amountIn);
        TransferHelper.safeTransfer(_token0, feeRecipient, feeAmount);
        TransferHelper.safeApprove(_token0, address(swapRouter), _amountIn - feeAmount);

        uint256 amountOutMinimum = 0;
        
        IUniswapV3Factory factory = IUniswapV3Factory(nonfungiblePositionManager.factory());
        address poolAddress = factory.getPool(_token0, _token1, _fee);
        
        if (poolAddress != address(0)) {
            UniswapV3Pool pool = UniswapV3Pool(poolAddress);
            (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
            
            uint256 priceRatio = FullMath.mulDiv(
                uint256(sqrtPriceX96) * uint256(sqrtPriceX96),
                1e18, 
                1 << 192
            );
            
            uint256 expectedAmountOut = FullMath.mulDiv(
                _amountIn,
                priceRatio,
                1e18
            );

            uint8 decimals0 = ERC20(_token0).decimals();
            uint8 decimals1 = ERC20(_token1).decimals();

            if (decimals1 > decimals0) {
                expectedAmountOut = expectedAmountOut * (10**(decimals1 - decimals0));
            } else if (decimals0 > decimals1) {
                expectedAmountOut = expectedAmountOut / (10**(decimals0 - decimals1));
            }

            amountOutMinimum = expectedAmountOut * (10000 - MAX_SLIPPAGE_BIPS) / 10000;
        }

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: _token0,
            tokenOut: _token1,
            fee: _fee,
            recipient: msg.sender,
            deadline: block.timestamp,
            amountIn: _amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = swapRouter.exactInputSingle(params);
        TransferHelper.safeApprove(_token0, address(swapRouter), 0);
    }

    function swapExactOutputSingle(
        address _token0,
        address _token1,
        uint24 _fee,
        uint256 amountOut,
        uint256 amountInMaximum
    ) public returns (uint256 amountIn) {
        TransferHelper.safeTransferFrom(_token0, msg.sender, address(this), amountInMaximum);
        TransferHelper.safeApprove(_token0, address(swapRouter), amountInMaximum);
        
        // FIX: Slippage Vulnerability. Calculate an internal, stricter amountInMaximum based on the current price.
        uint256 finalAmountInMaximum = amountInMaximum;

        IUniswapV3Factory factory = IUniswapV3Factory(nonfungiblePositionManager.factory());
        address poolAddress = factory.getPool(_token0, _token1, _fee);

        if (poolAddress != address(0)) {
            UniswapV3Pool pool = UniswapV3Pool(poolAddress);
            (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
            
            if (sqrtPriceX96 > 0) {
                // Calculate expected input amount for the given output amount
                uint256 numerator1 = uint256(amountOut) << 192;
                uint256 denominator1 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
                uint256 expectedAmountIn = FullMath.mulDiv(numerator1, 1, denominator1);

                uint8 decimals0 = ERC20(_token0).decimals();
                uint8 decimals1 = ERC20(_token1).decimals();

                if (decimals0 > decimals1) {
                    expectedAmountIn = expectedAmountIn * (10**(decimals0 - decimals1));
                } else if (decimals1 > decimals0) {
                    expectedAmountIn = expectedAmountIn / (10**(decimals1 - decimals0));
                }

                uint256 calculatedAmountInMax = (expectedAmountIn * (10000 + MAX_SLIPPAGE_BIPS)) / 10000;
                
                // Use the stricter of the two limits: our calculated one vs the user's provided one.
                if (calculatedAmountInMax < finalAmountInMaximum) {
                    finalAmountInMaximum = calculatedAmountInMax;
                }
            }
        }

        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams({
            tokenIn: _token0,
            tokenOut: _token1,
            fee: _fee,
            recipient: address(this),
            deadline: block.timestamp,
            amountOut: amountOut,
            amountInMaximum: finalAmountInMaximum, // Use the safer maximum
            sqrtPriceLimitX96: 0
        });

        try swapRouter.exactOutputSingle(params) returns (uint amountIn_) {
            amountIn = amountIn_;
            uint256 feeAmount = (amountOut * 1) / 100;
            TransferHelper.safeTransfer(_token1, feeRecipient, feeAmount);
            TransferHelper.safeTransfer(_token1, msg.sender, amountOut - feeAmount);
            TransferHelper.safeApprove(_token0, address(swapRouter), 0);
            if (amountIn < amountInMaximum) {
                TransferHelper.safeTransfer(_token0, msg.sender, amountInMaximum - amountIn);
            }
        } catch {
            amountIn = 0;
            TransferHelper.safeApprove(_token0, address(swapRouter), 0);
            TransferHelper.safeTransfer(_token0, msg.sender, amountInMaximum);
        }
    }

    // ----- Liquidity -----

    function onERC721Received(
        address operator,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        _createDeposit(operator, tokenId);
        return this.onERC721Received.selector;
    }

    function _createDeposit(address owner, uint256 tokenId) internal {
        (
            ,
            ,
            address token0,
            address token1,
            ,
            ,
            ,
            uint128 liquidity,
            ,
            ,
            ,
        ) = nonfungiblePositionManager.positions(tokenId);

        deposits[tokenId] = Deposit({
            owner: owner,
            liquidity: liquidity,
            token0: token0,
            token1: token1
        });
    }

    function mintPosition(
        UniswapV3Pool _v3Pool,
        uint256 _amount0ToMint,
        uint256 _amount1ToMint,
        int24 _tickLower,
        int24 _tickUpper
    ) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
        if (_amount0ToMint != 0) {
            TransferHelper.safeTransferFrom(_v3Pool.token0(), msg.sender, address(this), _amount0ToMint);
            TransferHelper.safeApprove(_v3Pool.token0(), address(nonfungiblePositionManager), _amount0ToMint);
        }
        if (_amount1ToMint != 0) {
            TransferHelper.safeTransferFrom(_v3Pool.token1(), msg.sender, address(this), _amount1ToMint);
            TransferHelper.safeApprove(_v3Pool.token1(), address(nonfungiblePositionManager), _amount1ToMint);
        }

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
                token0: _v3Pool.token0(),
                token1: _v3Pool.token1(),
                fee: _v3Pool.fee(),
                tickLower: _tickLower,
                tickUpper: _tickUpper,
                amount0Desired: _amount0ToMint,
                amount1Desired: _amount1ToMint,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            });

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(params);
        _createDeposit(msg.sender, tokenId);

        if (amount0 < _amount0ToMint) {
            TransferHelper.safeApprove(_v3Pool.token0(), address(nonfungiblePositionManager), 0);
            uint refund0 = _amount0ToMint - amount0;
            TransferHelper.safeTransfer(_v3Pool.token0(), msg.sender, refund0);
        }

        if (amount1 < _amount1ToMint) {
            TransferHelper.safeApprove(_v3Pool.token1(), address(nonfungiblePositionManager), 0);
            uint refund1 = _amount1ToMint - amount1;
            TransferHelper.safeTransfer(_v3Pool.token1(), msg.sender, refund1);
        }
    }
    
    /**
     * @notice Collects all pending fees for a given liquidity position.
     * @dev SECURITY: This function checks that msg.sender is the owner of the NFT deposit record
     * within this contract. It is designed to be called by a trusted manager contract (e.g., the Positions contract),
     * which holds the NFT on behalf of the end-user. The security of the end-user's funds is therefore
     * dependent on the calling contract's logic to correctly authorize calls to this function.
     * @param tokenId The ID of the position from which to collect fees.
     * @return amount0 The amount of token0 collected.
     * @return amount1 The amount of token1 collected.
     */
    function collectAllFees(uint256 tokenId) external returns (uint256 amount0, uint256 amount1) {
        require(msg.sender == deposits[tokenId].owner, "Not the owner");

        INonfungiblePositionManager.CollectParams memory params = INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });

        (amount0, amount1) = nonfungiblePositionManager.collect(params);
        _sendToOwner(tokenId, amount0, amount1);
    }
    
    /**
     * @notice Decreases the liquidity of a position entirely.
     * @dev SECURITY: This function checks that msg.sender is the owner of the NFT deposit record.
     * As with other critical functions, it relies on a trusted calling contract to manage authorization
     * on behalf of the end-user.
     */
    function decreaseLiquidity(
        uint256 tokenId
    ) external returns (uint256 amount0, uint256 amount1) {
        require(msg.sender == deposits[tokenId].owner, "Not the owner");
        uint128 liquidity = deposits[tokenId].liquidity;

        INonfungiblePositionManager.DecreaseLiquidityParams memory params = INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            });

        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(params);
        
        _sendToOwner(tokenId, amount0, amount1);
    }

    function increaseLiquidityCurrentRange(
        uint256 tokenId,
        uint256 amountAdd0,
        uint256 amountAdd1
    ) external returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        TransferHelper.safeTransferFrom(deposits[tokenId].token0, msg.sender, address(this), amountAdd0);
        TransferHelper.safeTransferFrom(deposits[tokenId].token1, msg.sender, address(this), amountAdd1);

        TransferHelper.safeApprove(deposits[tokenId].token0, address(nonfungiblePositionManager), amountAdd0);
        TransferHelper.safeApprove(deposits[tokenId].token1, address(nonfungiblePositionManager), amountAdd1);

        INonfungiblePositionManager.IncreaseLiquidityParams memory params = INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amountAdd0,
                amount1Desired: amountAdd1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            });

        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(params);

        if (amount0 < amountAdd0) {
            TransferHelper.safeApprove(deposits[tokenId].token0, address(nonfungiblePositionManager), 0);
            uint256 refund0 = amountAdd0 - amount0;
            TransferHelper.safeTransfer(deposits[tokenId].token0, msg.sender, refund0);
        }
        if (amount1 < amountAdd1) {
            TransferHelper.safeApprove(deposits[tokenId].token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = amountAdd1 - amount1;
            TransferHelper.safeTransfer(deposits[tokenId].token1, msg.sender, refund1);
        }
    }

    function _sendToOwner(uint256 tokenId, uint256 amount0, uint256 amount1) internal {
        address owner = deposits[tokenId].owner;
        address token0 = deposits[tokenId].token0;
        address token1 = deposits[tokenId].token1;
        if (amount0 > 0) {
             TransferHelper.safeTransfer(token0, owner, amount0);
        }
        if (amount1 > 0) {
            TransferHelper.safeTransfer(token1, owner, amount1);
        }
    }

    /**
     * @notice Allows the owner of a deposit to retrieve their Uniswap V3 LP NFT.
     * @dev SECURITY: Relies on the deposit owner record and a trusted calling contract for authorization.
     */
    function retrieveNFT(uint256 tokenId) external {
        require(msg.sender == deposits[tokenId].owner, "Not the owner");
        nonfungiblePositionManager.safeTransferFrom(address(this), msg.sender, tokenId);
        delete deposits[tokenId];
    }

    function getLiquidity(uint _tokenId) public view returns (uint128) {
        (, , , , , , , uint128 liquidity, , , , ) = nonfungiblePositionManager.positions(_tokenId);
        return liquidity;
    }

    // ----- Maths -----
    
    function sqrtPriceX96ToPrice(
        uint160 sqrtPriceX96,
        uint8 decimalsToken0
    ) public pure returns (uint160) {
        return
            uint160(
                FullMath.mulDiv(
                    uint256(sqrtPriceX96) * uint256(sqrtPriceX96),
                    10 ** decimalsToken0,
                    (1 << 192)
                )
            );
    }
    
    function priceToSqrtPriceX96(
        uint160 price,
        uint8 decimalsToken0
    ) public pure returns (uint160) {
        return
            uint160(
                FullMath.mulDiv(
                    FixedPointMathLib.sqrt(uint256(price)),
                    1 << 96,
                    (10 ** (decimalsToken0 >> 1))
                )
            );
    }
}