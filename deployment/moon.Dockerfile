# Noona Moon - Next.js (OnceUI) Dockerfile
#
# Next 16 removed `next export`; run the production server instead.

FROM node:24-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY services/moon/package*.json ./
RUN npm ci

COPY services/moon/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/', res => res.statusCode < 500 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
