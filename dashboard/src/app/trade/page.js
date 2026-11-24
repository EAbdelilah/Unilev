import Home from "../page";

// Keep the historical /trade URL working: the current V4 margin trading UI is
// the home page, but existing bookmarks and the production domain use /trade.
export default function TradePage() {
    return <Home />;
}
