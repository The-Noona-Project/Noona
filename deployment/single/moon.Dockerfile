# ─────────────────────────────────────────────────────────────
# 🌙 Noona-Moon Dockerfile (frontend + backend)
# Location: deployment/single/moon.Dockerfile
# ─────────────────────────────────────────────────────────────

# --- Frontend Build Stage ---
FROM node:20-slim AS noona-moon-frontend

WORKDIR /app

COPY services/moon/frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY services/moon/frontend ./frontend/
RUN cd frontend && npm run build


# --- Backend Build Stage ---
FROM node:23-slim AS noona-moon-backend

WORKDIR /noona/moon

COPY services/moon/backend/package*.json ./backend/
RUN cd backend && npm install

COPY services/moon/backend ./backend/


# --- Final Image Stage ---
FROM node:23-slim

RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona
WORKDIR /noona

# Copy backend files
COPY --from=noona-moon-backend /noona/moon /noona/moon

# Copy frontend build to public folder
COPY --from=noona-moon-frontend /app/frontend/dist /noona/moon/frontend-build

# Set user and start
USER noona
CMD ["node", "moon/backend/initmain.mjs"]
