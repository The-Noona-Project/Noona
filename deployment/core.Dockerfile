# ✅ core.Dockerfile — Noona Core (Warden + Portal + Vault)

# ───────────────────────────────────────────────
# 🌍 BASE: noona-builder
# Node 23 + shared /utilities + noona user
# ───────────────────────────────────────────────
FROM node:23-slim AS noona-builder

WORKDIR /noona

# Create unprivileged user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Install shared deps
COPY package*.json ./
RUN npm install

# Shared utility code
COPY ./utilities ./utilities

# Share root node_modules across services
ENV NODE_PATH=/noona/node_modules
ENV PATH=$NODE_PATH/.bin:$PATH

USER noona



# ───────────────────────────────────────────────
# 🛡 Noona-Warden (Docker Orchestration)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-warden
WORKDIR /noona/services/warden
USER root
COPY ./services/warden/package*.json ./
RUN npm install
COPY ./services/warden ./
CMD ["node", "initmain.mjs"]



# ───────────────────────────────────────────────
# 🎮 Noona-Portal (Discord + Kavita)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-portal
WORKDIR /noona/services/portal
USER root
COPY ./services/portal/package*.json ./
RUN npm install
COPY ./services/portal ./
USER noona
CMD ["node", "initmain.mjs"]



# ───────────────────────────────────────────────
# 🧠 Noona-Vault (DB Token Layer)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-vault
WORKDIR /noona/services/vault
USER root
COPY ./services/vault/package*.json ./
RUN npm install
COPY ./services/vault ./
USER noona
CMD ["node", "initmain.mjs"]
