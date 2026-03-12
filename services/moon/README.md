# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
`/recommendations`, `/mysubscriptions`,
the `/settings/*` route family), setup and auth flows, and the Noona-only service proxy routes consumed by the
frontend.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Docker image](../../dockerfiles/moon.Dockerfile)
- [Main app router](src/app)
- [Runtime launcher](scripts/runNext.mjs)
- [ESLint config](eslint.config.mjs)
- [Home page](src/app/page.tsx)
- [Libraries page route](src/app/libraries/page.tsx)
- [Downloads page route](src/app/downloads/page.tsx)
- [Downloads add route](src/app/downloads/add/page.tsx)
- [Recommendations admin route](src/app/recommendations/page.tsx)
- [Recommendation admin detail route](src/app/recommendations/[id]/page.tsx)
- [My recommendations route](src/app/myrecommendations/page.tsx)
- [My recommendation detail route](src/app/myrecommendations/[id]/page.tsx)
- [My subscriptions route](src/app/mysubscriptions/page.tsx)
- [Legacy recommendation redirect route](src/app/recommendation/page.tsx)
- [Legacy recommendation detail redirect route](src/app/recommendation/[id]/page.tsx)
- [Downloads add page component](src/components/noona/DownloadsAddPage.tsx)
- [Library metadata batch modal](src/components/noona/LibraryMetadataBatchModal.tsx)
- [Recommendations admin page component](src/components/noona/AdminRecommendationsPage.tsx)
- [Recommendation approval modal](src/components/noona/RecommendationApprovalModal.tsx)
- [My recommendations page component](src/components/noona/MyRecommendationsPage.tsx)
- [My subscriptions page component](src/components/noona/MySubscriptionsPage.tsx)
- [Recommendation detail page component](src/components/noona/RecommendationDetailPage.tsx)
- [Rebooting page route](src/app/rebooting/page.tsx)
- [Settings landing redirect](src/app/settings/page.tsx)
- [Settings route group](src/app/settings/[...slug]/page.tsx)
- [Settings navigation components](src/components/noona/settings)
- [Setup wizard route](src/app/setupwizard/page.tsx)
- [Setup summary route](src/app/setupwizard/summary/page.tsx)
- [Discord callback route](src/app/discord/callback/page.tsx)
- [Kavita handoff route](src/app/kavita/complete/page.tsx)
- [Noona page components](src/components/noona)
- [Rebooting page component](src/components/noona/RebootingPage.tsx)
- [Setup wizard component](src/components/noona/SetupWizard.tsx)
- [Shared config editor styles](src/components/noona/ConfigEditor.module.scss)
- [Setup summary component](src/components/noona/SetupSummaryPage.tsx)
- [Discord callback component](src/components/noona/DiscordCallbackPage.tsx)
- [Kavita handoff component](src/components/noona/KavitaLoginBridgePage.tsx)
- [Shared Raven title card](src/components/noona/RavenTitleCard.tsx)
- [Title detail page component](src/components/noona/TitleDetailPage.tsx)
- [App shell](src/components/AppShell.tsx)
- [Site weather overlay](src/components/SiteWeatherFx.tsx)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona)
- [Install history proxy](src/app/api/noona/install/history/route.ts)
- [Home latest-titles proxy](src/app/api/noona/raven/library/latest/route.ts)
- [Raven source-title details proxy](src/app/api/noona/raven/title-details/route.ts)
- [Raven library import proxy](src/app/api/noona/raven/library/imports/check/route.ts)
- [Raven pause proxy](src/app/api/noona/raven/downloads/pause/route.ts)
- [Raven VPN settings proxy](src/app/api/noona/settings/downloads/vpn/route.ts)
- [Raven VPN login test proxy](src/app/api/noona/settings/downloads/vpn/test-login/route.ts)
- [Recommendations admin list proxy](src/app/api/noona/recommendations/route.ts)
- [Recommendations admin detail/delete proxy](src/app/api/noona/recommendations/[id]/route.ts)
- [Recommendations admin approve proxy](src/app/api/noona/recommendations/[id]/approve/route.ts)
- [Recommendations admin deny proxy](src/app/api/noona/recommendations/[id]/deny/route.ts)
- [Recommendations admin comment proxy](src/app/api/noona/recommendations/[id]/comments/route.ts)
- [My recommendations list proxy](src/app/api/noona/myrecommendations/route.ts)
- [My recommendations detail proxy](src/app/api/noona/myrecommendations/[id]/route.ts)
- [My recommendations comment proxy](src/app/api/noona/myrecommendations/[id]/comments/route.ts)
- [My subscriptions list proxy](src/app/api/noona/mysubscriptions/route.ts)
- [My subscriptions unsubscribe proxy](src/app/api/noona/mysubscriptions/[id]/route.ts)
- [Setup layout proxy](src/app/api/noona/setup/layout/route.ts)
- [Setup config snapshot proxy](src/app/api/noona/setup/config/route.ts)
- [Discord auth config proxy](src/app/api/noona/auth/discord/config/route.ts)
- [Discord auth start proxy](src/app/api/noona/auth/discord/start/route.ts)
- [Discord auth callback proxy](src/app/api/noona/auth/discord/callback/route.ts)
- [Noona-to-Kavita login proxy](src/app/api/noona/kavita/login/route.ts)
- [Kavita user-role list proxy](src/app/api/noona/portal/kavita/users/route.ts)
- [Kavita user-role update proxy](src/app/api/noona/portal/kavita/users/[username]/roles/route.ts)
- [Recommendation metadata search proxy](src/app/api/noona/portal/kavita/title-match/search/route.ts)
- [Library metadata status proxy](src/app/api/noona/portal/kavita/series-metadata/route.ts)
- [Managed Kavita key proxy](src/app/api/noona/setup/kavita/service-key/route.ts)
- [Web GUI helpers](src/utils/webGui.ts)
- [Permission helpers](src/utils/moonPermissions.ts)
- [Moon UI configuration](src/resources/moon.config.ts)

