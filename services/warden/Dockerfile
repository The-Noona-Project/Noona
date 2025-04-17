# Dockerfile
FROM node:23-slim

# Create working directory
WORKDIR /noona

# Copy package definition files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the project
COPY . .

# Set environment variables for JWT key paths
ENV JWT_PRIVATE_KEY_PATH=/noona/family/noona-warden/files/keys/private.pem
ENV JWT_PUBLIC_KEY_PATH=/noona/family/noona-warden/files/keys/public.pem

# Use root, no user permissions needed
# Mount Docker socket from host
VOLUME ["/var/run/docker.sock"]

# Boot the application
CMD ["node", "initmain.mjs"]
