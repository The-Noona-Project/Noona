# ✅ all.Dockerfile — Build ALL Noona services
# Location: deployment/group/all.Dockerfile

# ─────────────────────────────────────────────
# 📦 Core services (re-use core.Dockerfile stages)
# ─────────────────────────────────────────────
FROM captainpax/noona-core:latest AS noona-core

# ─────────────────────────────────────────────
# 🔮 Noona-Oracle (Python AI)
# ─────────────────────────────────────────────
FROM python:3.11-slim AS noona-oracle

WORKDIR /noona/services/oracle
COPY services/oracle/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/oracle ./
CMD ["python", "initmain.py"]

# ─────────────────────────────────────────────
# 🕊 Noona-Raven (Java Web Scraper)
# ─────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-slim AS noona-raven

WORKDIR /noona/services/raven
COPY services/raven ./

# Optional: Build with Maven or Gradle if needed
# RUN ./gradlew build

CMD ["java", "-jar", "raven.jar"] # Replace with actual entry

# ─────────────────────────────────────────────
# 📊 Noona-Sage (Prometheus config / metrics)
# ─────────────────────────────────────────────
FROM node:23-slim AS noona-sage

WORKDIR /noona/services/sage
COPY services/sage/package*.json ./
RUN npm install

COPY services/sage ./
CMD ["node", "initmain.mjs"]

