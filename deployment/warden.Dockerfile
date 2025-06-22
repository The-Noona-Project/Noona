FROM node:24-slim

WORKDIR /app/Noona

COPY services/warden ./services/warden
COPY utilities ./utilities

WORKDIR /app/Noona/services/warden
RUN npm install --production

CMD ["npm", "start"]