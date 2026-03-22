# Noona Server Admin Guide

This is the main admin handbook for Noona. The supported install path is Docker + Warden only.

## Quick Navigation

- [Repo overview](README.md)
- [Warden README](services/warden/readme.md)
- [Moon README](services/moon/README.md)
- [Bash Warden bootstrap](scripts/run-warden.sh)
- [PowerShell Warden bootstrap](scripts/run-warden.ps1)
- [AI docs index](docs/agents/README.md)

## Supported Install Path

Use Docker to run Warden, then complete setup from Moon. This guide does not cover source installs or alternate control
planes.

## Before You Start

- Install Docker Engine or Docker Desktop on the host.
- Pick a persistent storage root for Noona data.
- Make sure the host can expose Warden on `4001` and Moon on `3000`.
- Mongo, Redis, and Vault do not need host port exposure for the supported install path. Mongo and Redis stay
  internal-only. The stack reaches shared data through Vault, including Portal's short-lived onboarding and Discord
  queue state.
- If you plan to use Discord login and the Discord bot, have your Discord app and bot details ready for first-run setup.

## 1. Pull And Start Warden

Choose a permanent data path first.

Linux example:

```bash
export NOONA_DATA_ROOT=/srv/noona
./scripts/run-warden.sh
```

Windows PowerShell example:

```powershell
$env:NOONA_DATA_ROOT = Join-Path $env:APPDATA 'noona'
./scripts/run-warden.ps1
```

What this does:

- pulls `docker.darkmatterservers.com/the-noona-project/noona-warden:latest` if needed
- creates the `noona-network` Docker network if it does not exist
- starts the `noona-warden` container
- exposes Warden on port `4001`
- lets Warden create and manage the private `noona-data-network` during stack boot

If you need a different image, port, or container name, set `WARDEN_IMAGE`, `WARDEN_PORT`, or `WARDEN_CONTAINER_NAME`
before running the script.

## 2. Confirm The Stack Is Reachable

- Warden health: `http://localhost:4001/health`
- Moon: `http://localhost:3000`
- Mongo and Redis are intentionally not published on host ports
- Vault is an internal service and is reached by the rest of the stack over Warden-managed HTTPS on `noona-network`
- `noona-vault` is the only managed bridge onto the private `noona-data-network`
- If you override Portal service config, keep `PORTAL_REDIS_NAMESPACE` and `PORTAL_DM_QUEUE_NAMESPACE` under `portal:`
  so Vault will authorize those Redis-backed Portal keys

Warden brings up the bootstrap services that Moon needs for setup. If Moon does not appear after Warden starts, check
`docker ps` and `docker logs noona-warden`.
Warden's health payload now includes readiness metadata.
If `/health` responds with `ready: false`, the API process is up but bootstrap is still in progress, so brief setup
catalog or install-preview retries are expected during first boot.
After setup is complete, a normal Warden restart still comes back in minimal mode first.
That means `noona-sage` and `noona-moon` are restored immediately, while the saved ecosystem waits for a manual start
from Moon's `/bootScreen`.
That boot screen is only for this post-restart minimal-mode handoff.
Later single-service outages, failed probes, or temporarily stopped selected services should not send an already-started
system back there.

## 3. Complete First-Run Setup In Moon

Moon's first-run flow is task-based:

1. `Storage`
2. `Library Setup`
3. `Discord`
4. `Install`
5. `Finish`

Use that flow to choose your storage root, configure managed services, and install the rest of the stack. The supported
public path is to let Warden derive the managed service selection from the setup profile instead of editing raw
container settings by hand.

If you upload an older Noona setup JSON file during setup, Moon now loads it into the wizard for review first. Confirm
the storage path and any secrets, then use the explicit save or install actions to persist the updated profile.
Saved setup JSON keeps `storageRoot` as top-level setup metadata.
Masked secrets are still safe for setup save and download round-trips, but managed Kavita provisioning may ask you to
re-enter the Kavita admin password before continuing when only the masked placeholder is available.
Moon saves the setup snapshot before direct install so Warden can derive and apply the managed service plan from that
persisted profile.
The managed Kavita plus Discord live preflight stays on the setup summary path, where those running services are
available for browser-facing validation and handoff.
When Portal or Komf already has the managed Kavita API key from install, Sage now reuses that installed key on the
summary sync path instead of forcing a second Kavita admin login.
If those live post-install sync calls fail after the stack is already installed, Moon now opens the summary anyway and
shows one-shot warnings there instead of trapping you on the install tab.
Warden derives the managed service storage wiring internally instead of persisting raw `NOONA_DATA_ROOT` overrides per
service.
Once setup is complete, later Warden restarts intentionally land on Moon's public `/bootScreen` when the saved
ecosystem is not already running.
Use `Start ecosystem` there to trigger the same lifecycle order Warden uses for full startup.
That boot screen now shows the required recovery services, the saved target services, and the page Moon will return to
after the stack stabilizes.
If a service fails later after the ecosystem has already been started for the current Warden session, Moon should stay
in the normal app instead of treating that as a fresh boot-screen case.

