# ✅ all.Dockerfile — Build All Noona Services

# ─────────────────────────────────────────────
# 🌍 Base Builder (Node.js services)
# ─────────────────────────────────────────────
FROM node:23-slim AS noona-builder

WORKDIR /noona

# Create shared noona user
RUN groupadd -r noona && useradd -r -g noona -m -d /home/noona -s /bin/bash noona

# Install shared deps
COPY package*.json ./
RUN npm install

# Shared code/utilities
COPY utilities ./utilities
COPY ../docs/jsdoc.json ./

USER noona



# ─────────────────────────────────────────────
# 🛡 Noona-Warden
# ─────────────────────────────────────────────
FROM noona-builder AS noona-warden
WORKDIR /noona/services/warden
USER root
COPY services/warden ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]



# ─────────────────────────────────────────────
# 🎮 Noona-Portal
# ─────────────────────────────────────────────
FROM noona-builder AS noona-portal
WORKDIR /noona/services/portal
USER root
COPY services/portal ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]



# ─────────────────────────────────────────────
# 🧠 Noona-Vault
# ─────────────────────────────────────────────
FROM noona-builder AS noona-vault
WORKDIR /noona/services/vault
USER root
COPY services/vault ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]



# ─────────────────────────────────────────────
# 🌙 Noona-Moon
# ─────────────────────────────────────────────
FROM noona-builder AS noona-moon
WORKDIR /noona/services/moon
USER root
COPY services/moon ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]



# ─────────────────────────────────────────────
# 📈 Noona-Sage
# ─────────────────────────────────────────────
FROM noona-builder AS noona-sage
WORKDIR /noona/services/sage
USER root
COPY services/sage ./
RUN npm install
USER noona
CMD ["node", "initmain.mjs"]



# ─────────────────────────────────────────────
# ☕ Noona-Raven (Java + ShadowJar)
# ─────────────────────────────────────────────
FROM eclipse-temurin:24-jdk AS noona-raven
WORKDIR /noona/services/raven
COPY services/raven ./
RUN apt-get update && \
    apt-get install -y unzip curl git && \
    ./gradlew shadowJar
CMD ["java", "-jar", "./build/libs/raven-all.jar"]



# ─────────────────────────────────────────────
# 🧠 Noona-Oracle (Python AI Services)
# ─────────────────────────────────────────────
FROM python:3.12-slim AS noona-oracle
WORKDIR /noona/services/oracle
COPY services/oracle/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY services/oracle ./
CMD ["python3", "initmain.py"]



# ─────────────────────────────────────────────
# 🔚 Final Notes
# ─────────────────────────────────────────────
# All working dirs now match: /noona/services/<name>
# Use --target to build a specific service like:
# docker build --target noona-portal -f build/all.Dockerfile .
