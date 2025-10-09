# Raven Service Guide

## Project Layout
- This module is a standalone Spring Boot service built with Gradle (`build.gradle`, `settings.gradle`, wrapper scripts).
- Java sources live under `src/main/java/com/paxkun/raven`:
  - `RavenApplication.java` bootstraps the service.
  - Controllers reside in `src/main/java/com/paxkun/raven/controller` (e.g., `DownloadController`, `LibraryController`).
  - Business logic is split across `src/main/java/com/paxkun/raven/service` and its `download` / `library` subpackages (e.g., `DownloadService`, `TitleScraper`).
- Shared configuration files (application properties, etc.) live in `src/main/resources`.
- Tests belong in `src/test/java/com/paxkun/raven` alongside the corresponding package structure.

## Workflow Overview (Search → Select → Download)
1. **Search**
   - `DownloadController` exposes `/v1/download/search/{titleName}`.
   - `DownloadService` orchestrates a Selenium headless Chrome session (bootstrapped with WebDriverManager) to navigate WeebCentral search results.
   - Jsoup parses the returned HTML to build `SearchTitle` options.
2. **Select**
   - Clients choose a result via `/v1/download/select/{searchId}/{optionIndex}`.
   - The service retrieves the stored URL for the selection, identifies available chapters, and queues downloads via `TitleScraper` and `SourceFinder` helpers.
3. **Download**
   - For each chapter, Selenium fetches page content while Jsoup extracts image links.
   - `DownloadChapter` assembles the assets, packages them into `.cbz` archives, and updates library metadata (`LibraryService`, `NewTitle`, `NewChapter`).
   - Progress is exposed through `/v1/download/status`; library queries use `/v1/library/*` endpoints.

## Build & Test Commands
### Gradle
- `./gradlew clean build` — Compile, run tests, and create the executable Spring Boot jar.
- `./gradlew test` — Execute the JUnit test suite only.

### Docker
_Run from the repository root unless noted otherwise._
- `docker build --no-cache -f deployment/raven.Dockerfile -t captainpax/noona-raven .` — Build the service image.
- `docker run -p 8080:8080 -v <downloads_dir>:/app/downloads captainpax/noona-raven` — Launch the container and expose the downloads volume.

## Prerequisites & Contributor Notes
- Use Java 21 (configured via the Gradle toolchain). Install a matching JDK locally if you intend to run Gradle tasks outside Docker.
- Selenium requires a Chrome/Chromium binary compatible with the bundled WebDriver. On CI the Docker image supplies this; local development may need Google Chrome or Chromium installed plus the necessary system libraries for headless mode.
- When adjusting scraper logic:
  - Confirm DOM selectors against the current WeebCentral markup; update Jsoup parsing helpers accordingly.
  - Respect throttling/timeout behavior defined in the services to avoid anti-bot detection.
  - Run targeted downloads in a disposable workspace—downloads land under `/app/downloads` (or the mounted volume).
  - Update or add tests that cover search and download parsing logic where feasible.
- Logs rotate under `/downloads/logs`; inspect them when troubleshooting Selenium failures.