## 4. First Admin And Discord Notes

- Moon sign-in is Discord-first.
- During first-run setup, configure Discord OAuth for Moon and the Portal bot settings you want to use.
- If you want one trusted Discord account to run Portal's private bulk queue command, set `DISCORD_SUPERUSER_ID` in
  Moon under `Admin -> Integrations -> Discord`.
- The configured superuser can DM the bot `downloadall type:manga nsfw:false titlegroup:a`.
  Portal accepts `downloadall`, `/downloadall`, or `!downloadall` only in DMs and ignores the same syntax from anyone
  else.
- On the finish or summary step, use the Discord login flow to create the first Noona admin session.
- Managed Kavita admin credentials are separate. If you provide Kavita admin defaults during setup, Warden can seed the
  managed Kavita admin and API-key flow for you.

## Signed-In Shell Music And Live Toasts

- After setup is complete and you are signed into Moon, the slide-out menu includes a `Music` card above `Display`.
- Background music is enabled by default in the signed-in app shell only.
- Mute state and volume are saved per browser in local storage, so each browser can keep its own preference.
- Moon also shows in-app live toasts for three signed-in events:
  actual `Now Playing` starts,
  followed-title chapter DM activity,
  and recommendation approvals or denials.
- Music toasts open the shell drawer back to the `Music` controls.
  Subscription and recommendation toasts open the related Moon detail page when the route is available.
- Moon keeps last-seen recommendation and subscription toast state per signed-in user in browser storage, so users can
  get a one-time catch-up summary after they come back without replaying the same toasts on every refresh.

## Storage And Data Expectations

`NOONA_DATA_ROOT` is the shared host root for Noona data.

Defaults:

- Windows: `%APPDATA%\\noona`
- Non-Windows: `/mnt/user/noona`

Recommended practice:

- set `NOONA_DATA_ROOT` explicitly to a path you control
- keep that path on persistent storage
- back up the entire tree regularly

Important paths under the storage root:

- `wardenm/noona-settings.json`: canonical setup snapshot
- `warden/service-runtime-config.json`: runtime service overrides
- `vault/`: shared Vault, Mongo, and Redis state used by the stack
- `vault/tls/`: Warden-managed internal CA plus the Vault HTTPS certificate and key
- `raven/`: download and library worker data
- `kavita/`: managed Kavita config
- `komf/`: managed Komf config

If you still have older `noona-settings.json` or `warden/setup-wizard-state.json` files from an earlier install,
Warden migrates them into `wardenm/noona-settings.json` and removes the duplicates when it can.

During first-run, before Warden has created `vault/tls/ca-cert.pem`, Sage's setup wizard state may temporarily stay on
its local fallback cache instead of writing through Vault.
Once Vault is installed and that CA file exists, wizard-state persistence resumes over the managed internal HTTPS path.
Managed Kavita API key provisioning can still continue during this warm-up window, but Sage may defer mirroring the
managed service-account snapshot into Vault-backed settings until Vault trust is ready.
Warden also keeps writing `warden/service-runtime-config.json` during that window, so managed runtime env changes can
survive the warm-up even when the Vault-backed settings write has to wait.
Other Vault-backed service traffic now stays HTTPS-only as well; packet clients use the managed CA bundle directly and
do not fall back to plain HTTP during this warm-up window.

If Warden runs in a Linux container, mount `NOONA_DATA_ROOT` into that container at the same absolute path as the host
so setup snapshots and runtime files stay visible on the host.
If that same-path bind mount is missing, Warden now blocks Vault startup with an explicit `NOONA_DATA_ROOT` bind-mount
error instead of letting Vault fail later with missing TLS files.
Likewise, if Warden is expected to be running as the `noona-warden` container on `noona-network` and cannot find that
container during bootstrap, it now treats that as a real startup error instead of silently skipping the attach.

