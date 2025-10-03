# deployment/vault.Dockerfile

FROM node:24-slim

WORKDIR /app/Noona

# Copy relevant folders
COPY services/vault ./services/vault
COPY utilities ./utilities

# Install dependencies in utilities
WORKDIR /app/Noona/utilities
RUN npm install --production

# Install dependencies in vault
WORKDIR /app/Noona/services/vault
RUN npm install --production

# Expose Vault's port
EXPOSE 3005

# Add healthcheck for Vault
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/v1/vault/health', res => res.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

# Set default command
CMD ["node", "initVault.mjs"]
