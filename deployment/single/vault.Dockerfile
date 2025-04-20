# 🧠 Noona-Vault Dockerfile
# Location: deployment/single/vault.Dockerfile

FROM node:23-slim AS noona-builder

WORKDIR /noona

# Shared user, deps, and utilities
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona
COPY package*.json ./
RUN npm install
COPY utilities ./utilities
USER noona


FROM noona-builder AS noona-vault
WORKDIR /noona/services/vault
USER root
COPY services/vault ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]
