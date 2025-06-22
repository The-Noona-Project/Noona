FROM node:24-slim

WORKDIR /app/Noona

# Copy relevant folders
COPY services/warden ./services/warden
COPY utilities ./utilities

# Install dependencies in utilities
WORKDIR /app/Noona/utilities
RUN npm install --production

# Install dependencies in warden
WORKDIR /app/Noona/services/warden
RUN npm install --production

# Set default command
CMD ["npm", "start"]
