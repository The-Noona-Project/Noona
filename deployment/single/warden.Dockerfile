# 🛡 Noona-Warden Dockerfile
# Location: deployment/single/warden.Dockerfile

FROM node:23-slim AS noona-builder

WORKDIR /noona

# Setup shared user and install
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona
COPY package*.json ./
RUN npm install
COPY utilities ./utilities
USER noona


FROM noona-builder AS noona-warden
WORKDIR /noona/services/warden
USER root
COPY services/warden ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]