## Primary UI Areas

- Shared app shell - The sticky shell header now uses Once UI `MegaMenu` for desktop navigation groups (`Browse`,
  `Activity`, `Control`, and setup flows when setup is still in progress), while the slide-out drawer uses
  `MobileMegaMenu` from the same route model so desktop and mobile navigation stay aligned. The desktop menu is now
  anchored on the left side of the header bar, the old `Noona Stack` brand badge has been removed, and the header
  clock now renders in the client's local 12-hour format. The root layout now also layers
  [public/images/backgrounds/moon-sakura-night.png](public/images/backgrounds/moon-sakura-night.png) behind the Once
  UI background effect surface for the full-app backdrop and mounts a site-wide `WeatherFx` sakura-leaf overlay so
  the animated leaves render across every route instead of only the home page.
- `/` - Home summary and shortcuts into library/download workflows. Recent titles now reuse the same cover-card tiles
  as the main library page so the landing screen and `/libraries` stay visually consistent, and signed-in users
  without `library_management` can still see the latest titles there even though the cards stay non-clickable.
- `/libraries` - Library browsing, filtering, and title drill-down. The tab and direct page now require the
  `library_management` permission. The page now also includes a `Check available imports` action that asks Raven to
  rehydrate titles from on-disk `.noona` manifests, resync missing/new chapters from the source, and trigger a
  Kavita library scan for the affected media types. It now also exposes a `Find missing metadata` batch flow that
  opens a centered modal, loads Kavita series currently marked `notMatched`, filters them to Raven-linked library
  titles, and lets admins confirm/apply Komf metadata one title at a time without leaving `/libraries`.
- `/downloads` - Download queueing, active status, workers summary, and history. The tab and direct page now require
  the `download_management` permission, and the add-download action now links to a dedicated `/downloads/add` page
  instead of an in-page modal. The page now also prioritizes Raven's persisted
  current-task snapshot, including recovery state, remaining queued chapters, and the new-vs-missing split that Raven
  discovered for the active task. The downloads screen now uses a focused mission-control layout instead of the older
  slide-deck view: one primary focus board for the hottest task, a stacked live queue panel, a slimmer worker rail,
  and card-based history summaries for finished/interrupted runs. Active download cards still expose a
  `Pause downloads` action that asks Raven to finish the chapter in progress and persist the remaining chapter queue as
  a paused task.
