"use client";

export default function Error({ error, reset }) {
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
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ color: "#666", maxWidth: 400 }}>
                {error?.message || "An unexpected error occurred. Please try again."}
            </p>
            <button
                onClick={() => reset()}
                style={{
                    padding: "0.5rem 1.5rem",
                    background: "#0070f3",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                }}
            >
                Try again
            </button>
        </div>
    );
}
