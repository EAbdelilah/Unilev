import Link from "next/link";

export default function NotFound() {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            gap: "1rem",
            padding: "2rem",
            textAlign: "center",
        }}>
            <h1 style={{ fontSize: "4rem", fontWeight: 700, margin: 0 }}>404</h1>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Page not found</h2>
            <p style={{ color: "#666", maxWidth: 400 }}>
                The page you are looking for does not exist or has been moved.
            </p>
            <Link
                href="/"
                style={{
                    padding: "0.5rem 1.5rem",
                    background: "#0070f3",
                    color: "#fff",
                    borderRadius: 6,
                    textDecoration: "none",
                }}
            >
                Go home
            </Link>
        </div>
    );
}
