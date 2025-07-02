# ─────────────────────────────────────────────────────────────
# 🌕 Noona Moon - Updated Dockerfile with Healthcheck
# ─────────────────────────────────────────────────────────────

### Stage 1: Build the frontend
FROM node:24-slim AS builder

WORKDIR /app
COPY services/moon ./services/moon
WORKDIR /app/services/moon

RUN rm -rf node_modules package-lock.json
RUN npm install
RUN npx vite build

# ─────────────────────────────────────────────────────────────

### Stage 2: Serve with nginx
FROM nginx:alpine

# Add healthcheck
HEALTHCHECK --interval=5s --timeout=2s --start-period=3s --retries=5 \
  CMD wget --spider -q http://localhost:3000 || exit 1

COPY services/moon/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/services/moon/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]