## Updates, Restarts, Backups, And Factory Reset

Updates:

- Use Moon's `Admin -> System -> Updates` for normal managed-image updates.
- `AUTO_UPDATES=true` is optional if you want Warden to check startup images during boot.

Restarts:

- Use Moon `Admin -> System -> Overview` for ecosystem start, stop, and restart actions.
- Start and restart now open Moon's shared `/rebooting` monitor and wait for required services to recover before
  returning.
- Services that are running but do not expose a dedicated health endpoint now show as `No probe` in that monitor
  instead of surfacing as hard boot failures.
- Seeing `/bootScreen` after a host or Warden reboot is expected when setup is complete but the saved ecosystem has not
  been started yet.
- Seeing `/bootScreen` later because one selected service is unhealthy is not expected; troubleshoot the affected
  service from Moon or Warden instead of treating it as a fresh startup requirement.
- Restart the Warden container itself when you update Warden or need to recover the control plane.

Backups:

- Back up the full `NOONA_DATA_ROOT`.
- Make sure your backup includes the Warden snapshot files plus the `vault/`, `raven/`, `kavita/`, and `komf/`
  folders.
- Treat `vault/tls/` as part of the backup set because the stack reuses that internal CA and server certificate bundle.

Factory reset:

- Use the reset controls in Moon only if you intend to wipe the install state.
- Back up first. Reset clears Warden's persisted setup and runtime snapshots so the old stack is not restored on the
  next boot.

## Users, Roles, And Permissions

Manage Noona users in Moon at `Admin -> People -> Users & roles`.

The current Moon permission set is:

- `moon_login`
- `library_management`
- `download_management`
- `mySubscriptions`
- `myRecommendations`
- `manageRecommendations`
- `user_management`
- `admin`

Also in Moon:

- `Admin -> Integrations -> Discord` manages Discord bot validation, onboarding defaults, and per-command role gates.
- That same Discord settings screen also carries the optional `DISCORD_SUPERUSER_ID` field for the private DM-only
  `downloadall` command.
- `Admin -> Integrations -> Kavita` manages Kavita-related defaults and external link settings.

Use Moon's default-permissions controls if you want new Discord-linked users to start with a standard role set.

## Common Troubleshooting

Moon does not load:

- check `docker ps`
- confirm Warden health at `http://localhost:4001/health`
- if Warden responds but `ready: false`, wait for bootstrap to finish or inspect `docker logs noona-warden` for the
  first failing startup dependency
- inspect `docker logs noona-warden`

Moon settings or service links fail with a Sage backend error:

- confirm `noona-sage` is running and healthy
- confirm `noona-moon` and `noona-sage` are both attached to `noona-network`
- Moon now retries short transient Sage `502`, `503`, and `504` responses on auth, setup, and service-catalog reads.
  If the browser error survives that bounded retry window, treat it as a real Sage or upstream problem rather than a
  one-off warm-up blip.
- if Moon shows a Sage `HTTP 5xx` summary, treat it as a reachable Sage or upstream failure rather than a network-path
  issue and inspect the Sage logs before changing Moon `SAGE_BASE_URL`
- if Moon is running in a custom or split topology, open `Admin -> System -> Overview`, set Moon `SAGE_BASE_URL` to a
  reachable Sage URL, then save and restart Moon

Setup changes do not appear on disk:

- confirm `NOONA_DATA_ROOT` is set
- confirm the host path is mounted into containerized Warden on Linux

Install fails with `Vault TLS files could not be loaded` or a `NOONA_DATA_ROOT` bind-mount error:

- confirm Warden itself was started with `-v $NOONA_DATA_ROOT:$NOONA_DATA_ROOT` on Linux
- if you launched Warden from a custom Compose, Unraid, or Docker UI config, add the same-path bind there too
- restart the Warden container after fixing the bind mount, then re-run the install

Discord login or bot setup fails:

- verify the Discord client id, client secret, bot token, and callback settings entered during setup
- confirm Moon is reachable on the same public URL you configured for Discord callbacks
- if the bot token is bad or Discord auth fails during Portal startup, Portal stays healthy in API-only mode and
  `/health` reports Discord as `degraded`; fix the Discord settings in Moon and restart Portal or the stack

Users or permissions look wrong:

