# Moon API And Proxy Boundaries

## Main Proxy Files

- backend discovery and fetch helpers:
  [../../../services/moon/src/app/api/noona/_backend.ts](../../../services/moon/src/app/api/noona/_backend.ts)
- session cookie helpers:
  [../../../services/moon/src/app/api/noona/_auth.ts](../../../services/moon/src/app/api/noona/_auth.ts)
- route handlers:
  [../../../services/moon/src/app/api/noona/](../../../services/moon/src/app/api/noona/)

## Current Backend Ownership

- Sage is the main Moon backend.
  Setup, auth, settings, services, Raven actions, recommendations, subscriptions, and install monitoring all proxy to
  Sage.
- Portal is used for Kavita and metadata-specific helpers.
  Examples: `portal/kavita/*`, `settings/portal/join-options`, and `kavita/login`.
- `wardenJson()` and `ravenJson()` exist in `_backend.ts`, but the live Moon route surface is primarily Sage plus
  Portal.
  Do not bypass Sage casually just because a lower-level helper exists.

## Route Groups

- setup and install:
  `/api/noona/setup/*`,
  `/api/noona/install*`,
  `/api/noona/services*`
- auth and users:
  `/api/noona/auth/*`
- Raven and library actions:
  `/api/noona/raven/*`
- recommendations and subscriptions:
  `/api/noona/recommendations*`,
  `/api/noona/myrecommendations*`,
  `/api/noona/mysubscriptions*`
- settings and service control:
  `/api/noona/settings/*`
- Portal and Kavita helpers:
  `/api/noona/portal/*`,
  `/api/noona/kavita/login`

## Session Auth Model

- Moon stores the Sage-issued session token in cookie `noona_session`.
- Cookie options are built in
  [../../../services/moon/src/app/api/noona/_auth.ts](../../../services/moon/src/app/api/noona/_auth.ts):
  HTTP-only, `sameSite=lax`, path `/`, one-day max age, and `secure=true` only on production HTTPS requests.
- Route handlers call `withNoonaAuthHeaders()` to add `Authorization: Bearer <token>` server-side.
- Client components do not directly read the session token.
  They only call Moon's own API routes.

## Backend Discovery

`_backend.ts` keeps a preferred successful base URL per backend and retries across fallbacks when needed.

Current fallback sources:

- Sage:
  `SAGE_BASE_URL`, `SAGE_INTERNAL_BASE_URL`, then Docker or localhost fallbacks on port `3004`
- Portal:
  `PORTAL_BASE_URL`, `PORTAL_INTERNAL_BASE_URL`, `PORTAL_DOCKER_URL`, then Docker or localhost fallbacks on port
  `3003`
- Raven helper:
  `RAVEN_BASE_URL`, `RAVEN_INTERNAL_BASE_URL`, `RAVEN_DOCKER_URL`, then Docker or localhost fallbacks
- Warden helper:
  `WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`, then Docker or localhost fallbacks

Important behavior:

- Supported Warden-managed installs should normally leave Moon `SAGE_BASE_URL` blank and rely on
  `http://noona-sage:3004` over `noona-network`.
  The managed Moon service config now exposes `SAGE_BASE_URL` only as a custom-topology escape hatch.
- `fetchFirstOk()` tries alternate backends when no preferred target exists yet and one candidate returns `4xx`.
  This avoids pinning Moon to a stale endpoint too early.
- Once a request succeeds, that backend becomes the preferred candidate for later calls.
- All backend fetches use `cache: "no-store"` and a timeout, defaulting to `8000` ms unless a route overrides it.

## Boundary Rules

- Keep browser traffic behind Moon's Next route handlers.
- Prefer Sage for Noona-owned browser workflows even when a lower-level service technically exposes a direct endpoint.
- Preserve Moon's response contract.
  Route handlers should forward upstream status and payload when the backend replied, and use `jsonError()` only when
  the Moon-side proxy itself failed.
- If you add a new internal-service dependency, update this doc and the relevant service docs together.

## Error And Timeout Notes

- `jsonError(message, status)` defaults to `502`.
- When Sage candidates are exhausted, Moon now tells operators to check `noona-sage` health and `noona-network`, and
  points custom deployments at `SAGE_BASE_URL` instead of only listing raw fallback URLs.
- Moon only adds that unreachable-Sage guidance when every candidate failed at the transport or discovery layer.
  If any Sage backend returned an HTTP response such as `502`, Moon now preserves that upstream failure summary without
  claiming Sage was unreachable.
- Some routes intentionally raise timeouts:
  factory reset currently uses a five-minute Sage timeout window.
- Portal metadata routes can opt into returning `5xx` payloads directly so the UI can show the backend's structured
  error instead of collapsing everything into a generic proxy failure.
