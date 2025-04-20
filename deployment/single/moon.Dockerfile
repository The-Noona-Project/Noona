# ─────────────────────────────────────────────────────────────
# 🛰️ Noona-Moon Dockerfile (Frontend + Backend with shared builder)
# Location: deployment/single/moon.Dockerfile
# ─────────────────────────────────────────────────────────────

# ───── Stage 1: Build React frontend ─────
FROM node:20-slim AS noona-moon-frontend

WORKDIR /app

COPY services/moon/frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY services/moon/frontend ./frontend
RUN cd frontend && npm run build


# ───── Stage 2: Shared builder (utilities layer) ─────
FROM node:23-slim AS noona-builder

WORKDIR /noona

# Create noona user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Install root-level shared dependencies
COPY package*.json ./
RUN npm install

# Copy shared utilities
COPY utilities ./utilities

USER noona


# ───── Stage 3: Build backend w/ shared deps ─────
FROM node:23-slim AS noona-moon-backend

WORKDIR /noona/moon

# Copy backend package and install
COPY services/moon/backend/package*.json ./backend/
RUN cd backend && npm install

# Copy backend source
COPY services/moon/backend ./backend

# Copy shared utilities from noona-builder
COPY --from=noona-builder /noona/utilities ./backend/utilities


# ───── Stage 4: Final runtime layer ─────
FROM node:23-slim

WORKDIR /noona/moon

# Create app user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Copy backend app + utilities
COPY --from=noona-moon-backend /noona/moon/backend ./backend

# Copy built frontend
COPY --from=noona-moon-frontend /app/frontend/dist ./backend/public

# Move into backend dir for launch
WORKDIR /noona/moon/backend

USER noona
EXPOSE 3030
CMD ["node", "initmain.mjs"]
