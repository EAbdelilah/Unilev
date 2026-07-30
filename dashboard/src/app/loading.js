export default function Loading() {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            gap: "1rem",
        }}>
            <div style={{
                width: 40,
                height: 40,
                border: "3px solid #eee",
                borderTopColor: "#0070f3",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
            }} />
            <p style={{ color: "#666" }}>Loading...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
