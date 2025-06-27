# ────────────────────────────────────────────────
# Build Stage: Build Raven jar with shadowJar
# ────────────────────────────────────────────────
FROM gradle:8-jdk17 AS builder

WORKDIR /app

# Copy your raven service source code into the build context
COPY services/raven /app

# Build the fat jar using shadowJar
RUN gradle shadowJar

# ────────────────────────────────────────────────
# Runtime Stage: Minimal JRE with Chrome and Chromedriver
# ────────────────────────────────────────────────
FROM eclipse-temurin:17-jre

# Install dependencies and Google Chrome
RUN apt-get update && \
    apt-get install -y wget curl gnupg unzip && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-linux-signing-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# WebDriverManager will handle Chromedriver installation dynamically in code

# Set working directory
WORKDIR /app

# Copy built jar from builder stage
COPY --from=builder /app/build/libs/raven.jar ./raven.jar

# Entry point to run your Raven scraper
ENTRYPOINT ["java", "-jar", "raven.jar"]
