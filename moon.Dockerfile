# Noona Moon Dockerfile

FROM node:24-slim AS builder

WORKDIR /workspace/services/moon
ENV NEXT_TELEMETRY_DISABLED=1

COPY utilities/ /workspace/utilities/
COPY services/moon/package.json services/moon/package-lock.json ./
RUN npm ci

COPY services/moon/ ./

RUN npm run build


FROM node:24-slim AS runner

WORKDIR /workspace/services/moon
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY utilities/ /workspace/utilities/
COPY services/moon/package.json services/moon/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /workspace/services/moon/.next ./.next
COPY --from=builder /workspace/services/moon/public ./public
COPY --from=builder /workspace/services/moon/next.config.mjs ./next.config.mjs
COPY --from=builder /workspace/services/moon/scripts ./scripts
COPY --from=builder /workspace/services/moon/src/app/blog/posts ./src/app/blog/posts
COPY --from=builder /workspace/services/moon/src/app/work/projects ./src/app/work/projects

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/', res => res.statusCode >= 200 && res.statusCode < 500 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["npm", "run", "start"]
