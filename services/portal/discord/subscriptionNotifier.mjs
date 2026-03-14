/**
 * @fileoverview Polls Raven and Vault state to deliver subscription chapter notifications.
 * Related files:
 * - clients/ravenClient.mjs
 * - clients/vaultClient.mjs
 * - tests/subscriptionNotifier.test.mjs
 * - app/portalRuntime.mjs
 * Times this file has been edited: 2
 */

const DEFAULT_SUBSCRIPTIONS_COLLECTION = 'portal_subscriptions';
const DEFAULT_POLL_MS = 30000;
const MAX_STORED_CHAPTER_KEYS = 2000;

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeTitleKey = value => normalizeString(value).toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeUrlForCompare = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
};
const normalizeChapterNumbers = value =>
    Array.isArray(value)
        ? value.map(entry => normalizeString(entry)).filter(Boolean)
        : [];
const resolveSubscriptionId = value => {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    if (typeof value.$oid === 'string' && value.$oid.trim()) {
        return value.$oid.trim();
    }

    if (typeof value.toHexString === 'function') {
        try {
            const hex = value.toHexString();
            if (typeof hex === 'string' && hex.trim()) {
                return hex.trim();
            }
        } catch {
            // Best effort fallback below.
        }
    }

    if (typeof value.toString === 'function') {
        const text = value.toString();
        if (typeof text === 'string' && text.trim() && text !== '[object Object]') {
            return text.trim();
        }
    }

    return null;
};
const sortUniqueStrings = values => {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const normalized = normalizeString(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        output.push(normalized);
    }

    return output;
};
const trimStoredChapterKeys = keys => {
    const normalized = sortUniqueStrings(keys);
    if (normalized.length <= MAX_STORED_CHAPTER_KEYS) {
        return normalized;
    }

    return normalized.slice(normalized.length - MAX_STORED_CHAPTER_KEYS);
};
const resolveSubscriptionStatus = value => normalizeString(value).toLowerCase();
const isActiveSubscription = value => resolveSubscriptionStatus(value) === 'active';
const recommendationTitle = (entry = {}) =>
    normalizeString(entry?.title) || normalizeString(entry?.titleQuery) || 'your subscribed title';
const buildSubscriptionDocumentQueries = (entry = {}) => {
    const queries = [];
    const seen = new Set();
    const pushQuery = (query = {}) => {
        if (!query || typeof query !== 'object' || Object.keys(query).length === 0) {
            return;
        }

        const serialized = JSON.stringify(query);
        if (seen.has(serialized)) {
            return;
        }

        seen.add(serialized);
        queries.push(query);
    };

    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, '_id')) {
        pushQuery({_id: entry._id});
    }

    const fallbackQuery = {};
    const subscriberId = normalizeString(entry?.subscriber?.discordId);
    if (subscriberId) {
        fallbackQuery['subscriber.discordId'] = subscriberId;
    }

    const status = normalizeString(entry?.status);
    if (status) {
        fallbackQuery.status = status;
    }

    const titleUuid = normalizeString(entry?.titleUuid);
    if (titleUuid) {
        fallbackQuery.titleUuid = titleUuid;
    }

    const sourceUrl = normalizeUrlForCompare(entry?.sourceUrl);
    if (sourceUrl) {
        fallbackQuery.sourceUrl = sourceUrl;
    }

    const titleKey = normalizeTitleKey(entry?.titleKey || entry?.title || entry?.titleQuery);
    if (titleKey) {
        fallbackQuery.titleKey = titleKey;
    }

    pushQuery(fallbackQuery);
    return queries;
};
const taskMatchesSubscription = (subscription = {}, task = {}) => {
    const subscriptionTitleUuid = normalizeString(subscription?.titleUuid);
    const taskTitleUuid = normalizeString(task?.titleUuid);
    if (subscriptionTitleUuid && taskTitleUuid && subscriptionTitleUuid === taskTitleUuid) {
        return true;
    }

    const subscriptionSourceUrl = normalizeUrlForCompare(subscription?.sourceUrl);
    const taskSourceUrl = normalizeUrlForCompare(task?.sourceUrl);
    if (subscriptionSourceUrl && taskSourceUrl && subscriptionSourceUrl === taskSourceUrl) {
        return true;
    }

    const subscriptionTitle = normalizeTitleKey(subscription?.titleKey || subscription?.title || subscription?.titleQuery);
    const taskTitle = normalizeTitleKey(task?.title);
    return Boolean(subscriptionTitle && taskTitle && subscriptionTitle === taskTitle);
};
const buildChapterNotificationKey = (subscription = {}, task = {}, chapterNumber = '') => {
    const chapter = normalizeString(chapterNumber);
    if (!chapter) {
        return null;
    }

    const titleUuid = normalizeString(subscription?.titleUuid) || normalizeString(task?.titleUuid);
    if (titleUuid) {
        return `uuid:${titleUuid}:${chapter}`;
    }

    const sourceUrl = normalizeUrlForCompare(subscription?.sourceUrl || task?.sourceUrl);
    if (sourceUrl) {
        return `source:${sourceUrl}:${chapter}`;
    }

    const titleKey = normalizeTitleKey(subscription?.titleKey || subscription?.title || subscription?.titleQuery || task?.title);
    if (titleKey) {
        return `title:${titleKey}:${chapter}`;
    }

    return null;
};
const resolveTaskTimestampValue = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return 0;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};
const resolveTaskTimestamp = (task = {}) =>
    normalizeString(task?.completedAt)
    || normalizeString(task?.lastUpdated)
    || normalizeString(task?.startedAt)
    || normalizeString(task?.queuedAt)
    || null;
