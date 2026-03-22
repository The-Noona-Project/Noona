# Moon Discord Onboarding Message

## What It Is

- The onboarding message editor lives on Moon's Discord settings view in
  [../../../services/moon/src/components/noona/SettingsPage.tsx](../../../services/moon/src/components/noona/SettingsPage.tsx).
- v1 stores a reusable text template, renders a local preview, and lets the admin copy that rendered preview.
- Portal does not currently read, queue, or send this message automatically.
  It is stored admin-facing helper state, not a live Portal DM workflow.

## Ownership Split

- Moon owns the textarea, placeholder cards, rendered preview, reload/save buttons, and clipboard copy behavior in
  [../../../services/moon/src/components/noona/SettingsPage.tsx](../../../services/moon/src/components/noona/SettingsPage.tsx).
- Moon proxies GET and PUT through
  [../../../services/moon/src/app/api/noona/settings/discord/onboarding-message/route.ts](../../../services/moon/src/app/api/noona/settings/discord/onboarding-message/route.ts),
  which forwards the request to Sage with the current `noona_session` auth headers.
- Sage owns persistence, admin gating after setup completion, default seeding, and validation in
  [../../../services/sage/routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs)
  and [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs).
- The stored settings document key is `discord.onboarding_message`.
- Vault Mongo is the durable backing store.
  If Vault Mongo is unavailable, Sage returns `503` for both reads and writes.

## Default And Persistence

- Sage seeds the default template during `ensureDefaultSettings()` on the first successful admin persistence in
  [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs).
- Current stored shape is:
  `key`
  `template`
  `updatedAt`
- Writes require a non-empty trimmed `template`.
  Moon rejects empty saves client-side first, and Sage repeats that validation server-side as a backstop.
- Moon displays the returned `updatedAt` value in the settings card header.
- Current contract is covered in
  [../../../services/sage/tests/sageApp.test.mjs](../../../services/sage/tests/sageApp.test.mjs),
  including the seeded default, persistence, empty-template rejection, and post-setup admin gating.

## Preview And Placeholder Resolution

- Supported placeholders are:
  `{guild_name}`,
  `{guild_id}`,
  `{moon_url}`,
  `{kavita_url}`,
  `{server_ip}`
- `{guild_name}` comes from the latest successful Discord validation result in the current browser session.
  It is not loaded from persisted settings.
- `{guild_id}` comes from the current Portal `DISCORD_GUILD_ID` editor value.
- `{moon_url}` comes from Moon's published `hostServiceUrl` in the loaded service catalog or config state.
- `{kavita_url}` prefers Portal's `KAVITA_EXTERNAL_URL` draft and otherwise falls back to Kavita's published
  `hostServiceUrl`.
- `{server_ip}` comes from the Warden `SERVER_IP` editor value.
- Preview resolution is browser-local in
  [../../../services/moon/src/components/noona/SettingsPage.tsx](../../../services/moon/src/components/noona/SettingsPage.tsx).
  It uses the current template plus the current editor state, so the preview can change before related settings are
  saved.
- Unknown placeholders are preserved as literal text.
- Known placeholders with no current value also stay visible and are listed under the preview as unresolved.

## Load, Save, And Copy Flow

- Entering the Discord settings view triggers two reads:
  Moon ensures the `noona-portal` and `noona-warden` config editors are loaded, and then fetches the stored template.
- `Reload` discards unsaved local edits and reloads the stored template from Sage.
- `Save` persists the raw template, not the rendered preview.
- `Copy preview` copies the rendered preview text, not the template with placeholders.
- Moon forwards Sage's returned status and payload through its Next route.
  Proxy failures become Moon-shaped JSON errors, but Sage-auth or validation responses are preserved.

## Editing Reminders

- If the placeholder contract changes, update Moon's settings UI, this note, and the Sage route tests together.
- If the storage key, seeded default, or admin gate changes, update
  [../sage/README.md](../sage/README.md) and the Sage-focused notes alongside this Moon note.
- If Portal ever starts sending this message automatically, update Portal docs too.
  The current manual copy-and-paste boundary is intentional and easy to miss.
