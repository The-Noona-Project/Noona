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
COPY ./jsdoc.json ./jsdoc.json

USER noona



# ───────────────────────────────────────────────
# 🛡 Noona-Warden (Docker Orchestration)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-warden
WORKDIR /noona/services/warden
USER root
COPY ./services/warden ./
RUN npm i
USER noona
CMD ["node", "initmain.mjs"]



# ───────────────────────────────────────────────
# 🎮 Noona-Portal (Discord + Kavita)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-portal
WORKDIR /noona/services/portal
USER root
COPY ./services/portal ./
RUN npm i
USER noona
CMD ["node", "initmain.mjs"]



# ───────────────────────────────────────────────
# 🧠 Noona-Vault (DB Token Layer)
# ───────────────────────────────────────────────
FROM noona-builder AS noona-vault
WORKDIR /noona/services/vault
USER root
COPY ./services/vault ./
RUN npm i
USER noona
CMD ["node", "initmain.mjs"]
