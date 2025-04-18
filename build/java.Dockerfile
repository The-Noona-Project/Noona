# ───────────────────────────────────────────────
# 🦅 Noona-Raven (Java 24 + ShadowJar)
# ───────────────────────────────────────────────
FROM eclipse-temurin:24-jdk AS noona-raven

WORKDIR /noona/raven

# System tools for building Java projects
RUN apt-get update && \
    apt-get install -y unzip curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy Gradle wrapper
COPY ../services/raven/gradlew ./gradlew
COPY ../services/raven/gradle ./gradle
RUN chmod +x ./gradlew

# Copy Java source and resources
COPY ../services/raven/java ./java
COPY ../services/raven/resources ./resources

# Build the jar (optional if later used in CMD)
# RUN ./gradlew shadowJar

# Adjust entrypoint later if you're running it differently
CMD ["java", "-cp", "./java", "com.paxkun.Main"]
