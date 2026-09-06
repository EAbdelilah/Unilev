import { render, screen } from "@testing-library/react"
import { LiveChart } from "../LiveChart"

const UNICHAIN_WETH = "0x8927058918e3CFf6F55EfE45A58db1be1F069E49"
const UNICHAIN_WBTC = "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939"
const POLYGON_WETH = "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d"
const POLYGON_WBTC = "0xeEF1A9507B3D505f0062f2be9453981255b503c8"

describe("LiveChart", () => {
    it("renders the WETH pair header and live badge", () => {
        render(<LiveChart tokenKey="WETH" />)
        expect(screen.getByText("ETH/USDC")).toBeInTheDocument()
        expect(screen.getByText("Live")).toBeInTheDocument()
        expect(screen.getByText("unichain · 15m")).toBeInTheDocument()
    })

    it("shows the BTC/USDC label for WBTC", () => {
        render(<LiveChart tokenKey="WBTC" />)
        expect(screen.getByText("BTC/USDC")).toBeInTheDocument()
    })

    it("defaults to the WETH/USDC pair on Unichain", () => {
        render(<LiveChart tokenKey="WETH" />)
        const iframe = screen.getByTitle("ETH/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/unichain/${UNICHAIN_WETH}`)
    })

    it("uses the Polygon network + pair for chain 137", () => {
        render(<LiveChart tokenKey="WETH" chainId={137} />)
        const iframe = screen.getByTitle("ETH/USDC Price Chart")
        expect(iframe.src).toContain(`dexscreener.com/polygon/${POLYGON_WETH}`)
    })

    it("switches the chart to the BTC/USDC pair", () => {
        render(<LiveChart tokenKey="WBTC" />)
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
        expect(screen.getByRole("button", { name: /BTC\/USDC/ })).toBeInTheDocument()
        expect(screen.getByText(/Open on DexScreener/)).toBeInTheDocument()
    })
})