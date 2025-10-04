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
EXPOSE 3003
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/', res => res.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"
USER noona
CMD ["node", "initPortal.mjs"]
