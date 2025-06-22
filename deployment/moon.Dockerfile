FROM node:24-slim

WORKDIR /app/Noona

# Only copy moon and utilities — nothing else
COPY services/moon ./services/moon
COPY utilities ./utilities

# Install utility packages
WORKDIR /app/Noona/utilities
RUN npm install --production

# Install moon packages
WORKDIR /app/Noona/services/moon
RUN npm install --production

CMD ["npm", "start"]