- `/downloads/add` - Dedicated Raven search/select/queue page for adding downloads. It keeps keyboard shortcuts,
  supports quick single-result queueing, and stores recent search queries for faster repeat queue sessions.
- `/recommendations` and `/recommendations/[id]` - admin-only recommendation management and detail timeline routes.
  They require `manageRecommendations` and expose approve, deny, close, and admin-comment actions. Approving now opens
  a Moon modal that searches metadata candidates through Portal/Komf, lets the manager confirm the intended metadata
  match, then submits that saved metadata plan together with the Raven queue request. Moon shows the saved metadata
  state on both the admin list and detail views so managers can see when metadata is merely queued versus later
  applied in Kavita after the download/import completes. Moon now also surfaces the recommendation's
  `sourceAdultContent` flag from Raven's source-site scrape on the admin list, detail view, and approval modal, and
  requires an explicit confirmation before either approval action queues Raven when the source page reports
  `Adult Content: yes`.
- `/myrecommendations` and `/myrecommendations/[id]` - user recommendation routes that require `myRecommendations` and
  show only the signed-in user's records plus a Once UI timeline for created/approved/denied/comment events and the
  Raven download lifecycle (`download-started`, `download-progress`, `download-completed`).
- `/mysubscriptions` - user subscription route that requires `mySubscriptions` and lists Discord title subscriptions
  with unsubscribe controls.
- `/recommendation` and `/recommendation/[id]` - legacy compatibility redirects into the user timeline routes
  (`/myrecommendations` and `/myrecommendations/[id]`) so older links from Discord messages do not 404.
- `/rebooting` - Internal transition screen used by Warden `Update all`. The settings page now forces a fresh image
  check before launching it, and the reboot monitor persists its queue state in browser session storage so interrupted
  Moon reloads can resume the same update pass instead of starting blind. It also waits for Redis alongside Warden,
  Vault, Sage, and Moon before retrying authenticated update calls, then shows live service health while the stack
  settles.
- `/settings/*` - Route-based settings pages now grouped by user-facing tasks instead of internal service names:
  `/settings/general`, `/settings/storage/filesystem`, `/settings/storage/database`,
  `/settings/downloads/downloader`, `/settings/downloads/updater`, `/settings/external/discord`,
  `/settings/external/kavita`,
  `/settings/external/komf`, and `/settings/users`. These pages cover loaded profile details, ecosystem
  start/stop/restart
  controls, internal and external service links including Moon's public `MOON_EXTERNAL_URL` override, the
  same Warden setup JSON snapshot download/import actions used by the setup wizard, and a load-and-restart path that
  posts an imported settings JSON back to Warden before forcing a full ecosystem restart with the imported service
  selection. Moon now reaches those control-plane reads/writes through Sage's `/api/setup/*` broker routes instead of
  calling Warden directly, and the downloaded snapshot redacts sensitive service secrets while preserving masked-value
  restore support for unchanged credentials. That snapshot now maps to Warden's canonical
  `<NOONA_DATA_ROOT>/noona-settings.json` boot file,
  setup-wizard-style storage tree, editable storage paths, the
  hidden-by-default Vault Mongo URI toggle, a fixed-height sorted Once UI `InfiniteScroll` collection viewer, downloader
  worker/naming
  controls, the dashboard-style Noona Docker updater with summary cards plus a full-width responsive service grid.
  Settings service-card grids now default to five columns on wide layouts and collapse responsively on smaller screens,
  and Raven naming templates now default to the Kavita-style chapter pattern
  `{title} c{chapter} (v01) [Noona].cbz` with a default chapter pad of `3`, while `{chapter}` follows the configured
  chapter padding width and
  `{chapter_padded}` remains available as the same padded value,
  Discord bot validation plus per-command role fields for `/ding`,
  `/join`, `/scan`, `/search`, `/recommend`, and `/subscribe`, the managed
  Komf `/config/application.yml` editor, Vault-backed persistence for service overrides in `noona_settings`, default
  permissions for first-time Discord sign-ins, Kavita default-role editing for new Portal-created users, per-user
  Kavita role updates directly from `/settings/users`, and diagnostics.
  Saving Moon's public `MOON_EXTERNAL_URL` from Service links now also triggers a managed Kavita restart when needed so
  Kavita's `Log in with Noona` button follows the updated Moon URL immediately instead of waiting for a separate
  Kavita restart.
  Successful self-permission edits now update the local user-management state first so Moon does not report a false
  save failure when the change intentionally removes that account's `user_management` access. The Moon permission
  editor now exposes the canonical `library_management`, `download_management`, `mySubscriptions`,
  `myRecommendations`, and `manageRecommendations` roles while still normalizing the legacy Raven permission names
  returned by older records.
  Raven worker speed-limit inputs now accept raw KB/s values
  or `mb` / `gb` suffixes, and `-1` means unlimited speed. Moon's Portal-backed Kavita metadata-match proxy now also
  includes a PIA VPN panel under Downloader settings so admins can store PIA credentials in Vault, pick a Raven VPN
  region endpoint, run a direct login test, trigger immediate IP rotation, configure scheduled auto-rotation
  intervals, and toggle whether Raven should keep queued downloads waiting until the VPN is actually connected.
  During rotation Raven pauses active download tasks, waits for chapter boundaries, rotates, then resumes paused tasks.
  Moon's Portal-backed Kavita metadata-match proxy now also
  uses provider-aware danger-zone confirmation: local admins confirm factory reset with their password, while
  Discord-auth admins confirm with their current Discord-linked username instead of a non-existent local password.
  preserves compact Portal `500` responses for metadata failures instead of collapsing them into a large multi-backend
  error string. When you apply a Kavita metadata match from a Raven library title, Moon now also sends the selected
  `coverImageUrl` so Portal can backfill missing Noona title cover art before syncing the linked Kavita series cover.
