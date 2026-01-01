# OnceUI Deployment Wizard

The Moon UI has been retired. All install/start/stop flows now run through the OnceUI deployment wizard served by `deployment/webServer.mjs`, which proxies container actions to Warden and streams NDJSON logs back to the browser. Use this guide to understand the wizard layout, prerequisites, and the API endpoints behind each control.

## Prerequisites

- **Warden online at http://localhost:4001.** Start it via `node initWarden.mjs` (minimal or `DEBUG=super`) or with the helper scripts (`./scripts/run-warden.sh`, `pwsh ./scripts/run-warden.ps1`). The deployment server relays every request to Warden, so the wizard surfaces errors if the API is unreachable.
- **Docker available to the deployment server.** Ensure the Docker socket is reachable from the host running `npm run deploy:server`; the start workflow binds the socket by default unless you disable it via the UI or `hostDockerSocketOverride` settings.
- **Panel bundle present.** Build the OnceUI dashboard if you have edited `deployment/panel/` by running `npm run deploy:panel:build` (or `npm run deploy:panel:dev` for live reload) before launching the server.
- **Port access.** The server listens on `4300` by default, but you can override it with `DEPLOY_SERVER_PORT`/`PORT`.

## Layout and navigation

The wizard is organized into stacked OnceUI cards with a persistent navigation rail and terminal-style stream at the bottom of the page.

- **Status & settings cards.** The top-left column exposes **Refresh status** and **Load settings** actions to hydrate service inventory and defaults. NDJSON responses render inline tables and log badges.
- **Build card.** Supply comma-separated services (or leave blank for the full stack), toggle **Use --no-cache**, and pass JSON concurrency hints. Progress updates appear as structured log events instead of the legacy Moon modal.
- **Registry & lifecycle cards.** Push/pull, start/stop, clean, and delete controls occupy their own cards with confirmation toggles. Each button streams container logs, lifecycle history, and reporter messages to the shared log area.
- **Settings editor.** A JSON editor patches deployment defaults in place. Changes persist across sessions and feed subsequent start/build requests.
- **Streaming log.** The bottom pane renders the NDJSON stream with auto-scroll and retains the last 500 events. Errors, tables, and container-log tails are color-coded and labeled with their originating action.

## Endpoints used by the wizard

The wizard buttons call the deployment server endpoints, which wrap the Docker helpers in `deployment/dockerManager.mjs` and emit NDJSON:

- `GET /api/services` – Returns service inventory, container status, and lifecycle history.
- `GET /api/settings` / `PATCH /api/settings` – Load or update deployment defaults before running other actions.
- `POST /api/build` – Build one or more images (`useNoCache`, `concurrency` supported).
- `POST /api/push` / `POST /api/pull` – Push or pull images for the selected services.
- `POST /api/start` – Start services with optional `debugLevel`, `bootMode`, and host Docker socket binding overrides.
- `POST /api/stop` – Stop all managed containers.
- `POST /api/clean` – Remove artifacts for specific services.
- `POST /api/delete` – Delete all Noona Docker resources (requires explicit confirmation in the UI).

## Typical flow

1. **Launch prerequisites.** Start Warden and ensure Docker is reachable.
2. **Start the server.** Run `npm run deploy:server` (build the panel first if you changed UI files) and open [http://localhost:4300](http://localhost:4300).
3. **Load state.** Click **Refresh status** to populate service inventory and **Load settings** to prefill the JSON editor.
4. **Configure settings.** Patch defaults (e.g., host Docker socket path, service selection) with **Update settings**.
5. **Build or pull images.** Use the Build or Registry cards; watch the NDJSON log for table summaries and container tails.
6. **Start services.** Choose debug level/boot mode and start the stack. The stream surfaces progress, errors, and live container logs.
7. **Stop or clean up.** Use **Stop all**, **Remove selected resources**, or **Delete all** as needed. Confirm destructive actions when prompted.

## Legacy Moon references

If you encounter older docs or screenshots mentioning Moon, treat them as legacy. The OnceUI wizard supersedes Moon and preserves all lifecycle functionality in a single browser-based surface. See [docs/moon-env-config.md](./moon-env-config.md) for the archived setup notes.
