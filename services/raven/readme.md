# Raven (Noona Stack 2.2)

Raven is Noona's downloader and library worker service. It searches supported sources, queues chapter jobs, builds
`.cbz` files, and reports live/ historical download status.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Spring entrypoint](src/main/java/com/paxkun/raven/RavenApplication.java)
- [Controllers](src/main/java/com/paxkun/raven/controller/)
- [Download services](src/main/java/com/paxkun/raven/service/download/)
- [Library services](src/main/java/com/paxkun/raven/service/library/)
- [Gradle build config](build.gradle)
- [Tests](src/test/java/com/paxkun/raven/)

## Download Workflow

1. Search titles.
2. Select a source option.
3. Queue chapter downloads.
4. Track progress/status.
5. Update local library metadata.

## API Surface (Direct Raven)

- `GET /v1/download/health`
- `GET /v1/download/search/{titleName}`
- `GET /v1/download/select/{searchId}/{optionIndex}`
- `GET /v1/download/status`
- `DELETE /v1/download/status/{title}`
- `GET /v1/library/health`
- `GET /v1/library/getall`
- `GET /v1/library/get/{titleName}`

## Build & Test
```bash
cd services/raven
./gradlew clean build
./gradlew test
```

## Docker (from repository root)
```bash
docker build --no-cache -f raven.Dockerfile -t captainpax/noona-raven .
docker run -p 8080:8080 -v <host_downloads_dir>:/app/downloads captainpax/noona-raven
```

## Runtime Notes

- Java toolchain targets Java 21.
- Selenium + headless Chrome are required for scraping flows.
- Persist downloads by mounting a host directory to `/app/downloads`.

## Documentation Rule

If you change endpoint contracts, chapter naming, or scraper source behavior, update this README and the linked
controller/service files in the same PR.
