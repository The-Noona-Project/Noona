# Noona Raven Dockerfile

FROM eclipse-temurin:21-jdk AS builder

WORKDIR /noona/services/raven

# Copy Gradle wrapper + metadata first for better layer caching.
COPY services/raven/gradle ./gradle
COPY services/raven/gradlew ./gradlew
COPY services/raven/build.gradle ./build.gradle
COPY services/raven/settings.gradle ./settings.gradle

RUN sed -i 's/\r$//' ./gradlew
RUN chmod +x ./gradlew

# Prime dependency cache.
RUN ./gradlew --no-daemon --stacktrace dependencies > /dev/null

# Copy sources last (these change most frequently).
COPY services/raven/src ./src

RUN ./gradlew --no-daemon --stacktrace bootJar


FROM eclipse-temurin:21-jre

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl openvpn iproute2 \
  && rm -rf /var/lib/apt/lists/*

ENV SERVER_PORT=8080
ENV APPDATA=/app/downloads

COPY --from=builder /noona/services/raven/build/libs/raven-*.jar /app/app.jar

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:8080/v1/library/health > /dev/null || exit 1

CMD ["java", "-jar", "/app/app.jar"]
