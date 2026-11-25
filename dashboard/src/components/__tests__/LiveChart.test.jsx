import { render, screen } from "@testing-library/react"
import { LiveChart } from "../LiveChart"

const BASE_WETH = "0x6c561B446416E1A00E8E93E221854d6eA4171372"
const BASE_CBBTC = "0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef"
const UNICHAIN_WETH = "0x8927058918e3CFf6F55EfE45A58db1be1F069E49"
const UNICHAIN_WBTC = "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939"
const POLYGON_WETH = "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d"
const POLYGON_WBTC = "0xeEF1A9507B3D505f0062f2be9453981255b503c8"

describe("LiveChart", () => {
    it("renders the WETH pair header and live badge on Base by default", () => {
        render(<LiveChart tokenKey="WETH" />)
        expect(screen.getByText("ETH/USDC")).toBeInTheDocument()
        expect(screen.getByText("Live")).toBeInTheDocument()
        expect(screen.getByText("base · 15m")).toBeInTheDocument()
    })

    it("shows the cbBTC/USDC label for cbBTC", () => {
        render(<LiveChart tokenKey="cbBTC" />)
        expect(screen.getByText("cbBTC/USDC")).toBeInTheDocument()
    })

    it("defaults to the WETH/USDC pair on Base", () => {
        render(<LiveChart tokenKey="WETH" />)
        const iframe = screen.getByTitle("ETH/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/base/${BASE_WETH}`)
    })

    it("uses the Unichain network + pair for chain 130", () => {
        render(<LiveChart tokenKey="WETH" chainId={130} />)
        const iframe = screen.getByTitle("ETH/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/unichain/${UNICHAIN_WETH}`)
    })

    it("uses the Polygon network + pair for chain 137", () => {
        render(<LiveChart tokenKey="WETH" chainId={137} />)
        const iframe = screen.getByTitle("ETH/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/polygon/${POLYGON_WETH}`)
    })

    it("switches the chart to the cbBTC/USDC pair on Base", () => {
        render(<LiveChart tokenKey="cbBTC" />)
        const iframe = screen.getByTitle("cbBTC/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/base/${BASE_CBBTC}`)
    })

    it("uses the Unichain WBTC pair for chain 130", () => {
        render(<LiveChart tokenKey="WBTC" chainId={130} />)
        const iframe = screen.getByTitle("BTC/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/unichain/${UNICHAIN_WBTC}`)
    })

    it("uses the Polygon BTC/USDC pair for chain 137", () => {
        render(<LiveChart tokenKey="WBTC" chainId={137} />)
        const iframe = screen.getByTitle("BTC/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/polygon/${POLYGON_WBTC}`)
    })

    it("exposes pair toggle buttons and a fallback link", () => {
        render(<LiveChart tokenKey="WETH" onTokenChange={() => {}} />)
        expect(screen.getByRole("button", { name: /ETH\/USDC/ })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /cbBTC\/USDC/ })).toBeInTheDocument()
        expect(screen.getByText(/Open on DexScreener/)).toBeInTheDocument()
    })
})
