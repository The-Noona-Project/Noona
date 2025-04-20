# ✅ all.Dockerfile — Build All Noona Services

# ─────────────────────────────────────────────
# 🌍 Base Builder (Node.js services)
# ─────────────────────────────────────────────
FROM node:23-slim AS noona-builder

WORKDIR /noona

# Create shared noona user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Install root deps
COPY package*.json ./
RUN npm install

# Shared utilities (logger, auth, etc.)
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
# 🌙 Noona-Moon (4 Stage React + Backend)
# ─────────────────────────────────────────────

# Stage 1: Build frontend
FROM node:20-slim AS noona-moon-frontend

WORKDIR /app
COPY services/moon/frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY services/moon/frontend ./frontend
RUN cd frontend && npm run build


# Stage 2: Prepare backend using noona-builder
FROM noona-builder AS noona-moon-backend

WORKDIR /noona/moon

USER root
COPY services/moon/backend/package*.json ./backend/
RUN cd backend && npm install

COPY services/moon/backend ./backend
USER noona


# Stage 3: Final runtime image
FROM node:23-slim AS noona-moon

WORKDIR /noona/services/moon

# Setup noona user again here
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Copy backend and shared utilities
COPY --from=noona-moon-backend /noona/moon/backend ./backend

# Copy frontend build
COPY --from=noona-moon-frontend /app/frontend/dist ./backend/public

WORKDIR /noona/services/moon/backend
USER noona
EXPOSE 3030
CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────
# 📈 Noona-Sage
# ─────────────────────────────────────────────
FROM noona-builder AS noona-sage
WORKDIR /noona/services/sage
USER root
COPY services/sage ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────
# ☕ Noona-Raven (Java + ShadowJar)
# ─────────────────────────────────────────────
FROM eclipse-temurin:24-jdk AS noona-raven
WORKDIR /noona/services/raven
COPY services/raven ./
RUN apt-get update && \
    apt-get install -y unzip curl git && \
    ./gradlew shadowJar
CMD ["java", "-jar", "./build/libs/raven-all.jar"]


# ─────────────────────────────────────────────
# 🧠 Noona-Oracle (Python AI Services)
# ─────────────────────────────────────────────
FROM python:3.12-slim AS noona-oracle
WORKDIR /noona/services/oracle
COPY services/oracle/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY services/oracle ./
CMD ["python3", "initmain.py"]


# ─────────────────────────────────────────────
# 🔚 Final Notes
# ─────────────────────────────────────────────
# Use with:
# docker build --target noona-portal -f deployment/groups/all.Dockerfile .
