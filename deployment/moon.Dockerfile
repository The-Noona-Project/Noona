FROM node:24-slim

WORKDIR /app/Noona

# Correct: relative to build context root
COPY ./services/moon ./services/moon
COPY ./utilities ./utilities

WORKDIR /app/Noona/services/moon

RUN npm install --production

EXPOSE 3000

CMD ["npm", "start"]
