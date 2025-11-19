# Deployment Control Panel

The deployment tooling is now driven entirely from the lightweight Express server in `deployment/webServer.mjs`. It exposes the same Docker workflows that previously powered the Ink CLI, but the interface now lives in a React + OneUI experience that is bundled with Vite from `deployment/panel/` and emitted to `deployment/dist/`.

## Getting Started

> ⚠️ **Prerequisite:** The deployment panel proxies install/start/stop commands through the Warden API. Ensure `noona-warden` is listening on `http://localhost:4001` before launching the panel. You can either run `node initWarden.mjs` (minimal or `DEBUG=super`) or start the published container with `./scripts/run-warden.sh` / `pwsh ./scripts/run-warden.ps1`, which automatically creates the `noona-network` and exposes port `4001`.

1. Install the shared dependencies (only required once):
   ```bash
   npm install
   ```
2. (Optional, but required whenever you change files inside `deployment/panel/`.) Build the React control panel:
   ```bash
   npm run deploy:panel:build
   ```
   For an iterative UI workflow you can run the Vite dev server instead: `npm run deploy:panel:dev`.
3. Start the deployment server:
   ```bash
   npm run deploy:server
   ```
4. Open [http://localhost:4300](http://localhost:4300) in your browser. The server automatically serves the bundled panel from `deployment/dist/index.html`.

## Controls at a Glance

The page is organised into cards. Each card writes NDJSON responses into the streaming log so you can follow progress without leaving the browser.

### Services
* **Refresh status** calls `/api/services` and prints the latest container inventory and lifecycle history.
* **Load settings** requests `/api/settings` and hydrates the JSON editor with the current defaults.

### Build
* Provide a comma-separated list of services or leave the field blank to target the entire stack.
* Toggle **Use --no-cache** to force a clean Docker build.
* Optionally set a JSON concurrency override (for example `{"workers":2}`) to mirror CLI behaviour.

### Registry (Push / Pull)
* Enter services to scope the registry operation, or leave blank to act on every managed image.
* Use **Push images** or **Pull images** to relay to `/api/push` or `/api/pull` respectively.

### Start / Stop
* Choose services to boot, pick the debug level, and set the boot mode (`standard` or `super`).
* The **Start services** button dispatches `/api/start`; the **Stop all** button stops every managed container via `/api/stop`.

### Cleanup
* **Remove selected resources** invokes `/api/clean` for specific services.
* **Delete all Noona Docker resources** posts to `/api/delete` and requires the confirmation checkbox.
* Cleanup calls only target images in the `captainpax/noona-*` namespace (or entries on the internal allowlist) and lifecycle history now records the canonical image tag once per run so repeated digests do not clutter `deployment/lifecycleHistory.json`.

### Settings
* Paste raw JSON updates into the editor to patch deployment defaults.
* Click **Update settings** to send the payload to `/api/settings` via `PATCH`.

## Streaming Output

* Every operation streams NDJSON responses that are rendered in the terminal-style log area at the bottom of the page.
* Log entries differentiate structured tables, container log tail output, reporter log levels, and generic progress events.
* The log retains the 500 most recent entries and auto-scrolls so long-running jobs stay visible.

## Keyboard & Accessibility Notes

* Buttons and inputs follow the browser's default keyboard navigation order.
* Screen readers announce log updates thanks to `aria-live` attributes on the stream and status panes.
