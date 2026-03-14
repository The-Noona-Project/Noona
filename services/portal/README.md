# Portal

Portal is Noona's Discord and Kavita bridge. It powers the Discord bot, onboarding flows, recommendation notifications,
and Kavita account handoff features.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Portal AI docs](../../docs/agents/portal/README.md)
- [Entrypoint](initPortal.mjs)
- [HTTP routes](routes/)
- [Discord commands](commands/)
- [Tests](tests/)

## What Portal Does

- connects Noona to Discord
- handles onboarding and recommendation-related messaging
- bridges Moon and Kavita for account and metadata flows
- exposes the public-facing Portal HTTP endpoints used by the stack

## Who It Is For

- Server admins configuring Discord and onboarding
- Contributors working on Discord, notifications, and Kavita bridge behavior

## When An Admin Needs To Care

- when setting up or changing the Discord bot
- when user onboarding or recommendation notifications break
- when Kavita handoff or metadata bridge features fail

## How It Fits Into Noona

Portal is not the first thing admins install directly. Warden manages it as part of the stack, Moon exposes its
settings, and Discord users see its behavior through the bot and onboarding links.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/portal/README.md](../../docs/agents/portal/README.md)
