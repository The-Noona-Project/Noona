# ✅ core.Dockerfile — Build Warden, Portal, Vault, Moon
# Location: deployment/group/core.Dockerfile

# ─────────────────────────────────────────────
# 🌍 Shared Builder Base
# ─────────────────────────────────────────────
FROM node:23-slim AS noona-builder

WORKDIR /noona

RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

COPY package*.json ./
RUN npm install

COPY utilities ./utilities
USER noona

# ─────────────────────────────────────────────
# 🛡 Noona-Warden
# ─────────────────────────────────────────────
FROM noona-builder AS noona-warden
WORKDIR /noona/services/warden
USER root
COPY services/warden ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]

# ─────────────────────────────────────────────
# 🎮 Noona-Portal
# ─────────────────────────────────────────────
FROM noona-builder AS noona-portal
WORKDIR /noona/services/portal
USER root
COPY services/portal ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]

# ─────────────────────────────────────────────
# 🧠 Noona-Vault
# ─────────────────────────────────────────────
FROM noona-builder AS noona-vault
WORKDIR /noona/services/vault
USER root
COPY services/vault ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]

# ─────────────────────────────────────────────
# 🌙 Noona-Moon (Frontend + Backend)
# ─────────────────────────────────────────────

# Stage 1: Build frontend (React)
FROM node:20-slim AS noona-moon-frontend

WORKDIR /app
COPY services/moon/frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY services/moon/frontend ./frontend/
RUN cd frontend && npm run build

# Stage 2: Backend build using builder base
FROM noona-builder AS noona-moon-backend

WORKDIR /noona/moon
USER root
COPY services/moon/backend/package*.json ./backend/
RUN cd backend && npm install
COPY services/moon/backend ./backend/
USER noona

# Stage 3: Final combined image
FROM node:23-slim AS noona-moon

WORKDIR /noona/services/moon
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Copy backend and compiled frontend
COPY --from=noona-moon-backend /noona/moon/backend ./backend
COPY --from=noona-moon-frontend /app/frontend/dist ./backend/public

WORKDIR /noona/services/moon/backend
USER noona
EXPOSE 3030
CMD ["node", "initmain.mjs"]

# ─────────────────────────────────────────────
# 📦 To build:
# docker build --target noona-portal -f deployment/group/core.Dockerfile .
# ─────────────────────────────────────────────
