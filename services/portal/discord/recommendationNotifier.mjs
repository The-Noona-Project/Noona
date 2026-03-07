const DEFAULT_RECOMMENDATION_COLLECTION = 'portal_recommendations';
const DEFAULT_POLL_MS = 30000;
const APPROVED_STATUSES = new Set(['approved', 'accepted']);
const MOON_SERVICE_NAMES = new Set(['noona-moon', 'moon']);
const DEFAULT_MOON_RECOMMENDATION_PATH_PREFIX = '/myrecommendations/';

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeTitleKey = value => normalizeString(value).toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeSeriesInteger = value => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
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
const normalizeAbsoluteUrl = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized).toString();
    } catch {
        return null;
    }
};
const normalizeAbsoluteBaseUrl = value => {
    const normalized = normalizeAbsoluteUrl(value);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        return `${parsed.protocol}//${parsed.host}/`;
    } catch {
        return null;
    }
};
const extractWardenServiceList = payload => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.services)) {
        return payload.services;
    }

    return [];
};
const resolveMoonBaseUrlFromWardenPayload = payload => {
    const services = extractWardenServiceList(payload);
    for (const service of services) {
        const serviceName = normalizeString(service?.name).toLowerCase();
        if (!MOON_SERVICE_NAMES.has(serviceName)) {
            continue;
        }

        const candidates = [
            service?.hostServiceUrl,
            service?.host_service_url,
            service?.hostUrl,
            service?.host_url,
            service?.url,
        ];
        for (const candidate of candidates) {
            const baseUrl = normalizeAbsoluteBaseUrl(candidate);
            if (baseUrl) {
                return baseUrl;
            }
        }
    }

    return null;
};

