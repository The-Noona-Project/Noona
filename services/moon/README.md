# Moon

Moon is the main Noona web app. It handles first-run setup, login, settings, user management, downloads,
recommendations, and the day-to-day admin UI.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Moon AI docs](../../docs/agents/moon/README.md)
- [App routes](src/app/)
- [Noona UI components](src/components/noona/)
- [Downloads add page](src/components/noona/DownloadsAddPage.tsx)
- [Download queue result helper](src/components/noona/downloadQueueResults.mjs)
- [Noona API proxies](src/app/api/noona/)
- [Tests](tests/)

## What Moon Does

- guides admins through first-run setup
- retries transient Warden-backed setup catalog failures during first boot so the wizard can survive normal
  control-plane
  warm-up instead of failing on the first `502`
- loads uploaded Noona setup JSON files into the wizard for review before admins explicitly save or install changes
- keeps masked setup secrets safe for save or download round-trips, while live setup actions can still ask admins to
  re-enter the managed Kavita password when only the masked placeholder is available
- saves the setup snapshot before direct install so Warden can derive the managed service plan from persisted setup
  state
- redirects completed installs to the public shellless `/bootScreen` route only when Warden has restarted in minimal
  mode and the saved ecosystem still needs a manual start for the current Warden session, instead of sending them back
  into `/setupwizard`
- starts the saved ecosystem from `/bootScreen` through the normal Warden lifecycle path instead of using a separate
  startup flow
- shows the public boot screen as a short startup brief with the required recovery services, saved target services, and
  the return destination before the lifecycle request is sent
- keeps later single-service outages, failed probes, or temporarily stopped selected services inside the normal app
  flow instead of redirecting an already-started system back to `/bootScreen`
- keeps the managed Kavita and Discord live preflight on the summary path, where the running services are available for
  browser-facing validation and handoff
- opens the setup summary with one-shot warnings when those post-install live sync calls fail after the stack is already
  installed, instead of trapping admins on the install tab
- treats Sage `HTTP 5xx` responses as real upstream failures in setup and settings flows instead of always collapsing
  them into a generic "Moon could not reach Sage" connectivity warning
- retries transient Sage `502`, `503`, and `504` responses on auth status, setup status/config, and service-catalog
  reads for a short bounded window so normal backend warm-up does not immediately surface as a browser-facing failure
- keeps `storageRoot` as top-level setup metadata instead of mirroring raw `NOONA_DATA_ROOT` overrides into saved setup
  JSON
- provides the main settings and operations UI
- lets admins keep Moon's published URL and optional Sage backend URL in sync from the service-links view when custom
  networking requires it
- uses the shared `/rebooting` lifecycle monitor for boot-start, signed-in ecosystem start, signed-in ecosystem
  restart, and update-all recovery flows
- keeps reboot-monitor cards concise by collapsing noisy HTML probe payloads and treating running services without a
  dedicated health endpoint as expected "no probe" states instead of hard failures
- keeps post-setup navigation task-based with `Home`, `Library`, `Downloads`, `Requests`, `Admin`, and a header
  `Add download` action when permitted
- plays the configured background track inside the signed-in app shell and keeps `Music` controls above `Display`
  inside the slide-out menu
- shows in-app live toasts for actual music playback starts, followed-title chapter DM activity, and recommendation
  approval or denial changes, with click-through links back into Moon
- handles Discord-first login and account management
- surfaces downloads, libraries, subscriptions, and recommendation flows
- treats Raven download queue attempts as successful only when Raven explicitly accepts them, so expired or invalid
  search selections stay visible as real errors
- keeps the Raven VPN panel locked while Raven reports rotating or connecting, polls manual rotations until they
  settle, prefers Raven's final detailed rotation failure once polling finishes, and shows the final login-test result
  instead of a background-start acknowledgement

## Who It Is For

- Server admins and moderators
- Noona users signing in through Discord

## When An Admin Needs To Care

- during first-run setup
- when managing users, roles, service links, and updates
- when Moon reports that it cannot reach Sage for service-management actions
- when adjusting local browser shell preferences like the background music mute and volume controls
- when checking live in-app toasts that catch users up on music playback, followed-title updates, or recommendation
  decisions after they return to Moon
- when troubleshooting setup, login, or UI-driven service actions
- when the Downloader VPN card is waiting on a rotation or login test to finish and the controls stay disabled until
  Raven reports a settled connection state

## How It Fits Into Noona

Moon is the public face of the stack. Warden runs the services, Sage brokers browser-facing APIs, and Moon turns those
capabilities into the supported admin workflow.

## Next Steps

- Install and run Noona: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/moon/README.md](../../docs/agents/moon/README.md)
