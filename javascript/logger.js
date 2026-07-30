const pino = require("pino");

let logger = null;

function getLogger() {
    if (logger) return logger;
    logger = pino({
        level: process.env.LOG_LEVEL || "info",
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
                ignore: "pid,hostname",
            },
        },
        serializers: {
            err: pino.stdSerializers.err,
        },
    });
    return logger;
}

module.exports = { getLogger };
