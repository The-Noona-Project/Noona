# Kavita Files And Rules

## Important Files

- [../../../dockerfiles/kavita.Dockerfile](../../../dockerfiles/kavita.Dockerfile): Noona image build and runtime file
  copy points.
- [entrypoint.sh](../../../services/kavita/entrypoint.sh): Noona-managed container start behavior.
- [noona-bootstrap-admin.sh](../../../services/kavita/noona-bootstrap-admin.sh): optional managed first-admin
  bootstrap helper.
- [API/Controllers/AccountController.cs](../../../services/kavita/API/Controllers/AccountController.cs): Noona
  login-handoff and account entrypoints.
- [API/DTOs/Account/NoonaLoginConfigDto.cs](../../../services/kavita/API/DTOs/Account/NoonaLoginConfigDto.cs):
  browser-facing Noona login config payload.
- [API/DTOs/Account/NoonaLoginTokenRequestDto.cs](../../../services/kavita/API/DTOs/Account/NoonaLoginTokenRequestDto.cs):
  token submit payload for Noona login completion.
- [UI/Web/src/app/_services/account.service.ts](../../../services/kavita/UI/Web/src/app/_services/account.service.ts):
  browser API calls for `noona-config` and `noona-login`.
- [UI/Web/src/app/registration/user-login/user-login.component.ts](../../../services/kavita/UI/Web/src/app/registration/user-login/user-login.component.ts):
  login page state, redirect construction, and query-param handling.
- [UI/Web/src/app/registration/user-login/user-login.component.html](../../../services/kavita/UI/Web/src/app/registration/user-login/user-login.component.html):
  `Log in with Noona` button and password-form visibility.

## Rules

- Keep Noona-specific behavior isolated from upstream Kavita changes where possible. This repo is mostly vendored
  upstream code with a small Noona delta.
- Preserve the first-run config-copy behavior in
  [entrypoint.sh](../../../services/kavita/entrypoint.sh): copy the default appsettings file only when the live config
  file is missing.
- Do not treat the managed bootstrap helper as the primary public install path. Warden owns install and startup.
- Keep the bootstrap helper best-effort and non-fatal. Partial admin env should skip with a clear log line rather than
  breaking container startup.
- Preserve the current Noona login contract unless the callers are updated in the same change:
  `GET /api/account/noona-config` returns `enabled`, `moonBaseUrl`, and `disablePasswordLogin`, while
  `POST /api/account/noona-login` consumes a one-time token from Portal.
- The Noona login handoff signs an existing Kavita user in; it does not currently create a new Kavita user on demand.
- Keep UI and API password-login behavior aligned when `NOONA_SOCIAL_LOGIN_ONLY` changes. A hidden form without server
  enforcement, or server enforcement without the UI hint, creates a bad operator and user experience.
- User-visible bootstrap or login-handoff changes must update
  [../../../services/kavita/README.md](../../../services/kavita/README.md) and
  [../../../ServerAdmin.md](../../../ServerAdmin.md).
