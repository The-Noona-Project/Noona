# Portal Discord DM Queue And Workers

## Outbound DM Queue

- Durable DM delivery lives in
  [../../../services/portal/discord/client.mjs](../../../services/portal/discord/client.mjs).
- The queue namespace defaults to `portal:discord:dm` and is configurable through `PORTAL_DM_QUEUE_NAMESPACE`.
- Queue TTL comes from `PORTAL_TOKEN_TTL`.
  The same TTL family is reused for onboarding tokens and queued DM packets.
- `sendDirectMessage()` chooses the best available path in this order:
  Vault Redis list queue,
  legacy Vault Redis set/get/del queue,
  direct send,
  in-memory serialized fallback when queueing fails unexpectedly

## Queue Modes

- Preferred durable mode uses Vault Redis list helpers:
  `redisRPush()` to enqueue and `redisLPop()` to dequeue
- Legacy durable mode stores a JSON-like array packet through:
  `redisSet()`,
  `redisGet()`,
  `redisDel()`
- Portal automatically falls back from list packets to the legacy packet format when Vault reports unsupported Redis
  list operations.
- If no durable queue helpers exist at all, `sendDirectMessage()` sends immediately through Discord.js.
- If durable queue helpers exist but queueing throws, Portal falls back to an in-memory per-user promise chain for the
  current process lifetime instead of dropping the DM outright.

## Serialization Guarantees

- Queue state is serialized per user, not globally.
- `queueProcessorsByUser` prevents concurrent sends for the same Discord user.
- `pendingQueueResolvers` lets callers await the actual Discord send result even though the payload was first queued.
- On shutdown, pending queued sends are rejected so callers do not hang forever waiting on a DM that can no longer be
  delivered.

## Recommendation Worker

- Recommendation polling lives in
  [../../../services/portal/discord/recommendationNotifier.mjs](../../../services/portal/discord/recommendationNotifier.mjs).
- It polls Vault collection `portal_recommendations`.
- Runtime starts this worker only after a successful Discord login.
  If Portal is in HTTP-only or degraded Discord mode, the worker never starts.
- `PORTAL_RECOMMENDATION_POLL_MS` controls the poll interval.
- The worker coalesces overlapping refreshes with a shared `refreshPromise`.
- `inFlightNotifications` prevents duplicate approval, admin-comment, or completion DMs during overlapping work.

## Recommendation DM Rules

- Approval DM:
  sent once when a recommendation status becomes `approved` or `accepted`
- Admin-comment DM:
  sent for timeline events shaped like a `comment` from an admin actor with a non-empty body
- Completion DM:
  sent once Raven has either produced a matching library title or the recommendation timeline already shows download
  completion
- Notification markers persist back into the recommendation document under `notifications.*` so restarts do not resend
  the same DM

## Recommendation Side Effects

- The recommendation worker also maintains timeline events for:
  download started,
  periodic progress milestones,
  download completed
- Completion links prefer a direct Kavita series URL when Portal can resolve one.
  Otherwise the worker can link back to Moon's recommendation page.
- Moon links prefer configured `MOON_BASE_URL` and otherwise fall back to Warden-discovered Moon service URLs.
- Deferred metadata application also runs here after Raven import succeeds.
  That path can call Kavita metadata APIs, Komf identify APIs, Raven cover updates, and Raven chapter-volume mapping.

## Subscription Worker

- Subscription polling lives in
  [../../../services/portal/discord/subscriptionNotifier.mjs](../../../services/portal/discord/subscriptionNotifier.mjs).
- It polls Vault collection `portal_subscriptions` for `status: active`.
- The worker loads both Raven active downloads and Raven download history, then matches tasks by:
  `titleUuid`,
  source URL,
  normalized title key
- Each completed chapter becomes a chapter notification key.
  Keys are what stop duplicate DMs when the same chapter appears in both active and historical Raven payloads.
- Sent markers persist under `notifications.sentChapterKeys`.
  The list is trimmed to the newest 2000 keys.
- `/subscribe` seeds baseline chapter keys when the subscription is created.
  The notifier respects those seeds so users do not get flooded with old chapter completions as new alerts.

## Message Shape And Ordering

- Recommendation DMs are richer than subscription DMs.
  They can include approver names, Moon links, Kavita links, and metadata/timeline side effects.
- Subscription DMs stay deliberately short:
  title,
  chapter label,
  optional source link
- Subscription events are sorted by task timestamp first and chapter number second so a burst of backfilled completions
  still arrives in a stable order.

## Test Map

- [../../../services/portal/tests/discordClient.test.mjs](../../../services/portal/tests/discordClient.test.mjs)
  covers queued DM serialization plus Redis list-queue behavior.
- [../../../services/portal/tests/recommendationNotifier.test.mjs](../../../services/portal/tests/recommendationNotifier.test.mjs)
  covers approval, admin-comment, completion, Moon-link, and Kavita-link behavior.
- [../../../services/portal/tests/subscriptionNotifier.test.mjs](../../../services/portal/tests/subscriptionNotifier.test.mjs)
  covers chapter matching, sent-key dedupe, and persistence.

## Editing Reminders

- If you change DM queue storage shape or namespace behavior, update both the runtime docs and the queue tests.
- If you change recommendation or subscription document notification markers, update Moon or admin tooling that reads
  those shapes.
- If a worker begins consuming push events instead of polling, document that clearly.
  The current polling design and restart semantics are intentional.
