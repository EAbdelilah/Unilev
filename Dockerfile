FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --omit=dev

COPY javascript/ ./javascript/
COPY out/ ./out/
COPY dashboard/src/config/supported_tokens.json ./dashboard/src/config/supported_tokens.json

RUN addgroup -S eswap && adduser -S eswap -G eswap
USER eswap

ENV NODE_ENV=production
ENV CHECK_INTERVAL=15000
ENV HEALTH_PORT=9090

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:$HEALTH_PORT/health || exit 1

EXPOSE 9090

CMD ["node", "javascript/liquidate.js"]
