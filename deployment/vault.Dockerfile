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
EXPOSE 4000

# Set default command
CMD ["node", "initVault.mjs"]
