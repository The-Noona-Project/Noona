# Moon AI Notes

Moon is the main Noona web app for setup, login, settings, users, downloads, and recommendation flows.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)

## Key Files

- [src/app/](../../../services/moon/src/app/)
- [src/components/noona/](../../../services/moon/src/components/noona/)
- [src/app/api/noona/](../../../services/moon/src/app/api/noona/)
- [src/utils/moonPermissions.ts](../../../services/moon/src/utils/moonPermissions.ts)
- [src/components/noona/settings/](../../../services/moon/src/components/noona/settings/)

## Change Map

- setup or summary screens: `src/components/noona/Setup*`
- login and session behavior: `src/components/noona/LoginPage.tsx`, `DiscordCallbackPage.tsx`, and auth proxies
- settings IA or navigation: `src/components/noona/settings/`
- permission model: `src/utils/moonPermissions.ts`

If the change affects setup, login, user roles, or admin workflows,
update [../../../ServerAdmin.md](../../../ServerAdmin.md).