- `/setupwizard` - First-run stack configuration flow with storage, integrations, services, and install tabs. It
  previews the shared Noona folder tree, defaults to managed `noona-kavita` and Komf, allows switching either one to
  external URLs, includes a Discord bot login test with client/guild auto-fill for Portal setup, upgrades Portal
  role-id fields into guild-role dropdowns after a successful Discord validation, refreshes those dropdowns for the
  selected guild, collects the first managed Kavita admin username/email/password with password confirmation,
  auto-provisions the managed Kavita API key into Portal/Raven/Komf after install, pushes those credentials into
  managed `noona-kavita` as
  `KAVITA_ADMIN_USERNAME`, `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD`, and persists the selected managed
  service set for future Warden boots. The integrations step now exposes the managed Komf `application.yml` content so
  metadata providers can be tuned before install, starting from the safer MangaUpdates-only default template. The
  services tab groups the managed stack into `Storage`, `Library
  Management`, and `External APIs`, and install payloads follow the Warden lifecycle order (`mongo -> redis -> vault
  -> kavita -> raven -> komf -> portal`). Portal defaults now prefill `/join` access as `*,-admin` for roles and `*`
  for libraries, and the managed Vault token is injected automatically instead of being entered by hand. The install
  tab now starts installs asynchronously, keeps progress polling even if the original request fails after Warden has
  started, reads the current installation-session history instead of generic `noona-warden` service logs, saves the
  same setup JSON payload to Warden (`/api/setup/config`) that users can download for backup/restore (including Kavita
  API fields), automatically writes Warden's canonical `<NOONA_DATA_ROOT>/noona-settings.json` boot snapshot for later
  restores, waits longer for the post-install managed Kavita key provisioning step to finish restarting dependent
  services, and exposes a manual `Continue to summary` action if the automatic redirect needs to be retried.
- `/setupwizard/summary` - Dedicated post-install review page that lists installed services, descriptions, service URLs,
  the Discord OAuth callback URL, full callback-loop testing, Discord superuser bootstrap, and final setup
  completion.
  The setup summary now reads the Discord callback path from the live auth config so the copied redirect URI matches
  the actual Moon OAuth callback exactly instead of relying on a stale hardcoded path. The setup JSON payload Moon
  downloads now matches the snapshot it saves to Warden for boot-time restore and includes
  the active Kavita API key field.
