# ────────────────────────────────────────────────
# 🦅 Noona Raven - Build Stage (Boot Jar)
# ────────────────────────────────────────────────
FROM gradle:8-jdk21 AS builder

WORKDIR /app

# Copy your Raven service source code into the build context
COPY services/raven /app

# Ensure gradlew is executable for local development consistency
RUN chmod +x ./gradlew

# Build the Spring Boot executable jar using the Gradle distribution provided by the image.
# Using the wrapper keeps the build aligned with the project's Gradle configuration.
RUN ./gradlew --no-daemon bootJar

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

# Configure application data directory for downloads and ensure it exists
ENV APPDATA=/app/downloads
RUN mkdir -p "$APPDATA"
VOLUME ["${APPDATA}"]

# Copy built jars from the builder stage, promote the Boot jar to app.jar, and discard the plain jar.
COPY --from=builder /app/build/libs/*.jar ./
RUN set -eux; \
    BOOT_JAR=$(find . -maxdepth 1 -name '*.jar' ! -name '*-plain.jar' -print -quit); \
    mv "${BOOT_JAR}" app.jar; \
    rm -f ./*-plain.jar

# Expose Raven API port
EXPOSE 8080

# Healthcheck to confirm readiness (optional, if you have a health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/v1/library/health || exit 1

# Entry point to run your Raven Spring Boot API
ENTRYPOINT ["java", "-jar", "app.jar"]
