# Noona Komf Dockerfile

FROM eclipse-temurin:17-jdk AS builder

WORKDIR /workspace/services/komf

COPY services/komf/ ./

RUN chmod +x ./gradlew \
    && ./gradlew --no-daemon :komf-app:shadowJar \
    && mkdir -p /out \
    && cp ./komf-app/build/libs/*-all.jar /out/komf-app-all.jar


FROM eclipse-temurin:17-jre

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --no-cache-dir apprise \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/komf-app-all.jar ./komf-app-all.jar

ENV LC_ALL=en_US.UTF-8
ENV KOMF_CONFIG_DIR=/config

EXPOSE 8085

ENTRYPOINT ["java", "-jar", "komf-app-all.jar"]

LABEL org.opencontainers.image.url=https://github.com/Snd-R/komf \
      org.opencontainers.image.source=https://github.com/Snd-R/komf
