# ─────────────────────────────────────────────────────────────
# 🌕 Noona Moon - Full Dockerfile for Vue + Vuetify SPA (Vite)
# ─────────────────────────────────────────────────────────────

### Stage 1: Build the frontend with Vite
FROM node:24-slim AS builder

# Set working directory
WORKDIR /app

# Copy only required files for Moon
COPY services/moon ./services/moon

# Go into the Moon service
WORKDIR /app/services/moon

# Clean up any stale modules
RUN rm -rf node_modules package-lock.json

# Install fresh dependencies
RUN npm install

# Build the site with Vite
RUN npx vite build

# ─────────────────────────────────────────────────────────────

### Stage 2: Serve the built site using Nginx
FROM nginx:alpine

# Copy the custom nginx config that enables SPA routing
COPY services/moon/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the production-ready frontend files from the builder
COPY --from=builder /app/services/moon/dist /usr/share/nginx/html

# Expose internal container port (Warden maps to 3000 externally)
EXPOSE 80

# Run nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
