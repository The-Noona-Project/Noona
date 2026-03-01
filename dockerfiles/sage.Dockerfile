# Noona Sage Dockerfile

FROM node:24-slim

WORKDIR /app/Noona

COPY services/sage ./services/sage
COPY utilities ./utilities

WORKDIR /app/Noona/utilities
RUN npm install --production

WORKDIR /app/Noona/services/sage
RUN npm install --production

EXPOSE 3004

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3004/health', res => res.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "initSage.mjs"]