- review `Admin -> People -> Users & roles`
- confirm the correct default permissions are saved for new Discord-linked users

Downloads, Kavita, or metadata flows fail after a reboot:

- confirm the storage root persisted across the reboot
- if Moon redirects to `/bootScreen`, use `Start ecosystem` there before treating missing Portal, Raven, Kavita, or
  Komf containers as a restore failure
- if Moon stays in the normal app and only one selected service is unhealthy, troubleshoot that service directly; an
  unhealthy probe alone should not force `/bootScreen`
- check service health and logs from Moon or Warden before changing settings by hand
- if managed Kavita is enabled, expect Portal and Komf to reuse only validated Kavita plugin keys; stale recovered keys
  will now be replaced during setup or restore instead of being silently reused
- Raven now keeps fractional chapters such as `101.1` and `101.5` as separate chapters during queueing and sync, so
  seeing those alongside `101` is expected behavior rather than a duplicate-collapse bug

PIA regions stay blank or Raven VPN shows no IP:

- open Moon at `Admin -> System -> Downloader` and read the VPN error shown under the PIA section before changing
  Docker capabilities or tunnel device settings
- while Raven is rotating, Moon disables the VPN controls until the runtime settles; wait for the rotation to finish
  before retrying the action
- `Save VPN` now persists the current card values first and immediately applies connection-affecting changes such as
  enablement, region, or PIA credential updates.
  If Raven rejects that apply, Moon keeps the saved values in place and shows the final Raven error instead of rolling
  the card back silently.
- `Rotate now` now saves the current on-screen VPN draft before Raven reconnects.
  Unsaved region, username, or password edits on the card are part of the rotation request.
- when `Rotate now` fails after polling settles, Moon now shows Raven's phase-specific final failure text in the card.
  Read that message first because cleanup details may be appended after the original tunnel or route error.
- when VPN is enabled, Raven now tries to establish the baseline tunnel automatically even if auto-rotate is off, so a
  queued download that says it is waiting on VPN should normally start on its own once the tunnel comes up
- queued downloads waiting on VPN now react to fresh settings reads immediately.
  If you disable the VPN gate or change VPN settings to remove the wait condition, Raven should stop waiting without
  needing an extra cache-delay retry window.
- VPN login tests now return their final result directly, so a success or failure message from Moon is the real probe
  outcome rather than a background-start notice
- Raven now keeps the last known-good PIA profiles on disk after a bad upstream refresh, so an empty region list plus a
  concrete profile error usually points to PIA profile refresh or archive-layout problems rather than the first
  OpenVPN tunnel step
- VPN settings only accept the `pia` provider.
  Sage rejects any other provider before the settings document is saved, so unsupported providers should be treated as
  a configuration error rather than a Raven runtime problem.
- `Rotate now` still starts the VPN change in the background, but `Test login` waits for the actual probe result before
  returning.
- if Moon's downloads page shows a queued job waiting on VPN, read the reported connection state and last error there
  first; use `Rotate now` from `Admin -> System -> Downloader` only if Raven is not recovering automatically
- if the error mentions missing `.ovpn` profiles or a failed profile refresh, retry the region reload after upstream
  connectivity is healthy; a later successful refresh or rotation clears the stale profile error automatically

Managed service logging fails or host log folders stay empty:

- confirm the expected host log folder exists under `NOONA_DATA_ROOT` such as `moon/logs`, `portal/logs`,
  `raven/logs`, `sage/logs`, or `<vault-folder>/logs`
- Warden bootstraps managed log folders before service start; when a service declares a numeric container user, expect
  the host log folder to be owned by that `uid:gid` and set to group-writable `775`
- services without an explicit numeric container user still get a helper-container bootstrap so Warden does not have to
  assume a host-specific owner or group mapping
- if your host or NAS resets permissions after boot, restore writable access on the affected log folder and restart the
  service from Moon or Warden
- inspect `docker logs noona-warden` for log-directory bootstrap errors before changing container settings by hand

Moon background music does not play:

- open the Moon menu and confirm `Music` is enabled above the `Display` controls
- confirm the browser did not mute the site and that the local volume slider is above `0`
- if the session just expired, sign in again so Moon can re-request Sage's authenticated track stream

Direct Mongo or Redis host access is unavailable:

- this is expected in supported installs because those services are private to Docker
- use Moon, Sage, Warden, or other Vault-backed flows instead of opening direct DB ports