const resolveRecommendationId = value => {
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

const recommendationTitle = (entry = {}) =>
    normalizeString(entry?.title) || normalizeString(entry?.query) || 'your recommendation';

const getLibraryTitleName = title =>
    normalizeString(title?.title ?? title?.titleName);

const pickPreferredKavitaSeries = (series = [], titleName = '') => {
    const titleKey = normalizeTitleKey(titleName);
    if (!titleKey) {
        return series[0] ?? null;
    }

    for (const entry of series) {
        const nameKey = normalizeTitleKey(entry?.name);
        if (nameKey && nameKey === titleKey) {
            return entry;
        }
    }

    for (const entry of series) {
        const localizedKey = normalizeTitleKey(entry?.localizedName);
        const originalKey = normalizeTitleKey(entry?.originalName);
        if (localizedKey === titleKey || originalKey === titleKey) {
            return entry;
        }
    }

    return series[0] ?? null;
};

const buildKavitaSeriesUrl = ({baseUrl, series, fallbackUrl} = {}) => {
    const normalizedFallback = normalizeString(fallbackUrl);
    if (normalizedFallback) {
        return normalizedFallback;
    }

    const libraryId = normalizeSeriesInteger(series?.libraryId);
    const seriesId = normalizeSeriesInteger(series?.seriesId);
    const normalizedBase = normalizeString(baseUrl);
    if (!normalizedBase || libraryId == null || seriesId == null) {
        return null;
    }

    try {
        return new URL(`/library/${libraryId}/series/${seriesId}`, normalizedBase).toString();
    } catch {
        return null;
    }
};

const resolveExistingLibraryTitle = ({
                                         library,
                                         selectedTitle,
                                         selectedHref,
                                     } = {}) => {
    if (!Array.isArray(library) || library.length === 0) {
        return null;
    }

    const selectedHrefKey = normalizeUrlForCompare(selectedHref);
    if (selectedHrefKey) {
        const sourceMatch = library.find(entry => normalizeUrlForCompare(entry?.sourceUrl) === selectedHrefKey);
        if (sourceMatch) {
            return sourceMatch;
        }
    }

    const selectedTitleKey = normalizeTitleKey(selectedTitle);
    if (!selectedTitleKey) {
        return null;
    }

    return library.find(entry => normalizeTitleKey(getLibraryTitleName(entry)) === selectedTitleKey) ?? null;
};

const buildRecommendationDocumentQueries = (entry = {}) => {
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

    if (entry && typeof entry === 'object' && '_id' in entry && entry._id != null) {
        pushQuery({_id: entry._id});
    }

    const fallbackQuery = {};
    const source = normalizeString(entry?.source);
    if (source) {
        fallbackQuery.source = source;
    }

    const status = normalizeString(entry?.status);
    if (status) {
        fallbackQuery.status = status;
    }

    const requestedAt = normalizeString(entry?.requestedAt);
    if (requestedAt) {
        fallbackQuery.requestedAt = requestedAt;
    }

    const query = normalizeString(entry?.query);
    if (query) {
        fallbackQuery.query = query;
    }

    const searchId = normalizeString(entry?.searchId);
    if (searchId) {
        fallbackQuery.searchId = searchId;
    }

    const selectedOptionIndexRaw = Number(entry?.selectedOptionIndex);
    if (Number.isFinite(selectedOptionIndexRaw)) {
        fallbackQuery.selectedOptionIndex = selectedOptionIndexRaw;
    }

    const title = normalizeString(entry?.title);
    if (title) {
        fallbackQuery.title = title;
    }

    const href = normalizeString(entry?.href);
    if (href) {
        fallbackQuery.href = href;
    }

    const requestedByDiscordId = normalizeString(entry?.requestedBy?.discordId);
    if (requestedByDiscordId) {
        fallbackQuery['requestedBy.discordId'] = requestedByDiscordId;
    }

    const requestedByTag = normalizeString(entry?.requestedBy?.tag);
    if (requestedByTag) {
        fallbackQuery['requestedBy.tag'] = requestedByTag;
    }

    const guildId = normalizeString(entry?.discordContext?.guildId);
    if (guildId) {
        fallbackQuery['discordContext.guildId'] = guildId;
    }

    const channelId = normalizeString(entry?.discordContext?.channelId);
    if (channelId) {
        fallbackQuery['discordContext.channelId'] = channelId;
    }

    pushQuery(fallbackQuery);
    return queries;
};

const numericCount = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const isApprovedStatus = value => APPROVED_STATUSES.has(normalizeString(value).toLowerCase());

const hasApprovalNotification = (entry = {}) =>
    Boolean(
        normalizeString(entry?.notifications?.approvalDmSentAt)
        || normalizeString(entry?.approvalDmSentAt),
    );

const hasCompletionNotification = (entry = {}) =>
    Boolean(
        normalizeString(entry?.notifications?.completionDmSentAt)
        || normalizeString(entry?.completionDmSentAt),
    );

const recommendationNotificationKey = (entry = {}, notificationType = '') => {
    const recommendationId = resolveRecommendationId(entry?._id);
    if (recommendationId) {
        return `${notificationType}:${recommendationId}`;
    }

    const title = normalizeString(entry?.title) || normalizeString(entry?.query);
    const requestedAt = normalizeString(entry?.requestedAt);
    return `${notificationType}:${title}:${requestedAt}`;
};
const recommendationTimelineEvents = (entry = {}) =>
    Array.isArray(entry?.timeline) ? entry.timeline.filter(event => event && typeof event === 'object') : [];
const recommendationTimelineEventIdentity = (event = {}) =>
    normalizeString(event?.id)
    || [
        normalizeString(event?.type || event?.event),
        normalizeString(event?.createdAt || event?.at),
        normalizeString(event?.body || event?.comment || event?.message),
        normalizeString(event?.actor?.role),
    ].join(':');
const timelineCommentBody = (event = {}) =>
    normalizeString(event?.body) || normalizeString(event?.comment) || normalizeString(event?.message);
const isAdminCommentTimelineEvent = (event = {}) =>
    normalizeString(event?.type || event?.event).toLowerCase() === 'comment'
    && normalizeString(event?.actor?.role).toLowerCase() === 'admin'
    && Boolean(timelineCommentBody(event));
const hasAdminCommentNotification = (event = {}) =>
    Boolean(
        normalizeString(event?.notifications?.adminCommentDmSentAt)
        || normalizeString(event?.adminCommentDmSentAt),
    );

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

const resolveKavitaTitleUrl = async ({
                                         kavitaClient,
                                         titleName,
                                         logger = {},
                                     } = {}) => {
    const normalizedTitle = normalizeString(titleName);
    if (!normalizedTitle || typeof kavitaClient?.searchTitles !== 'function') {
        return null;
    }

    try {
        const payload = await kavitaClient.searchTitles(normalizedTitle);
        const series = Array.isArray(payload?.series) ? payload.series : [];
        if (!series.length) {
            return null;
        }

        const selectedSeries = pickPreferredKavitaSeries(series, normalizedTitle);
        if (!selectedSeries) {
            return null;
        }

        return buildKavitaSeriesUrl({
            baseUrl: typeof kavitaClient.getBaseUrl === 'function' ? kavitaClient.getBaseUrl() : null,
            series: selectedSeries,
            fallbackUrl: selectedSeries?.url,
        });
    } catch (error) {
        logger.warn?.(`[Portal/Discord] Failed to resolve Kavita link for "${normalizedTitle}": ${error.message}`);
        return null;
    }
};

export const createRecommendationNotifier = ({
                                                 discordClient,
                                                 vaultClient,
                                                 ravenClient,
                                                 kavitaClient,
                                                 wardenClient,
                                                 moonBaseUrl,
                                                 collection = DEFAULT_RECOMMENDATION_COLLECTION,
                                                 pollMs = DEFAULT_POLL_MS,
                                                 logger = {},
                                             } = {}) => {
    let intervalId = null;
    let running = false;
    let refreshPromise = null;
    const inFlightNotifications = new Set();
    const configuredMoonBaseUrl = normalizeAbsoluteBaseUrl(moonBaseUrl);
    let cachedMoonBaseUrl = configuredMoonBaseUrl;

    const persistRecommendationUpdate = async (entry, update) => {
        if (typeof vaultClient?.updateRecommendation !== 'function') {
            return false;
        }

        const queries = buildRecommendationDocumentQueries(entry);
        for (const query of queries) {
            try {
                const result = await vaultClient.updateRecommendation({
                    collection,
                    query,
                    update,
                    upsert: false,
                });
                const matched = numericCount(result?.matched ?? result?.matchedCount);
                const modified = numericCount(result?.modified ?? result?.modifiedCount);
                if (matched > 0 || modified > 0) {
                    return true;
                }
            } catch (error) {
                logger.warn?.(`[Portal/Discord] Failed to persist recommendation notification update: ${error.message}`);
            }
        }

        return false;
    };
    const resolveMoonBaseUrl = async () => {
        if (cachedMoonBaseUrl) {
            return cachedMoonBaseUrl;
        }

        if (typeof wardenClient?.listServices !== 'function') {
            return null;
        }

        const servicesPayload = await wardenClient.listServices({includeInstalled: true}).catch((error) => {
            logger.warn?.(`[Portal/Discord] Failed to resolve Moon URL from Warden: ${error.message}`);
            return null;
        });
        const resolvedBaseUrl = resolveMoonBaseUrlFromWardenPayload(servicesPayload);
        if (resolvedBaseUrl) {
            cachedMoonBaseUrl = resolvedBaseUrl;
        }

        return resolvedBaseUrl;
    };
    const buildMoonRecommendationUrl = async (entry = {}) => {
        const recommendationId = resolveRecommendationId(entry?._id);
        if (!recommendationId) {
            return null;
        }

        const moonUrl = await resolveMoonBaseUrl();
        if (!moonUrl) {
            return null;
        }

        try {
            return new URL(`${DEFAULT_MOON_RECOMMENDATION_PATH_PREFIX}${encodeURIComponent(recommendationId)}`, moonUrl).toString();
        } catch {
            return null;
        }
    };

    const notifyApprovedRecommendation = async (entry = {}) => {
        if (!isApprovedStatus(entry?.status) || hasApprovalNotification(entry)) {
            return;
        }

        const discordUserId = normalizeString(entry?.requestedBy?.discordId);
        if (!discordUserId) {
            return;
        }

        const key = recommendationNotificationKey(entry, 'approved');
        if (inFlightNotifications.has(key)) {
            return;
        }

        inFlightNotifications.add(key);
        try {
            const title = recommendationTitle(entry);
            const approverName = normalizeString(entry?.approvedBy?.username) || 'an admin';
            const message = `Your recommendation for **${title}** has been approved by **${approverName}**.`;
            const sentMessage = await sendDirectMessage({
                discordClient,
                userId: discordUserId,
                content: message,
            });
            const sentAt = new Date().toISOString();
            const persisted = await persistRecommendationUpdate(entry, {
                $set: {
                    'notifications.approvalDmSentAt': sentAt,
                    'notifications.approvalDmMessageId': normalizeString(sentMessage?.id) || null,
                },
            });

            if (persisted) {
                entry.notifications = {
                    ...(entry.notifications && typeof entry.notifications === 'object' ? entry.notifications : {}),
                    approvalDmSentAt: sentAt,
                    approvalDmMessageId: normalizeString(sentMessage?.id) || null,
                };
            }
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to send recommendation approval DM: ${error.message}`);
        } finally {
            inFlightNotifications.delete(key);
        }
    };
    const notifyAdminCommentEvents = async (entry = {}) => {
        const discordUserId = normalizeString(entry?.requestedBy?.discordId);
        if (!discordUserId) {
            return;
        }

        const timeline = recommendationTimelineEvents(entry);
        if (!timeline.length) {
            return;
        }

        for (let index = 0; index < timeline.length; index += 1) {
            const timelineEvent = timeline[index];
            if (!isAdminCommentTimelineEvent(timelineEvent) || hasAdminCommentNotification(timelineEvent)) {
                continue;
            }

            const commentIdentity = recommendationTimelineEventIdentity(timelineEvent);
            if (!commentIdentity) {
                continue;
            }

            const key = `${recommendationNotificationKey(entry, 'admin-comment')}:${commentIdentity}`;
            if (inFlightNotifications.has(key)) {
                continue;
            }

            inFlightNotifications.add(key);
            try {
                const title = recommendationTitle(entry);
                const commenterName =
                    normalizeString(timelineEvent?.actor?.username)
                    || normalizeString(timelineEvent?.actor?.tag)
                    || 'an admin';
                const commentBody = timelineCommentBody(timelineEvent);
                const moonRecommendationUrl = await buildMoonRecommendationUrl(entry);
                const lines = [
                    `You have a new admin comment on your recommendation for **${title}** from **${commenterName}**.`,
                    `Comment: ${commentBody}`,
                ];
                if (moonRecommendationUrl) {
                    lines.push(`Open in Moon: ${moonRecommendationUrl}`);
                }
                const sentMessage = await sendDirectMessage({
                    discordClient,
                    userId: discordUserId,
                    content: lines.join('\n'),
                });

                const sentAt = new Date().toISOString();
                const updatedTimeline = timeline.map((candidate, candidateIndex) => {
                    if (candidateIndex !== index) {
                        return candidate;
                    }

                    return {
                        ...candidate,
                        notifications: {
                            ...(candidate?.notifications && typeof candidate.notifications === 'object' ? candidate.notifications : {}),
                            adminCommentDmSentAt: sentAt,
                            adminCommentDmMessageId: normalizeString(sentMessage?.id) || null,
                            adminCommentMoonUrl: moonRecommendationUrl || null,
                        },
                    };
                });
                const persisted = await persistRecommendationUpdate(entry, {
                    $set: {
                        timeline: updatedTimeline,
                    },
                });

                if (persisted) {
                    entry.timeline = updatedTimeline;
                }
            } catch (error) {
                logger.warn?.(`[Portal/Discord] Failed to send recommendation admin-comment DM: ${error.message}`);
            } finally {
                inFlightNotifications.delete(key);
            }
        }
    };

    const notifyCompletedRecommendation = async ({entry, library} = {}) => {
        if (!isApprovedStatus(entry?.status) || hasCompletionNotification(entry)) {
            return;
        }

        const discordUserId = normalizeString(entry?.requestedBy?.discordId);
        if (!discordUserId) {
            return;
        }

        const existingTitle = resolveExistingLibraryTitle({
            library,
            selectedTitle: entry?.title,
            selectedHref: entry?.href,
        });
        if (!existingTitle) {
            return;
        }

        const titleName = getLibraryTitleName(existingTitle) || recommendationTitle(entry);
        const kavitaUrl = await resolveKavitaTitleUrl({
            kavitaClient,
            titleName,
            logger,
        });
        if (!kavitaUrl) {
            return;
        }

        const key = recommendationNotificationKey(entry, 'completed');
        if (inFlightNotifications.has(key)) {
            return;
        }

        inFlightNotifications.add(key);
        try {
            const message = [
                `Your recommendation for **${titleName}** is now available in Kavita.`,
                `Open in Kavita: ${kavitaUrl}`,
            ].join('\n');
            const sentMessage = await sendDirectMessage({
                discordClient,
                userId: discordUserId,
                content: message,
            });
            const sentAt = new Date().toISOString();
            const persisted = await persistRecommendationUpdate(entry, {
                $set: {
                    'notifications.completionDmSentAt': sentAt,
                    'notifications.completionDmMessageId': normalizeString(sentMessage?.id) || null,
                    'notifications.completionKavitaUrl': kavitaUrl,
                    completedAt: sentAt,
                },
            });

            if (persisted) {
                entry.notifications = {
                    ...(entry.notifications && typeof entry.notifications === 'object' ? entry.notifications : {}),
                    completionDmSentAt: sentAt,
                    completionDmMessageId: normalizeString(sentMessage?.id) || null,
                    completionKavitaUrl: kavitaUrl,
                };
                entry.completedAt = sentAt;
            }
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to send recommendation completion DM: ${error.message}`);
        } finally {
            inFlightNotifications.delete(key);
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
            if (typeof vaultClient?.findRecommendations !== 'function') {
                return;
            }

            const recommendations = await vaultClient.findRecommendations({
                collection,
                query: {},
            }).catch((error) => {
                logger.warn?.(`[Portal/Discord] Failed to load recommendations for notification polling: ${error.message}`);
                return [];
            });

            if (!Array.isArray(recommendations) || recommendations.length === 0) {
                return;
            }

            const library = await ravenClient?.getLibrary?.().catch((error) => {
                logger.warn?.(`[Portal/Discord] Failed to load Raven library for recommendation completion checks: ${error.message}`);
                return [];
            });

            for (const recommendation of recommendations) {
                if (!recommendation || typeof recommendation !== 'object') {
                    continue;
                }

                await notifyApprovedRecommendation(recommendation);
                await notifyAdminCommentEvents(recommendation);
                await notifyCompletedRecommendation({
                    entry: recommendation,
                    library: Array.isArray(library) ? library : [],
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

export default createRecommendationNotifier;
