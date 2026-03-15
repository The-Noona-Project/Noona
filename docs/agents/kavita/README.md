# Kavita AI Notes

Kavita is an upstream project that Noona vendors and wraps with a small set of Noona-specific behaviors. Show the
upstream project some love here: [Kavita on GitHub](https://github.com/Kareadita/Kavita).

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)
- [runtime-and-login-handoff.md](runtime-and-login-handoff.md)
- [Public README](../../../services/kavita/README.md)
- [Noona Dockerfile](../../../dockerfiles/kavita.Dockerfile)

## Service Shape

- Most of [services/kavita](../../../services/kavita/) is upstream Kavita code. Treat it like vendored source, not a
  normal Noona-first service.
- Noona's container wrapper is concentrated in [kavita.Dockerfile](../../../dockerfiles/kavita.Dockerfile),
  [entrypoint.sh](../../../services/kavita/entrypoint.sh), and
  [noona-bootstrap-admin.sh](../../../services/kavita/noona-bootstrap-admin.sh).
- Noona login handoff is concentrated in
  [AccountController.cs](../../../services/kavita/API/Controllers/AccountController.cs),
  [account.service.ts](../../../services/kavita/UI/Web/src/app/_services/account.service.ts), and the
  [user-login component](../../../services/kavita/UI/Web/src/app/registration/user-login/user-login.component.ts).
- The current Noona login bridge is intentionally narrow: Moon provides the login destination, Portal consumes the
  one-time login token, and Kavita signs an existing user into the reader.

## Common Task Map

- Container build, runtime files, first-run config copy:
  [../../../dockerfiles/kavita.Dockerfile](../../../dockerfiles/kavita.Dockerfile) and
  [../../../services/kavita/entrypoint.sh](../../../services/kavita/entrypoint.sh)
- Managed first-admin bootstrap:
  [../../../services/kavita/noona-bootstrap-admin.sh](../../../services/kavita/noona-bootstrap-admin.sh)
- Noona login config, Portal token consume, password-login gating:
  [../../../services/kavita/API/Controllers/AccountController.cs](../../../services/kavita/API/Controllers/AccountController.cs)
- Browser-side Noona login button, callback handling, and token submit:
  [../../../services/kavita/UI/Web/src/app/_services/account.service.ts](../../../services/kavita/UI/Web/src/app/_services/account.service.ts)
  and
  [../../../services/kavita/UI/Web/src/app/registration/user-login/](../../../services/kavita/UI/Web/src/app/registration/user-login/)
- Generic reader, metadata, scanner, or admin-screen behavior:
  assume upstream Kavita first and widen scope only if the task explicitly asks for it

## Cross-Service Impact

- [Warden](../warden/README.md) owns the Docker lifecycle and env injection for managed Kavita.
- [Moon](../moon/README.md) supplies the admin-facing settings and acts as the Noona login destination.
- [Portal](../portal/README.md) issues and consumes the one-time Kavita login tokens used by the Noona handoff.
- User-visible login, bootstrap, or admin guidance changes should stay aligned with
  [../../../services/kavita/README.md](../../../services/kavita/README.md) and
  [../../../ServerAdmin.md](../../../ServerAdmin.md).

## Update Triggers

- If the Noona login handoff changes, update both the API and UI touchpoints in the same change.
- If bootstrap, startup, or env behavior changes, update the admin docs because those are operator-visible workflows.
- If a task starts drifting into broad upstream auth, library, or reader behavior, stop and re-scope before making a
  sweeping vendor edit.
