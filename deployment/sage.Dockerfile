# Use minimal Node.js base image
FROM node:24-slim

# Create working directory
WORKDIR /app/Noona

# Copy only what Sage needs
COPY services/sage ./services/sage
COPY utilities ./utilities

# Install dependencies in utilities
WORKDIR /app/Noona/utilities
RUN npm install --production

# Install dependencies in Sage
WORKDIR /app/Noona/services/sage
RUN npm install --production

# Expose the API port
EXPOSE 3004

# Set default startup command
CMD ["npm", "start"]
