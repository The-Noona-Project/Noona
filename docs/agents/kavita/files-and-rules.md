# Kavita Files And Rules

## Important Files

- [entrypoint.sh](../../../services/kavita/entrypoint.sh): Noona-managed container start behavior.
- [noona-bootstrap-admin.sh](../../../services/kavita/noona-bootstrap-admin.sh): optional admin bootstrap helper.
- [API/Controllers/AccountController.cs](../../../services/kavita/API/Controllers/AccountController.cs): Noona
  login-handoff and account entrypoints.
- [UI/Web/src/app/registration/user-login/user-login.component.ts](../../../services/kavita/UI/Web/src/app/registration/user-login/user-login.component.ts):
  login UI touchpoint.

## Rules

- Keep Noona-specific behavior isolated from upstream Kavita changes where possible.
- Do not treat the managed bootstrap helper as the primary public install path; Warden owns that story.
- Login-handoff changes are user-visible and must update public/admin docs.