- `/discord/callback` - Browser callback page for the Discord OAuth round-trip used by setup bootstrap and normal Moon
  login. The Discord OAuth redirect path is now normalized to `/discord/callback` without the old trailing slash so
  the public callback URL matches the real Next.js route exactly.
- `/login` and `/signup` - Auth entry points for the Discord-first Moon flow. Both now render the same
  sign-in-or-create-account screen, the main tab bar is hidden there, and first-time Discord sign-in creates the user
  from Sage's default permission template. When Kavita sends users into Moon with a `returnTo`, the login page now
  preserves the explicit public Moon callback URL for the Kavita handoff instead of collapsing it into a generic Moon
  path, so Discord sign-in can bounce directly back into `/kavita/complete` on the correct public origin.
- `/kavita/complete` - Internal Moon bridge route used by Kavita's `Log in with Noona` button. It requires a valid
  Noona session, asks Portal to provision or refresh the user's Kavita account, and immediately redirects the browser
  back to Kavita with a short-lived one-time login token. The bridge now retries Moon login once automatically when
  the Noona session is missing on return, then surfaces a direct error instead of looping forever. It also only honors
  explicit Kavita `target` URLs that stay on the resolved public Kavita origin/path, falling back to Portal's known
  Kavita base URL for the final redirect when the supplied target is not trusted.
