const http = require("http");

let port = parseInt(process.env.HEALTH_PORT || "9090", 10);
let server = null;

const metrics = {
    positionsTracked: 0,
    poolsTracked: 0,
    liquidationsAttempted: 0,
    liquidationsSucceeded: 0,
    liquidationsFailed: 0,
    errorsTotal: 0,
    lastCheckTime: 0,
    startTime: Date.now(),
    lastLiquidationTime: 0,
    rpcFailovers: 0,
    rpcErrors: 0,
    gasEstimationFails: 0,
    nonceConflicts: 0,
};

function resetMetrics() {
    metrics.positionsTracked = 0;
    metrics.poolsTracked = 0;
    metrics.liquidationsAttempted = 0;
    metrics.liquidationsSucceeded = 0;
    metrics.liquidationsFailed = 0;
    metrics.errorsTotal = 0;
    metrics.lastCheckTime = 0;
    metrics.startTime = Date.now();
    metrics.lastLiquidationTime = 0;
    metrics.rpcFailovers = 0;
    metrics.rpcErrors = 0;
    metrics.gasEstimationFails = 0;
    metrics.nonceConflicts = 0;
}

async function startHealthServer() {
    if (server) return;

    const host = process.env.HEALTH_HOST || "0.0.0.0";
    port = parseInt(process.env.HEALTH_PORT || "9090", 10);

    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            if (req.url === "/health") {
                const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
                const status = { status: "ok", uptime: `${uptime}s`, timestamp: new Date().toISOString() };
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(status));
            } else if (req.url === "/metrics") {
                const lines = [
                    "# HELP eswap_keeper_positions_tracked Number of active positions being monitored",
                    "# TYPE eswap_keeper_positions_tracked gauge",
                    `eswap_keeper_positions_tracked ${metrics.positionsTracked}`,
                    "# HELP eswap_keeper_pools_tracked Number of pools being monitored",
                    "# TYPE eswap_keeper_pools_tracked gauge",
                    `eswap_keeper_pools_tracked ${metrics.poolsTracked}`,
                    "# HELP eswap_keeper_liquidations_total Total liquidation attempts",
                    "# TYPE eswap_keeper_liquidations_total counter",
                    `eswap_keeper_liquidations_total ${metrics.liquidationsAttempted}`,
                    "# HELP eswap_keeper_liquidations_succeeded Successful liquidations",
                    "# TYPE eswap_keeper_liquidations_succeeded counter",
                    `eswap_keeper_liquidations_succeeded ${metrics.liquidationsSucceeded}`,
                    "# HELP eswap_keeper_liquidations_failed Failed liquidations",
                    "# TYPE eswap_keeper_liquidations_failed counter",
                    `eswap_keeper_liquidations_failed ${metrics.liquidationsFailed}`,
                    "# HELP eswap_keeper_errors_total Internal errors",
                    "# TYPE eswap_keeper_errors_total counter",
                    `eswap_keeper_errors_total ${metrics.errorsTotal}`,
                    "# HELP eswap_keeper_rpc_failovers RPC endpoint failover count",
                    "# TYPE eswap_keeper_rpc_failovers counter",
                    `eswap_keeper_rpc_failovers ${metrics.rpcFailovers}`,
                    "# HELP eswap_keeper_rpc_errors RPC call errors",
                    "# TYPE eswap_keeper_rpc_errors counter",
                    `eswap_keeper_rpc_errors ${metrics.rpcErrors}`,
                    "# HELP eswap_keeper_gas_estimation_fails Gas estimation failures",
                    "# TYPE eswap_keeper_gas_estimation_fails counter",
                    `eswap_keeper_gas_estimation_fails ${metrics.gasEstimationFails}`,
                    "# HELP eswap_keeper_nonce_conflicts Nonce conflicts",
                    "# TYPE eswap_keeper_nonce_conflicts counter",
                    `eswap_keeper_nonce_conflicts ${metrics.nonceConflicts}`,
                    "# HELP eswap_keeper_last_check_timestamp Unix timestamp of last health check",
                    "# TYPE eswap_keeper_last_check_timestamp gauge",
                    `eswap_keeper_last_check_timestamp ${metrics.lastCheckTime}`,
                    "# HELP eswap_keeper_last_liquidation_timestamp Unix timestamp of last liquidation",
                    "# TYPE eswap_keeper_last_liquidation_timestamp gauge",
                    `eswap_keeper_last_liquidation_timestamp ${metrics.lastLiquidationTime}`,
                    "# HELP eswap_keeper_uptime_seconds Uptime in seconds",
                    "# TYPE eswap_keeper_uptime_seconds gauge",
                    `eswap_keeper_uptime_seconds ${Math.floor((Date.now() - metrics.startTime) / 1000)}`,
                ];
                res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
                res.end(lines.join("\n") + "\n");
            } else {
                res.writeHead(404);
                res.end("Not Found\n");
            }
        });

        server.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                port++;
                server.listen(port, host);
            } else {
                reject(err);
            }
        });

        server.listen(port, host, () => {
            resolve();
        });
    });
}

async function stopHealthServer() {
    if (server) {
        return new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { startHealthServer, stopHealthServer, metrics, resetMetrics };
