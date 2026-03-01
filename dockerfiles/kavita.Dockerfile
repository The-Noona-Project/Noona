# Noona Kavita Dockerfile

FROM node:24-bookworm-slim AS ui-builder

WORKDIR /workspace/services/kavita/UI/Web

COPY services/kavita/UI/Web/package.json services/kavita/UI/Web/package-lock.json ./
RUN npm install --legacy-peer-deps

COPY services/kavita/UI/Web/ ./
RUN npm run prod


FROM mcr.microsoft.com/dotnet/sdk:10.0 AS publisher

ARG TARGETPLATFORM

WORKDIR /workspace/services/kavita

COPY services/kavita/global.json ./
COPY services/kavita/Kavita.sln ./
COPY services/kavita/API/API.csproj ./API/API.csproj
COPY services/kavita/Kavita.Common/Kavita.Common.csproj ./Kavita.Common/Kavita.Common.csproj

RUN case "${TARGETPLATFORM}" in \
        "linux/amd64") export RID="linux-x64" ;; \
        "linux/arm/v7") export RID="linux-arm" ;; \
        "linux/arm64") export RID="linux-arm64" ;; \
        *) echo "Unsupported TARGETPLATFORM: ${TARGETPLATFORM}" >&2; exit 1 ;; \
    esac \
    && dotnet restore ./API/API.csproj -r "${RID}"

COPY services/kavita/ ./
COPY --from=ui-builder /workspace/services/kavita/UI/Web/dist/browser ./API/wwwroot

RUN case "${TARGETPLATFORM}" in \
        "linux/amd64") export RID="linux-x64" ;; \
        "linux/arm/v7") export RID="linux-arm" ;; \
        "linux/arm64") export RID="linux-arm64" ;; \
        *) echo "Unsupported TARGETPLATFORM: ${TARGETPLATFORM}" >&2; exit 1 ;; \
    esac \
    && dotnet publish ./API/API.csproj -c Release --no-restore --self-contained true -r "${RID}" -o /out \
    && mkdir -p /out/wwwroot /out/config \
    && cp -R ./API/wwwroot/. /out/wwwroot/ \
    && rm -rf /out/BuildHost-net472 /out/BuildHost-netcore /out/config/cache-long \
    && cp ./INSTALL.txt /out/README.txt \
    && cp ./LICENSE /out/LICENSE.txt \
    && rm -f /out/config/appsettings.Development.json /out/config/appsettings.json \
    && if [ -f /out/API ]; then mv /out/API /out/Kavita; fi \
    && if [ -f /out/API.exe ]; then mv /out/API.exe /out/Kavita.exe; fi


FROM ubuntu:noble

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y libicu-dev libgdiplus curl tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY --from=publisher /out /kavita
COPY services/kavita/API/config/appsettings.json /tmp/config/appsettings.json
COPY services/kavita/entrypoint.sh /entrypoint.sh
COPY services/kavita/noona-bootstrap-admin.sh /noona-bootstrap-admin.sh

RUN chmod +x /entrypoint.sh /noona-bootstrap-admin.sh

EXPOSE 5000

WORKDIR /kavita

HEALTHCHECK --interval=30s --timeout=15s --start-period=30s --retries=3 CMD curl -fsS http://localhost:5000/api/health || exit 1

ENV DOTNET_RUNNING_IN_CONTAINER=true
ENV TZ=UTC

ENTRYPOINT ["/bin/bash"]
CMD ["/entrypoint.sh"]
