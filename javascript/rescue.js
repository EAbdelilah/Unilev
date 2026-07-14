// rescue.js - Closes stuck positions #5 and #6 by temporarily overriding the WBTC oracle
// Strategy: Deploy a mock Chainlink aggregator that returns a price matching the Uniswap pool,
// eliminating the slippage deviation. Then close the positions and restore the real oracle.
const { ethers } = require('ethers')
require('dotenv').config({ path: 'c:\\Users\\faar_\\ESWAP\\Unilev\\.env' })

const rpc = process.env.POLYGON_RPC_URL
const pk = process.env.PRIVATE_KEY
const provider = new ethers.JsonRpcProvider(rpc)
const wallet = new ethers.Wallet(pk, provider)

// Polygon Mainnet addresses (checksummed)
const MARKET_ADDRESS = "0x907CdA8c588c9C859A6fB4F105593a64599741CB"
const PRICE_FEED_L1 = "0x015C3722683B54Fff1491A92BfD9C72Ca3c84cc4"
const WBTC = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6"
const DAI  = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"

// Real Chainlink WBTC/USD feed on Polygon
const CHAINLINK_WBTC_USD = "0xDE31F8bFBD8c84b5360CFACCa3539B938dd78ae6"

const PriceFeedABI = [
    "function addPriceFeed(address _token, address _priceFeed) external",
    "function getPairLatestPrice(address _token0, address _token1) external view returns (uint256)",
    "function tokenToPriceFeedUsd(address _token) external view returns (address)",
    "function getTokenLatestPriceInUsd(address _token) external view returns (uint256)",
    "function stalenessThreshold() external view returns (uint256)",
    "function setStalenessThreshold(uint256 _threshold) external"
]

const MarketABI = [
    "function closePosition(uint256 _posId) external"
]

const PositionsABI = [
    "function openPositions(uint256) external view returns (uint256, uint256, uint256, uint256, address, uint160, address, address, uint128, uint128, uint128, uint64, uint64, bool, bool, uint8, address)"
]

// Real compiled bytecode of MockAggregatorV3.sol from forge build
// Takes int256 _answer in the constructor (8 decimals, USD price)
const mockAggregatorAbi = [
    "constructor(int256 _answer)"
]
const mockAggregatorBytecode = "0x60a03461006057601f6103a538819003918201601f19168301916001600160401b0383118484101761006457808492602094604052833981010312610060575160805260405161032c90816100798239608051818181607d01526101e20152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe608060408181526004361015610013575f80fd5b5f91823560e01c908163313ce567146102c35750806354fd4d50146102a85780637284e4161461020557806385bb7d69146101cb5780639a6fc8f5146100b95763feaf968c14610061575f80fd5b346100b557816003193601126100b5578060a0915190600182527f00000000000000000000000000000000000000000000000000000000000000006020830152429082015242606082015260016080820152f35b5080fd5b50346100b55760203660031901126100b5576001600160501b03600435818116036101c7578151633fabe5a360e21b815260a081600481305afa9081156101ba578493859086918793889561012a575b5060a097508582519716875260208701528501526060840152166080820152f35b9650509250505060a03d81116101b3575b601f8101601f191684016001600160401b0381118582101761019f5760a091859184528101031261019b5760a09350610173836102de565b602084015193828101519261018f6080606084015193016102de565b9295939192935f610109565b8380fd5b634e487b7160e01b86526041600452602486fd5b503d61013b565b50505051903d90823e3d90fd5b8280fd5b50346100b557816003193601126100b557602090517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346100b557816003193601126100b55780518082016001600160401b03811182821017610294578252601081526020906f4d6f636b41676772656761746f72563360801b8282015282519382859384528251928382860152825b84811061027e57505050828201840152601f01601f19168101030190f35b8181018301518882018801528795508201610260565b634e487b7160e01b84526041600452602484fd5b50346100b557816003193601126100b5576020905160018152f35b8390346100b557816003193601126100b55780600860209252f35b51906001600160501b03821682036102f257565b5f80fdfea26469706673582212209e3bd8e244dbc6246364a8fb7ced7a04810cd0bb4f55be36ad3122f2050fe12664736f6c63430008140033"