- Title detail pages now surface Kavita series links plus metadata match actions, and the footer/title Kavita buttons
  now prefer Portal's configured external Kavita URL (`KAVITA_EXTERNAL_URL`) before falling back to the managed
  host-facing URL from Warden. The title-page
  `Open in Kavita` action and each inline Kavita search-result `Open` button now rebuild the series link from Portal's
  resolved Kavita link base (external when configured, otherwise Warden's host-facing managed URL). Moon's
  metadata-match request now forwards the active title query and selected series id to Portal, which queries Komf
  directly instead of Kavita+. The metadata button opens a centered confirmation modal that lists returned Komf
  candidates with provider source links before applying the selected match, and applying a metadata match from the
  title page still sends the Raven title UUID so Portal can lock Kavita to the same Noona cover art that Moon is
  rendering for that title. Title detail pages now also show Raven's stored downloaded-chapter index, the exact latest
  new/missing chapter plan returned by `Check new/missing`, the live cached Raven task when that task belongs to the
  current title, and source-title metadata such as associated names, release status/year, official translation,
  anime-adaptation flags, and related series links from Raven's source scrape.
- Moon now uses a permission-aware top header plus a slide-out navigation drawer for `Home`, `Library`, `Downloads`,
  `Recommendations`, `Subscriptions`, and `Settings` instead of the old fixed top tab strip. Settings keeps its own
  nested settings-only sub-navigation
  inside the page content, the drawer now opens with the signed-in account card and close control at the top, and it
  still holds the light/dark theme toggle plus a three-mode viewport switch for `desktop`, `ultrawide`, and `mobile`
  framing without pinning the whole page off-center. First-load sessions now default to `ultrawide` framing unless a
  saved view-mode preference exists. The top-level `Recommendations` nav item now routes to
  `/myrecommendations`, and `My subscriptions` routes to `/mysubscriptions`.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history/pause proxies. The dedicated
  `src/app/api/noona/raven/library/latest` feed keeps the Home page's latest-title cards visible for signed-in users
  who do not have `library_management`, while full library/title navigation still stays permission-gated.
- `src/app/api/noona/raven/title-details` - proxy for Raven's live source-title metadata scrape used by Moon's title
  detail page when stored Raven library metadata is missing those source-only fields.
- `src/app/api/noona/recommendations/*` - manager-only recommendation proxies for list/detail, approve, deny, close,
  and admin comments.
- `src/app/api/noona/myrecommendations/*` - user recommendation proxies for own list/detail plus timeline comment
  replies.
- `src/app/api/noona/mysubscriptions/*` - user subscription proxies for list and unsubscribe actions.
- `src/app/api/noona/portal/kavita/*` - Portal-backed Kavita info, title search, and metadata-match proxies.
- `src/app/api/noona/portal/kavita/series-metadata` - proxy for Kavita metadata-match status used by the `/libraries`
  batch metadata modal so admins can step through unmatched titles.
- `src/app/api/noona/portal/kavita/title-match/search` - proxy for standalone metadata candidate search used by the
  recommendation-approval modal before a title exists in Kavita.
- `src/app/api/noona/portal/kavita/users` and `src/app/api/noona/portal/kavita/users/[username]/roles` - Moon
  proxies for loading Kavita user-role data and updating Kavita roles from the user-management page.
- `src/app/api/noona/kavita/login` - signed-in Noona session proxy that forwards the current Discord-backed account to
  Portal's Kavita provisioning route and returns a short-lived Kavita handoff token for the Moon `/kavita/complete`
  bridge.
- `src/app/api/noona/settings/*` - service settings, Portal join option helpers, vault, ecosystem, and debug operations.
- `src/app/api/noona/settings/downloads/workers` - proxy for Raven per-thread speed-limit settings stored by Sage.
  Moon accepts plain KB/s numbers plus `mb` / `gb` suffixes here, and uses `-1` for unlimited workers.
- `src/app/api/noona/settings/downloads/vpn` - proxy for Raven PIA VPN settings stored by Sage/Vault.
- `src/app/api/noona/settings/downloads/vpn/regions` - proxy for Raven's available PIA OpenVPN regions.
- `src/app/api/noona/settings/downloads/vpn/rotate` - proxy to trigger immediate Raven VPN rotation.
- `src/app/api/noona/settings/downloads/vpn/test-login` - proxy to validate provided PIA login credentials against a
  selected region from Moon settings and surface Raven's reported test-session public IP.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/services/[name]/health` - Warden-backed per-service health proxy used by the reboot monitor.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state, installation history, and
  completion APIs. The setup-complete proxy now preserves upstream wizard-state failures and forwards the active Noona
  auth headers when it persists the final selected-service list.
- `src/app/api/noona/setup/layout` - setup-wizard proxy for Warden's resolved storage layout tree.
- `src/app/api/noona/setup/config` - setup-wizard snapshot proxy for Warden's persisted setup JSON file used during
  startup runtime-config restore.
- `src/app/api/noona/setup/discord/validate` - setup-wizard Discord validation proxy for Portal bot credentials.
- `src/app/api/noona/setup/kavita/service-key` - setup-wizard proxy that provisions or reuses the managed Kavita auth
  key after install, optionally creates or logs into the first Kavita admin account from setup-wizard credentials, and
  applies the resulting key to Portal, Raven, and `noona-komf`.
- `src/app/api/noona/auth/discord/*` - Discord OAuth config, flow start, and callback completion.
- `src/app/api/noona/auth/*` - login/logout, session status, and Discord-linked user-management APIs. The legacy
  Moon bootstrap route now returns `410` so username/password signup cannot be used from the Moon web flow anymore, and
  `src/app/api/noona/auth/users/default-permissions` now proxies the first-login permission template editor.

## Key Environment Variables

- `WEBGUI_PORT` - port Moon binds to for `npm run dev` and `npm run start` (defaults to `3000`).
- `NOONA_LOG_DIR` - optional directory for Moon's runtime `latest.log` file when Warden or local dev runs should
  persist web GUI logs to disk.
- `WARDEN_BASE_URL`, `SAGE_BASE_URL`, `RAVEN_BASE_URL`, `PORTAL_BASE_URL` - optional backend overrides for local
  proxy resolution when default container and host fallbacks are not correct.

## Docker Runtime Notes

- The production image is built from [../../dockerfiles/moon.Dockerfile](../../dockerfiles/moon.Dockerfile).
- The runner stage needs the compiled `.next` output, [public](public), [next.config.mjs](next.config.mjs), and
  [scripts/runNext.mjs](scripts/runNext.mjs). Moon no longer ships the old portfolio MDX content tree.

## Local Commands

```bash
cd services/moon
npm install
npm run dev
npm run lint
npm run build
npm run start
```

Set `WEBGUI_PORT` before `npm run dev` or `npm run start` when Moon should bind to a non-default port.
`npm run lint` uses the flat ESLint config in [eslint.config.mjs](eslint.config.mjs).

## Documentation Rule

When tabs, routes, API proxies, package metadata, or major UI flows change, update this README and keep the Quick
Navigation links current so maintainers can jump directly to the updated files.
