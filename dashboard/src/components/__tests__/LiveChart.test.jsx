import { render, screen } from "@testing-library/react"
import { LiveChart } from "../LiveChart"

describe("LiveChart", () => {
    it("renders with token name", () => {
        render(<LiveChart tokenKey="WETH" />)
        expect(screen.getByText(/Price Chart/)).toBeInTheDocument()
        expect(screen.getByText(/LIVE FEED/)).toBeInTheDocument()
    })

    it("renders DexScreener iframe", () => {
        render(<LiveChart tokenKey="WETH" />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe).toBeInTheDocument()
        expect(iframe.src).toContain("dexscreener.com/unichain")
    })

    it("defaults to ETH when no tokenKey", () => {
        render(<LiveChart />)
        const iframe = screen.getByTitle("DexScreener Live Chart")
        expect(iframe.src).toContain("q=ETH")
    })
})
