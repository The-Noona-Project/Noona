# ─────────────────────────────────────────────────────────────
# 🌕 Noona Moon - Multi-stage Dockerfile (Build + Serve)
# ─────────────────────────────────────────────────────────────

# Stage 1: Build the frontend with Vite
FROM node:24-slim AS builder

WORKDIR /app

# Copy only what we need
COPY services/moon ./services/moon
COPY utilities ./utilities

# Move into the Moon service directory
WORKDIR /app/services/moon

# Clean stale deps
RUN rm -rf node_modules package-lock.json

# Install dependencies
RUN npm install

# Build using local Vite (no global required)
RUN npx vite build

# ─────────────────────────────────────────────────────────────

# Stage 2: Serve the built site with nginx
FROM nginx:alpine

# Use the default nginx.conf (listens on port 80)
# Remove the custom nginx.conf step entirely

# Copy the production build into nginx's html directory
COPY --from=builder /app/services/moon/dist /usr/share/nginx/html

# Expose port 80 (internally) — Warden will map to 3000 externally
EXPOSE 80

# Start nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
