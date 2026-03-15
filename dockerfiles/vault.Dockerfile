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
  CMD node -e "const fs=require('fs'); const http=require('http'); const https=require('https'); const tlsEnabled=/^(1|true|yes|on)$/i.test(String(process.env.VAULT_TLS_ENABLED||'')); const client=tlsEnabled?https:http; const url=(tlsEnabled?'https':'http')+'://localhost:3005/v1/vault/health'; const options=tlsEnabled&&process.env.VAULT_CA_CERT_PATH?{ca:fs.readFileSync(process.env.VAULT_CA_CERT_PATH,'utf8')}:{ }; client.get(url, options, res => res.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

# Set default command
CMD ["node", "initVault.mjs"]
