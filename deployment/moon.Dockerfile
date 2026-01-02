# ─────────────────────────────────────────────────────────────
# 🌕 Noona Moon - Updated Dockerfile with Healthcheck
# ─────────────────────────────────────────────────────────────

### Stage 1: Build the frontend
FROM node:24-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY services/moon/package*.json ./
RUN npm ci

COPY services/moon/ ./

# Next.js static export (Next.js 16): build and export to out/ for nginx.
RUN npm run build && npm run export
RUN test -d /app/out

# ─────────────────────────────────────────────────────────────

### Stage 2: Serve with nginx
FROM nginx:alpine

RUN apk add --no-cache curl

# Add healthcheck
HEALTHCHECK --interval=5s --timeout=2s --start-period=3s --retries=5 \
  CMD curl -fsS http://localhost:3000/ || exit 1

COPY services/moon/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