const parseChapterNumber = (value) => {
    const normalized = normalizeString(value).toLowerCase().replace(/^chapter\s+/i, '');
    if (!normalized) {
        return Number.POSITIVE_INFINITY;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};
const compareChapterEvents = (left = {}, right = {}) => {
    const leftTimestamp = Number(left.taskTimestamp) || 0;
    const rightTimestamp = Number(right.taskTimestamp) || 0;
    if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
    }

    const leftNumber = parseChapterNumber(left.chapterNumber);
    const rightNumber = parseChapterNumber(right.chapterNumber);
    if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }

    return normalizeString(left.chapterNumber).localeCompare(normalizeString(right.chapterNumber));
};
const collectPendingChapterEvents = ({
                                         subscription = {},
                                         activeDownloads = [],
                                         downloadHistory = [],
                                         sentChapterKeys = new Set(),
                                     } = {}) => {
    const tasks = [
        ...(Array.isArray(activeDownloads) ? activeDownloads : []),
        ...(Array.isArray(downloadHistory) ? downloadHistory : []),
    ];
    const byChapterKey = new Map();

    for (const task of tasks) {
        if (!taskMatchesSubscription(subscription, task)) {
            continue;
        }

        const chapterNumbers = normalizeChapterNumbers(task?.completedChapterNumbers);
        if (!chapterNumbers.length) {
            continue;
        }

        const taskTimestamp = resolveTaskTimestampValue(resolveTaskTimestamp(task));
        for (const chapterNumber of chapterNumbers) {
            const chapterKey = buildChapterNotificationKey(subscription, task, chapterNumber);
            if (!chapterKey || sentChapterKeys.has(chapterKey) || byChapterKey.has(chapterKey)) {
                continue;
            }

            byChapterKey.set(chapterKey, {
                chapterKey,
                chapterNumber,
                task,
                taskTimestamp,
            });
        }
    }

    return Array.from(byChapterKey.values()).sort(compareChapterEvents);
};
const formatChapterLabel = (chapterNumber = '') => {
    const normalized = normalizeString(chapterNumber);
    if (!normalized) {
        return 'a new chapter';
    }

    return /^chapter\b/i.test(normalized) ? normalized : `Chapter ${normalized}`;
};

const sendDirectMessage = async ({discordClient, userId, content}) => {
    if (typeof discordClient?.sendDirectMessage === 'function') {
        return await discordClient.sendDirectMessage(userId, {content});
    }

    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        throw new Error('Discord user id is required to send a direct message.');
    }

    if (typeof discordClient?.client?.users?.fetch !== 'function') {
        throw new Error('Discord user client is not available.');
    }

    const user = await discordClient.client.users.fetch(normalizedUserId);
    if (!user || typeof user.send !== 'function') {
        throw new Error('Discord user could not receive direct messages.');
    }

    return await user.send({content});
};

