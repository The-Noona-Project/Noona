FROM node:slim

LABEL org.opencontainers.image.source="https://github.com/the-noona-project/noona-vault"
LABEL authors="the-noona-project"

# Set working directory
WORKDIR /noona

# Copy package files and install dependencies
# Copy only package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy entire project
COPY . .

# Default command
CMD ["node", "initmain.mjs"]
