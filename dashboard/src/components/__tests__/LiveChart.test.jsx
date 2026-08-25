import { render, screen } from "@testing-library/react"
import { LiveChart } from "../LiveChart"

const UNICHAIN_WETH = "0x8927058918e3CFf6F55EfE45A58db1be1F069E49"
const UNICHAIN_WBTC = "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939"
const POLYGON_WETH = "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d"
const POLYGON_WBTC = "0xeEF1A9507B3D505f0062f2be9453981255b503c8"

describe("LiveChart", () => {
    it("renders with pair name", () => {
        render(<LiveChart tokenKey="WETH" />)
        expect(screen.getByText(/Price Chart/)).toBeInTheDocument()
        expect(screen.getByText(/LIVE FEED/)).toBeInTheDocument()
    })

    it("shows the pair label for the selected token", () => {
        render(<LiveChart tokenKey="WBTC" />)
        expect(screen.getByText(/WBTC\/USDC Price Chart/)).toBeInTheDocument()
    })

    it("defaults to the WETH/USDC pair on Unichain", () => {
        render(<LiveChart tokenKey="WETH" />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe.src).toContain(`dexscreener.com/unichain/${UNICHAIN_WETH}`)
    })

    it("uses the Polygon network + pair for chain 137", () => {
        render(<LiveChart tokenKey="WETH" chainId={137} />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe.src).toContain(`dexscreener.com/polygon/${POLYGON_WETH}`)
    })

    it("switches the chart to the WBTC/USDC pair", () => {
        render(<LiveChart tokenKey="WBTC" />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe.src).toContain(`dexscreener.com/unichain/${UNICHAIN_WBTC}`)
    })

    it("uses the Polygon WBTC/USDC pair for chain 137", () => {
        render(<LiveChart tokenKey="WBTC" chainId={137} />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe.src).toContain(`dexscreener.com/polygon/${POLYGON_WBTC}`)
    })

    it("exposes pair toggle buttons and a fallback link", () => {
        render(<LiveChart tokenKey="WETH" onTokenChange={() => {}} />)
        expect(screen.getByText("WETH/USDC")).toBeInTheDocument()
        expect(screen.getByText("WBTC/USDC")).toBeInTheDocument()
        expect(screen.getByText(/Open chart on DexScreener/)).toBeInTheDocument()
    })
})