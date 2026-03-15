# Kavita Flows

## Boot And Managed Runtime

- Warden builds the image from [kavita.Dockerfile](../../../dockerfiles/kavita.Dockerfile) and starts the managed
  container.
- [entrypoint.sh](../../../services/kavita/entrypoint.sh) ensures `/kavita/config` exists before launching the app.
- On first boot, the entrypoint copies `/tmp/config/appsettings.json` into `/kavita/config/appsettings.json` only when
  the live config file is missing.
- If `NOONA_BOOTSTRAP_ADMIN_ON_START` is truthy and
  [noona-bootstrap-admin.sh](../../../services/kavita/noona-bootstrap-admin.sh) is present, the entrypoint sources the
  helper and starts the bootstrap flow before `exec ./Kavita`.

## Managed First-Admin Bootstrap

- The bootstrap helper is optional and best-effort. It should not take down Kavita startup.
- It only runs when all three admin values are present:
  `KAVITA_ADMIN_USERNAME`, `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD`.
- The helper waits for `http://127.0.0.1:5000/api/health` before making any account calls.
- It first tries `POST /api/Account/register`.
- If register fails, it falls back to `POST /api/Account/login` and treats a successful login as "admin already
  exists."
- The whole bootstrap runs in the background, logs compact status lines, and exits quietly on timeout or partial config.

## Noona Login Button And Redirect

- The Kavita login screen loads public Noona config from `GET /api/account/noona-config`.
- The UI stores that config in
  [account.service.ts](../../../services/kavita/UI/Web/src/app/_services/account.service.ts) and
  [user-login.component.ts](../../../services/kavita/UI/Web/src/app/registration/user-login/user-login.component.ts).
- If the response says Noona login is enabled, the login page shows a `Log in with Noona` button.
- Clicking that button sends the user to Moon's `/login` route with a `returnTo` callback that points to
  Moon's `/kavita/complete` route, which then sends the user back to Kavita with a `noonaToken` query param.

## Noona Token Consumption

- When the Kavita login page sees `noonaToken` in the URL, it clears the query param and immediately posts the token to
  `POST /api/account/noona-login`.
- [AccountController.cs](../../../services/kavita/API/Controllers/AccountController.cs) forwards that token to Portal
  at `/api/portal/kavita/login-tokens/consume`.
- Portal returns the one-time handoff record that Kavita uses for lookup.
- Kavita looks up an existing user by normalized username first, then by normalized email.
- If the token is invalid or expired, Kavita returns an unauthorized response. If Portal is unreachable or returns a
  bad payload, Kavita returns a service-style error instead of silently falling back.

## Password Login Gating

- `GET /api/account/noona-config` also tells the login page whether password login should be hidden.
- The UI hides the password form when `disablePasswordLogin` is true.
- The API enforces the same rule in the normal `POST /api/account/login` path by rejecting password logins when
  `NOONA_SOCIAL_LOGIN_ONLY` is enabled for a valid Noona-login setup.
- Keep the UI and API behavior aligned. Changing only one side creates confusing half-working login states.
