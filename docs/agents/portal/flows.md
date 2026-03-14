# Portal Flows

## Discord Boot

- Portal validates config, logs into Discord, clears stale command registrations, and registers the current command set.
- If the command set changes, Moon's admin settings and docs usually need to change too.

## Onboarding

- Portal exposes onboarding and token-consume endpoints used by the web flow.
- Token persistence lives in the onboarding store and should remain compatible across restarts.

## Recommendations And Notifications

- Portal creates recommendation and subscription records, polls for follow-up state, and sends Discord DMs.
- Metadata and Kavita bridge changes often touch Portal, Moon, Raven, and Komf together.