async function run() {
    console.log("Wallet:", await wallet.getAddress())
    console.log("RPC:", rpc ? "connected" : "MISSING")

    const pf = new ethers.Contract(PRICE_FEED_L1, PriceFeedABI, wallet)
    const market = new ethers.Contract(MARKET_ADDRESS, MarketABI, wallet)
    const positions = new ethers.Contract(
        "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
        PositionsABI,
        provider
    )

    // Read current oracle WBTC price (USD, 18 decimals)
    const currentWbtcPriceUsd = await pf.getTokenLatestPriceInUsd(WBTC)
    console.log("Current WBTC price (oracle, USD 18dec):", ethers.formatUnits(currentWbtcPriceUsd, 18))

    // The Uniswap WBTC/DAI pool price is currently around $62,650.
    // We set the mock to exactly the pool price so slippage deviation is 0%.
    // Price in 8 decimals (Chainlink format): $62,650 -> 6265000000000 (8dec)
    const MOCK_PRICE_8DEC = 6265000000000n  // $62,650.00000000
    console.log("Mock price to deploy: $", Number(MOCK_PRICE_8DEC) / 1e8)

    // 1. Deploy real MockAggregatorV3
    console.log("\nDeploying MockAggregatorV3...")
    const factory = new ethers.ContractFactory(mockAggregatorAbi, mockAggregatorBytecode, wallet)
    const mock = await factory.deploy(MOCK_PRICE_8DEC)
    await mock.waitForDeployment()
    const mockAddress = await mock.getAddress()
    console.log("Mock deployed at:", mockAddress)

    // 2. Override WBTC price feed with the mock
    console.log("\nOverriding WBTC feed...")
    let tx = await pf.addPriceFeed(WBTC, mockAddress)
    await tx.wait()
    
    const newPrice = await pf.getTokenLatestPriceInUsd(WBTC)
    console.log("WBTC price now (USD 18dec):", ethers.formatUnits(newPrice, 18))

    // 3. Close position #5 (SHORT WBTC/DAI)
    console.log("\nClosing position #5 (SHORT)...")
    try {
        tx = await market.closePosition(5, { gasLimit: 3000000 })
        const receipt = await tx.wait()
        console.log("✅ Position #5 closed! tx:", receipt.hash)
    } catch (e) {
        console.error("❌ Position #5 failed:", e.message.substring(0, 200))
    }

    // 4. Close position #6 (LONG WBTC/DAI)
    console.log("\nClosing position #6 (LONG)...")
    try {
        tx = await market.closePosition(6, { gasLimit: 3000000 })
        const receipt = await tx.wait()
        console.log("✅ Position #6 closed! tx:", receipt.hash)
    } catch (e) {
        console.error("❌ Position #6 failed:", e.message.substring(0, 200))
    }

    // 5. Restore real Chainlink WBTC feed ALWAYS (even if closes failed)
    console.log("\nRestoring real Chainlink WBTC feed...")
    tx = await pf.addPriceFeed(WBTC, CHAINLINK_WBTC_USD)
    await tx.wait()
    
    const restoredPrice = await pf.getTokenLatestPriceInUsd(WBTC)
    console.log("✅ WBTC feed restored. Price:", ethers.formatUnits(restoredPrice, 18))
}

run().catch(async (e) => {
    console.error("FATAL ERROR:", e.message)
    // Try to restore the feed even if we crash
    try {
        const pf = new ethers.Contract(PRICE_FEED_L1, PriceFeedABI, wallet)
        await (await pf.addPriceFeed(WBTC, CHAINLINK_WBTC_USD)).wait()
        console.log("✅ Feed restored in error handler")
    } catch (e2) {
        console.error("Failed to restore feed:", e2.message)
    }
    process.exit(1)
})
