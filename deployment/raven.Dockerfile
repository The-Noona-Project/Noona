# ────────────────────────────────────────────────
# 🦅 Noona Raven - Build Stage (Shadow Jar)
# ────────────────────────────────────────────────
FROM gradle:8-jdk21 AS builder

WORKDIR /app

# Copy your Raven service source code into the build context
COPY services/raven /app

# Ensure gradlew is executable for local development consistency
RUN chmod +x ./gradlew

# Build the Shadow fat jar using the Gradle distribution provided by the image.
# On some hosts (notably Windows), the copied gradlew script may retain CRLF
# line endings and become unusable during the Docker build stage. Invoking the
# Gradle runtime directly avoids those line-ending issues while still
# respecting the project configuration.
RUN gradle --no-daemon shadowJar

# ────────────────────────────────────────────────
# 🦅 Noona Raven - Runtime Stage with Chrome installed
# ────────────────────────────────────────────────
FROM eclipse-temurin:21-jre

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
COPY --from=builder /app/build/libs/*-all.jar app.jar

# Expose Raven API port
EXPOSE 8080

# Healthcheck to confirm readiness (optional, if you have a health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/v1/library/health || exit 1

# Entry point to run your Raven Spring Boot API
ENTRYPOINT ["java", "-jar", "app.jar"]
