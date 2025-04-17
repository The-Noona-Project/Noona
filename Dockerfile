# ─────────────────────────────────────────────────────────────────────
# 🧱 STAGE 1: Shared builder with /utilities and global deps
# ─────────────────────────────────────────────────────────────────────
FROM node:23-slim as noona-builder

# Create working base
WORKDIR /noona

# Copy shared dependencies (optional: root-level)
COPY package*.json ./
RUN npm install

# Copy utilities folder for all services
COPY utilities ./utilities

# Optional: shared config or docs
COPY jsdoc.json ./

# Create shared "noona" user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona


# ─────────────────────────────────────────────────────────────────────
# 🛡 STAGE 2: Noona-Warden
# ─────────────────────────────────────────────────────────────────────
FROM noona-builder as noona-warden

WORKDIR /noona/warden

COPY services/warden ./

RUN npm install --production
VOLUME ["/var/run/docker.sock"]

CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────────────────────────────
# 🎮 STAGE 3: Noona-Portal
# ─────────────────────────────────────────────────────────────────────
FROM noona-builder as noona-portal

WORKDIR /noona/portal

COPY services/portal ./

RUN npm install --production

CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────────────────────────────
# 🌙 STAGE 4: Noona-Moon
# ─────────────────────────────────────────────────────────────────────
FROM noona-builder as noona-moon

WORKDIR /noona/moon

COPY services/moon ./

RUN npm install --production

CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────────────────────────────
# 🐦 STAGE 6: Noona-Raven
# ─────────────────────────────────────────────────────────────────────
FROM noona-builder as noona-raven

WORKDIR /noona/raven

COPY services/raven ./

RUN npm install --production

CMD ["node", "initmain.mjs"]


# ─────────────────────────────────────────────────────────────────────
# 📈 STAGE 7: Noona-Sage
# ─────────────────────────────────────────────────────────────────────
FROM noona-builder as noona-sage

WORKDIR /noona/sage

COPY services/sage ./

RUN npm install --production

CMD ["node", "initmain.mjs"]
