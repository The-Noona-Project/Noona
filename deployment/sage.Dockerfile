# 📈 Noona-Sage Dockerfile
# Location: deployment/single/sage.Dockerfile

FROM node:23-slim AS noona-builder

WORKDIR /noona

# Base shared setup
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona
COPY package*.json ./
RUN npm install
COPY utilities ./utilities
USER noona


FROM noona-builder AS noona-sage
WORKDIR /noona/services/sage
USER root
COPY services/sage ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]
