# Noona Warden Dockerfile

FROM node:24-slim

WORKDIR /app/Noona

COPY services/warden ./services/warden
COPY utilities ./utilities

WORKDIR /app/Noona/utilities
RUN npm install --production

WORKDIR /app/Noona/services/warden
RUN npm install --production

EXPOSE 4001

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "require('http').get('http://localhost:4001/health', res => res.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "initWarden.mjs"]

