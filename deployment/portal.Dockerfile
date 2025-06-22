# 📦 Noona-Portal Dockerfile
# Location: deployment/single/portal.Dockerfile

FROM node:23-slim AS noona-builder

WORKDIR /noona

# Setup user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Shared root deps
COPY package*.json ./
RUN npm install

COPY utilities ./utilities
USER noona


FROM noona-builder AS noona-portal
WORKDIR /noona/services/portal
USER root
COPY services/portal ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]