/**
 * Creates subscription notifier.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createSubscriptionNotifier = ({
                                               discordClient,
                                               vaultClient,
                                               ravenClient,
                                               collection = DEFAULT_SUBSCRIPTIONS_COLLECTION,
                                               pollMs = DEFAULT_POLL_MS,
                                               logger = {},
                                           } = {}) => {
    let intervalId = null;
    let running = false;
    let refreshPromise = null;

    const persistSubscriptionUpdate = async (entry, update) => {
        if (typeof vaultClient?.updateSubscription !== 'function') {
            return false;
        }

        const queries = buildSubscriptionDocumentQueries(entry);
        for (const query of queries) {
            try {
                const result = await vaultClient.updateSubscription({
                    collection,
                    query,
                    update,
                    upsert: false,
                });
                const matched = Number(result?.matched ?? result?.matchedCount ?? 0);
                const modified = Number(result?.modified ?? result?.modifiedCount ?? 0);
                if (matched > 0 || modified > 0) {
                    return true;
                }
            } catch (error) {
                logger.warn?.(`[Portal/Discord] Failed to persist subscription update: ${error.message}`);
            }
        }

        return false;
    };

    const notifySubscription = async ({
                                          entry,
                                          activeDownloads,
                                          downloadHistory,
                                      } = {}) => {
        if (!isActiveSubscription(entry?.status)) {
            return;
        }

        const discordUserId = normalizeString(entry?.subscriber?.discordId);
        if (!discordUserId) {
            return;
        }

        const existingNotifications = entry?.notifications && typeof entry.notifications === 'object'
            ? entry.notifications
            : {};
        const sentChapterKeys = new Set(
            trimStoredChapterKeys(Array.isArray(existingNotifications.sentChapterKeys) ? existingNotifications.sentChapterKeys : []),
        );
        const pendingChapterEvents = collectPendingChapterEvents({
            subscription: entry,
            activeDownloads,
            downloadHistory,
            sentChapterKeys,
        });
        if (!pendingChapterEvents.length) {
            return;
        }

        let sentCount = 0;
        let lastSentAt = null;
        for (const event of pendingChapterEvents) {
            const title = recommendationTitle(entry) || normalizeString(event?.task?.title) || 'your subscribed title';
            const chapterLabel = formatChapterLabel(event?.chapterNumber);
            const sourceUrl = normalizeUrlForCompare(entry?.sourceUrl || event?.task?.sourceUrl);
            const lines = [
                `New chapter downloaded for **${title}**: ${chapterLabel}.`,
            ];
            if (sourceUrl) {
                lines.push(`Source: ${sourceUrl}`);
            }

            try {
                await sendDirectMessage({
                    discordClient,
                    userId: discordUserId,
                    content: lines.join('\n'),
                });

                sentChapterKeys.add(event.chapterKey);
                sentCount += 1;
                lastSentAt = new Date().toISOString();
            } catch (error) {
                logger.warn?.(`[Portal/Discord] Failed to send subscription chapter DM: ${error.message}`);
            }
        }

        if (sentCount === 0) {
            return;
        }

        const nextNotifications = {
            ...existingNotifications,
            chapterDmCount: (Number(existingNotifications.chapterDmCount) || 0) + sentCount,
            lastChapterDmAt: lastSentAt,
            sentChapterKeys: trimStoredChapterKeys(Array.from(sentChapterKeys)),
        };
        const persisted = await persistSubscriptionUpdate(entry, {
            $set: {
                notifications: nextNotifications,
            },
        });
        if (persisted) {
            entry.notifications = nextNotifications;
        }
    };

    const refresh = async () => {
        if (!running) {
            return;
        }

        if (refreshPromise) {
            await refreshPromise;
            return;
        }

        refreshPromise = (async () => {
            if (typeof vaultClient?.findSubscriptions !== 'function') {
                return;
            }

            const subscriptions = await vaultClient.findSubscriptions({
                collection,
                query: {
                    status: 'active',
                },
            }).catch((error) => {
                logger.warn?.(`[Portal/Discord] Failed to load subscriptions for chapter notifications: ${error.message}`);
                return [];
            });
            if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
                return;
            }

            const activeDownloads =
                typeof ravenClient?.getDownloadStatus === 'function'
                    ? await ravenClient.getDownloadStatus().catch((error) => {
                        logger.warn?.(`[Portal/Discord] Failed to load Raven active downloads for subscription notifications: ${error.message}`);
                        return [];
                    })
                    : [];
            const downloadHistory =
                typeof ravenClient?.getDownloadHistory === 'function'
                    ? await ravenClient.getDownloadHistory().catch((error) => {
                        logger.warn?.(`[Portal/Discord] Failed to load Raven download history for subscription notifications: ${error.message}`);
                        return [];
                    })
                    : [];

            for (const subscription of subscriptions) {
                if (!subscription || typeof subscription !== 'object') {
                    continue;
                }

                await notifySubscription({
                    entry: subscription,
                    activeDownloads,
                    downloadHistory,
                });
            }
        })();

        try {
            await refreshPromise;
        } finally {
            refreshPromise = null;
        }
    };

    return {
        start() {
            if (running) {
                return;
            }

            running = true;
            void refresh();
            intervalId = setInterval(() => {
                void refresh();
            }, Math.max(5000, Number(pollMs) || DEFAULT_POLL_MS));
            intervalId?.unref?.();
        },
        stop() {
            running = false;
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        },
        refresh,
    };
};

export default createSubscriptionNotifier;
