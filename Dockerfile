# Multi-stage production Dockerfile for Cyberbot
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
COPY dashboard/package.json dashboard/package-lock.json* ./dashboard/
RUN npm ci --omit=dev && cd dashboard && npm ci --omit=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd dashboard && npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 cyberbot

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/messenger.js ./
COPY --from=builder /app/instagram.js ./
COPY --from=builder /app/knowledge.js ./
COPY --from=builder /app/start-all.js ./
COPY --from=builder /app/migration.sql ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/dashboard ./dashboard

USER cyberbot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/server.js"]
