# ─────────────────────────────────────────────────────────────
# 🌕 Noona Moon - Updated Dockerfile with Healthcheck
# ─────────────────────────────────────────────────────────────

### Stage 1: Build the frontend
FROM node:24-slim AS builder

WORKDIR /app

COPY services/moon/package*.json ./
RUN npm ci

COPY services/moon/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────

### Stage 2: Serve with nginx
FROM nginx:alpine

RUN apk add --no-cache curl

# Add healthcheck
HEALTHCHECK --interval=5s --timeout=2s --start-period=3s --retries=5 \
  CMD curl -fsS http://localhost:3000/ || exit 1

COPY services/moon/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]