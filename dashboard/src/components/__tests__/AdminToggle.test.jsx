import { render } from "@testing-library/react"
import { AdminToggle } from "../AdminToggle"

jest.mock("../../contexts/AdminContext", () => ({
    useAdmin: jest.fn(),
}))

describe("AdminToggle", () => {
    it("renders nothing (hidden component)", () => {
        const { container } = render(<AdminToggle />)
        expect(container.innerHTML).toBe("")
    })
})
