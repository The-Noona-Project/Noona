# Use official Node base image
FROM node:24-slim

# Set working directory
WORKDIR /app/Noona

# Copy only Moon and Utilities
COPY services/moon ./services/moon
COPY utilities ./utilities

# Ensure fresh install (important for native deps)
WORKDIR /app/Noona/services/moon
RUN rm -rf node_modules package-lock.json

# Install Moon dependencies (including dev for build)
RUN npm install

# Build the production-ready frontend using Vite
RUN npm run build

# Install a simple static file server
RUN npm install -g serve

# Final working dir for serving
WORKDIR /app/Noona/services/moon/dist

# Expose Moon UI port
EXPOSE 3000

# Serve built static site
CMD ["serve", "-s", ".", "-l", "3000"]
