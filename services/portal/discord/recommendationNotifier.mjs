/**
 * @fileoverview Polls Raven and Vault state to deliver recommendation DMs and timeline updates.
 * Related files:
 * - clients/ravenClient.mjs
 * - clients/vaultClient.mjs
 * - tests/recommendationNotifier.test.mjs
 * - app/ravenTitleVolumeMap.mjs
 * Times this file has been edited: 8
 */

import {applyRavenTitleVolumeMap} from '../app/ravenTitleVolumeMap.mjs';

const DEFAULT_RECOMMENDATION_COLLECTION = 'portal_recommendations';
const DEFAULT_POLL_MS = 30000;
const APPROVED_STATUSES = new Set(['approved', 'accepted']);
const MOON_SERVICE_NAMES = new Set(['noona-moon', 'moon']);
const DEFAULT_MOON_RECOMMENDATION_PATH_PREFIX = '/myrecommendations/';
const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'downloading', 'recovering']);
const COMPLETED_DOWNLOAD_STATUSES = new Set(['completed']);
const DOWNLOAD_STARTED_TIMELINE_TYPE = 'download-started';
const DOWNLOAD_PROGRESS_TIMELINE_TYPE = 'download-progress';
const DOWNLOAD_COMPLETED_TIMELINE_TYPE = 'download-completed';
const DOWNLOAD_PROGRESS_CHAPTER_INTERVAL = 3;

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
    const libraryId = normalizeSeriesInteger(series?.libraryId);
    const seriesId = normalizeSeriesInteger(series?.seriesId);
    const normalizedBase = normalizeString(baseUrl);
    if (normalizedBase && libraryId != null && seriesId != null) {
        try {
            return new URL(`/library/${libraryId}/series/${seriesId}`, normalizedBase).toString();
        } catch {
            // Fall back to the provided URL below.
        }
    }

    const normalizedFallback = normalizeString(fallbackUrl);
    return normalizedFallback || null;
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
const normalizeTimelineTimestamp = value => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    if (/^\d+$/.test(normalized)) {
        const parsedNumeric = new Date(Number(normalized));
        return Number.isNaN(parsedNumeric.getTime()) ? null : parsedNumeric.toISOString();
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const resolveTimelineTimestampValue = value => {
    const timestamp = normalizeTimelineTimestamp(value);
    if (!timestamp) {
        return 0;
    }

    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeTimelineType = (event = {}) =>
    normalizeString(event?.type || event?.event).toLowerCase();
const hasTimelineEventId = (entry = {}, id = '') => {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
        return false;
    }

    return recommendationTimelineEvents(entry).some(event => normalizeString(event?.id) === normalizedId);
};
const hasTimelineEventType = (entry = {}, type = '') =>
    recommendationTimelineEvents(entry).some(event => normalizeTimelineType(event) === type);
const createTimelineEventId = (type = 'event') =>
    `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10) || 'timeline'}`;
const createSystemTimelineEvent = ({id, type, body, createdAt, username = 'Raven'} = {}) => ({
    id: normalizeString(id) || createTimelineEventId(type),
    type,
    createdAt: normalizeTimelineTimestamp(createdAt) || new Date().toISOString(),
    actor: {
        role: 'system',
        username: normalizeString(username) || 'Raven',
        discordId: null,
        tag: null,
    },
    body: normalizeString(body) || null,
});
const sortTimelineEvents = (events = []) =>
    [...events].sort(
        (left, right) =>
            resolveTimelineTimestampValue(left?.createdAt || left?.at)
            - resolveTimelineTimestampValue(right?.createdAt || right?.at),
    );
const normalizeDownloadStatus = (task = {}) => normalizeString(task?.status).toLowerCase();
const normalizeStringArray = value =>
    Array.isArray(value)
        ? value.map(entry => normalizeString(entry)).filter(Boolean)
        : [];
const normalizePositiveInteger = value => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const normalizeMetadataIdentifier = value => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    const normalized = normalizeString(value);
    return normalized || null;
};
const normalizeRecommendationMetadataStatus = value => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'applied' || normalized === 'failed') {
        return normalized;
    }

    return 'pending';
};
const normalizeRecommendationMetadataAdultContent = value => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value === 1) {
            return true;
        }
        if (value === 0) {
            return false;
        }
    }

    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
        return true;
    }

    if (normalized === 'false' || normalized === 'no' || normalized === 'n' || normalized === '0') {
        return false;
    }

    return null;
};
const normalizeRecommendationMetadataSelection = entry => {
    const source = entry?.metadataSelection;
    if (!source || typeof source !== 'object') {
        return null;
    }

    const aliases = normalizeStringArray(source?.aliases);
    const selection = {
        status: normalizeRecommendationMetadataStatus(source?.status),
        query: normalizeString(source?.query) || null,
        title: normalizeString(source?.title) || null,
        aliases,
        provider: normalizeString(source?.provider) || null,
        providerSeriesId: normalizeMetadataIdentifier(source?.providerSeriesId),
        aniListId: normalizeMetadataIdentifier(source?.aniListId),
        malId: normalizeMetadataIdentifier(source?.malId),
        cbrId: normalizeMetadataIdentifier(source?.cbrId),
        summary: normalizeString(source?.summary) || null,
        sourceUrl: normalizeAbsoluteUrl(source?.sourceUrl),
        coverImageUrl: normalizeAbsoluteUrl(source?.coverImageUrl),
        adultContent: normalizeRecommendationMetadataAdultContent(
            source?.adultContent ?? source?.adult_content ?? source?.['Adult Content'],
        ),
        selectedAt: normalizeTimelineTimestamp(source?.selectedAt),
        selectedBy: source?.selectedBy && typeof source.selectedBy === 'object'
            ? {
                username: normalizeString(source.selectedBy?.username) || null,
                discordId: normalizeString(source.selectedBy?.discordId) || null,
            }
            : null,
        queuedAt: normalizeTimelineTimestamp(source?.queuedAt),
        titleUuid: normalizeString(source?.titleUuid) || null,
        appliedAt: normalizeTimelineTimestamp(source?.appliedAt),
        appliedSeriesId: normalizeSeriesInteger(source?.appliedSeriesId),
        appliedLibraryId: normalizeSeriesInteger(source?.appliedLibraryId),
        appliedTitle: normalizeString(source?.appliedTitle) || null,
        lastAttemptedAt: normalizeTimelineTimestamp(source?.lastAttemptedAt),
        lastError: normalizeString(source?.lastError) || null,
    };

    const hasUsefulData = Boolean(
        selection.query
        || selection.title
        || aliases.length > 0
        || selection.provider
        || selection.providerSeriesId
        || selection.aniListId
        || selection.malId
        || selection.cbrId
        || selection.summary
        || selection.sourceUrl
        || selection.coverImageUrl
        || selection.adultContent != null,
    );

    return hasUsefulData ? selection : null;
};
const recommendationMetadataHasIdentifiers = selection => Boolean(
    (
        normalizeString(selection?.provider)
        && normalizeMetadataIdentifier(selection?.providerSeriesId)
    )
    || normalizeMetadataIdentifier(selection?.aniListId)
    || normalizeMetadataIdentifier(selection?.malId)
    || normalizeMetadataIdentifier(selection?.cbrId),
);
const resolveDownloadTaskTimestamp = (task = {}) =>
    normalizeTimelineTimestamp(task?.completedAt)
    || normalizeTimelineTimestamp(task?.startedAt)
    || normalizeTimelineTimestamp(task?.lastUpdated)
    || normalizeTimelineTimestamp(task?.queuedAt);
const resolveDownloadTaskTotalChapters = (task = {}) =>
    normalizePositiveInteger(task?.totalChapters)
    || normalizePositiveInteger(normalizeStringArray(task?.queuedChapterNumbers).length)
    || normalizePositiveInteger(normalizeStringArray(task?.newChapterNumbers).length)
    || normalizePositiveInteger(task?.sourceChapterCount)
    || normalizePositiveInteger(task?.completedChapters);
const resolveDownloadTaskCompletedChapters = (task = {}) =>
    normalizePositiveInteger(task?.completedChapters)
    || normalizePositiveInteger(normalizeStringArray(task?.completedChapterNumbers).length);
const resolveDownloadTaskCurrentChapter = (task = {}) =>
    normalizeString(task?.currentChapter)
    || normalizeString(task?.currentChapterNumber);
const buildDownloadStartedBody = (task = {}) => {
    const status = normalizeDownloadStatus(task);
    const totalChapters = resolveDownloadTaskTotalChapters(task);
    const currentChapter = resolveDownloadTaskCurrentChapter(task);
    const latestChapter = normalizeString(task?.latestChapter);
    const message = normalizeString(task?.message);
    const parts = [
        status === 'queued'
            ? totalChapters
                ? `Raven queued ${totalChapters} chapters for download.`
                : 'Raven queued the requested chapters for download.'
            : totalChapters
                ? `Raven started downloading ${totalChapters} chapters.`
                : 'Raven started downloading the requested chapters.',
    ];

    if (currentChapter) {
        parts.push(`Current chapter: ${currentChapter}.`);
    } else if (latestChapter) {
        parts.push(`Latest chapter: ${latestChapter}.`);
    }

    if (status === 'recovering') {
        parts.push('The task was recovered and resumed from cache.');
    }

    if (message) {
        parts.push(message.endsWith('.') ? message : `${message}.`);
    }

    return parts.join(' ');
};
const buildDownloadCompletedBody = (task = {}) => {
    const totalChapters = resolveDownloadTaskTotalChapters(task);
    const completedChapters = resolveDownloadTaskCompletedChapters(task) || totalChapters;
    const latestChapter = normalizeString(task?.latestChapter);
    const message = normalizeString(task?.message);
    const parts = [
        completedChapters && totalChapters
            ? completedChapters === totalChapters
                ? `Raven finished downloading ${completedChapters} chapters.`
                : `Raven finished downloading ${completedChapters} of ${totalChapters} tracked chapters.`
            : completedChapters
                ? `Raven finished downloading ${completedChapters} chapters.`
                : 'Raven finished downloading the requested chapters.',
    ];

    if (latestChapter) {
        parts.push(`Latest chapter: ${latestChapter}.`);
    }

    if (message) {
        parts.push(message.endsWith('.') ? message : `${message}.`);
    }

    return parts.join(' ');
};
const resolveDownloadProgressMilestone = (task = {}, interval = DOWNLOAD_PROGRESS_CHAPTER_INTERVAL) => {
    const normalizedInterval = Number.isInteger(interval) && interval > 0
        ? interval
        : DOWNLOAD_PROGRESS_CHAPTER_INTERVAL;
    const completedChapters = resolveDownloadTaskCompletedChapters(task);
    if (!completedChapters || completedChapters < normalizedInterval) {
        return null;
    }

    const totalChapters = resolveDownloadTaskTotalChapters(task);
    if (totalChapters && completedChapters >= totalChapters) {
        return null;
    }

    const milestone = Math.floor(completedChapters / normalizedInterval) * normalizedInterval;
    if (!milestone || milestone < normalizedInterval) {
        return null;
    }

    return {
        milestone,
        totalChapters,
    };
};
const buildDownloadProgressEventId = ({milestone, totalChapters} = {}) =>
    `${DOWNLOAD_PROGRESS_TIMELINE_TYPE}:${String(milestone || 0)}:${String(totalChapters || 'unknown')}`;
const buildDownloadProgressBody = ({task, milestone, totalChapters} = {}) => {
    const normalizedMilestone = normalizePositiveInteger(milestone);
    if (!normalizedMilestone) {
        return null;
    }

    const currentChapter = resolveDownloadTaskCurrentChapter(task);
    const latestChapter = normalizeString(task?.latestChapter);
    const message = normalizeString(task?.message);
    const parts = [
        totalChapters
            ? `Raven downloaded ${normalizedMilestone} of ${totalChapters} chapters so far.`
            : `Raven downloaded ${normalizedMilestone} chapters so far.`,
    ];

    if (currentChapter) {
        parts.push(`Current chapter: ${currentChapter}.`);
    } else if (latestChapter) {
        parts.push(`Latest chapter: ${latestChapter}.`);
    }

    if (message) {
        parts.push(message.endsWith('.') ? message : `${message}.`);
    }

    return parts.join(' ');
};
const recommendationMatchesDownloadTask = (entry = {}, task = {}) => {
    if (!task || typeof task !== 'object') {
        return false;
    }

    const recommendationHref = normalizeUrlForCompare(entry?.href);
    const taskSourceUrl = normalizeUrlForCompare(task?.sourceUrl);
    const hrefMatch = Boolean(recommendationHref && taskSourceUrl && recommendationHref === taskSourceUrl);

    const recommendationTitleKey = normalizeTitleKey(entry?.title || entry?.query);
    const taskTitleKey = normalizeTitleKey(task?.title);
    const titleMatch = Boolean(recommendationTitleKey && taskTitleKey && recommendationTitleKey === taskTitleKey);

    if (!hrefMatch && !titleMatch) {
        return false;
    }

    const approvedAt = resolveTimelineTimestampValue(entry?.approvedAt);
    const taskTimestamp = resolveTimelineTimestampValue(resolveDownloadTaskTimestamp(task));
    if (approvedAt > 0 && taskTimestamp > 0 && taskTimestamp + (5 * 60 * 1000) < approvedAt) {
        return false;
    }

    return true;
};
const selectMatchingDownloadTask = (entry = {}, tasks = [], acceptedStatuses = null) =>
    (Array.isArray(tasks) ? tasks : [])
        .filter(task => recommendationMatchesDownloadTask(entry, task))
        .filter(task => !acceptedStatuses || acceptedStatuses.has(normalizeDownloadStatus(task)))
        .sort(
            (left, right) =>
                resolveTimelineTimestampValue(resolveDownloadTaskTimestamp(right))
                - resolveTimelineTimestampValue(resolveDownloadTaskTimestamp(left)),
        )[0] ?? null;

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
                                         kavitaBaseUrl,
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
            baseUrl: kavitaBaseUrl || (typeof kavitaClient.getBaseUrl === 'function' ? kavitaClient.getBaseUrl() : null),
            series: selectedSeries,
            fallbackUrl: selectedSeries?.url,
        });
    } catch (error) {
        logger.warn?.(`[Portal/Discord] Failed to resolve Kavita link for "${normalizedTitle}": ${error.message}`);
        return null;
    }
};

/**
 * Creates recommendation notifier.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createRecommendationNotifier = ({
                                                 discordClient,
                                                 vaultClient,
                                                 ravenClient,
                                                 kavitaClient,
                                                 komfClient,
                                                 wardenClient,
                                                 moonBaseUrl,
                                                 kavitaBaseUrl,
                                                 collection = DEFAULT_RECOMMENDATION_COLLECTION,
                                                 pollMs = DEFAULT_POLL_MS,
                                                 logger = {},
                                             } = {}) => {
    let intervalId = null;
    let running = false;
    let refreshPromise = null;
    const inFlightNotifications = new Set();
    const configuredMoonBaseUrl = normalizeAbsoluteBaseUrl(moonBaseUrl);
    const configuredKavitaBaseUrl = normalizeAbsoluteBaseUrl(kavitaBaseUrl);
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
    const persistMetadataSelectionUpdate = async ({entry, metadataSelection, timelineEvent = null} = {}) => {
        const normalizedSelection = metadataSelection && typeof metadataSelection === 'object'
            ? metadataSelection
            : null;
        if (!normalizedSelection) {
            return false;
        }

        const nextTimeline = timelineEvent
            ? sortTimelineEvents([
                ...recommendationTimelineEvents(entry),
                timelineEvent,
            ])
            : null;
        const update = {
            $set: {
                metadataSelection: normalizedSelection,
            },
        };
        if (nextTimeline) {
            update.$set.timeline = nextTimeline;
        }

        const persisted = await persistRecommendationUpdate(entry, update);
        if (persisted) {
            entry.metadataSelection = normalizedSelection;
            if (nextTimeline) {
                entry.timeline = nextTimeline;
            }
        }

        return persisted;
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
    const syncRecommendationDownloadTimeline = async ({
                                                          entry,
                                                          activeDownloads,
                                                          downloadHistory,
                                                      } = {}) => {
        if (!isApprovedStatus(entry?.status)) {
            return;
        }

        const hasStartedEvent = hasTimelineEventType(entry, DOWNLOAD_STARTED_TIMELINE_TYPE);
        const hasCompletedEvent = hasTimelineEventType(entry, DOWNLOAD_COMPLETED_TIMELINE_TYPE);
        if (hasStartedEvent && hasCompletedEvent) {
            return;
        }

        const activeTask = selectMatchingDownloadTask(entry, activeDownloads, ACTIVE_DOWNLOAD_STATUSES);
        const completedTask =
            selectMatchingDownloadTask(entry, downloadHistory, COMPLETED_DOWNLOAD_STATUSES)
            || selectMatchingDownloadTask(entry, activeDownloads, COMPLETED_DOWNLOAD_STATUSES);

        const nextTimeline = recommendationTimelineEvents(entry);
        let changed = false;

        if (!hasStartedEvent) {
            const startedTask = activeTask || completedTask;
            if (startedTask) {
                nextTimeline.push(createSystemTimelineEvent({
                    type: DOWNLOAD_STARTED_TIMELINE_TYPE,
                    body: buildDownloadStartedBody(startedTask),
                    createdAt:
                        normalizeTimelineTimestamp(startedTask?.startedAt)
                        || normalizeTimelineTimestamp(startedTask?.queuedAt)
                        || normalizeTimelineTimestamp(startedTask?.lastUpdated),
                }));
                changed = true;
            }
        }

        if (!hasCompletedEvent && activeTask) {
            const progressMilestone = resolveDownloadProgressMilestone(activeTask);
            if (progressMilestone) {
                const progressEventId = buildDownloadProgressEventId(progressMilestone);
                const alreadyTracked =
                    hasTimelineEventId(entry, progressEventId)
                    || nextTimeline.some(event => normalizeString(event?.id) === progressEventId);

                if (!alreadyTracked) {
                    const progressBody = buildDownloadProgressBody({
                        task: activeTask,
                        milestone: progressMilestone.milestone,
                        totalChapters: progressMilestone.totalChapters,
                    });
                    if (progressBody) {
                        nextTimeline.push(createSystemTimelineEvent({
                            id: progressEventId,
                            type: DOWNLOAD_PROGRESS_TIMELINE_TYPE,
                            body: progressBody,
                            createdAt:
                                normalizeTimelineTimestamp(activeTask?.lastUpdated)
                                || normalizeTimelineTimestamp(activeTask?.startedAt)
                                || normalizeTimelineTimestamp(activeTask?.queuedAt),
                        }));
                        changed = true;
                    }
                }
            }
        }

        if (!hasCompletedEvent && completedTask) {
            nextTimeline.push(createSystemTimelineEvent({
                type: DOWNLOAD_COMPLETED_TIMELINE_TYPE,
                body: buildDownloadCompletedBody(completedTask),
                createdAt:
                    normalizeTimelineTimestamp(completedTask?.completedAt)
                    || normalizeTimelineTimestamp(completedTask?.lastUpdated)
                    || normalizeTimelineTimestamp(completedTask?.queuedAt),
            }));
            changed = true;
        }

        if (!changed) {
            return;
        }

        const sortedTimeline = sortTimelineEvents(nextTimeline);
        const persisted = await persistRecommendationUpdate(entry, {
            $set: {
                timeline: sortedTimeline,
            },
        });

        if (persisted) {
            entry.timeline = sortedTimeline;
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

        const hasCompletedDownload = hasTimelineEventType(entry, DOWNLOAD_COMPLETED_TIMELINE_TYPE);

        const existingTitle = resolveExistingLibraryTitle({
            library,
            selectedTitle: entry?.title,
            selectedHref: entry?.href,
        });
        if (!existingTitle && !hasCompletedDownload) {
            return;
        }

        const titleName = getLibraryTitleName(existingTitle) || recommendationTitle(entry);
        const kavitaUrl = await resolveKavitaTitleUrl({
            kavitaClient,
            titleName,
            kavitaBaseUrl: configuredKavitaBaseUrl,
            logger,
        });
        const moonRecommendationUrl = !kavitaUrl ? await buildMoonRecommendationUrl(entry) : null;

        const key = recommendationNotificationKey(entry, 'completed');
        if (inFlightNotifications.has(key)) {
            return;
        }

        inFlightNotifications.add(key);
        try {
            const messageLines = kavitaUrl
                ? [
                    `Your recommendation for **${titleName}** is now available in Kavita.`,
                    `Open in Kavita: ${kavitaUrl}`,
                ]
                : [
                    `Raven finished downloading your recommendation for **${titleName}**.`,
                    `Kavita may still be indexing it, so I do not have a direct link yet.`,
                ];
            if (moonRecommendationUrl) {
                messageLines.push(`Track it in Moon: ${moonRecommendationUrl}`);
            }
            const sentMessage = await sendDirectMessage({
                discordClient,
                userId: discordUserId,
                content: messageLines.join('\n'),
            });
            const sentAt = new Date().toISOString();
            const persisted = await persistRecommendationUpdate(entry, {
                $set: {
                    'notifications.completionDmSentAt': sentAt,
                    'notifications.completionDmMessageId': normalizeString(sentMessage?.id) || null,
                    'notifications.completionKavitaUrl': kavitaUrl || null,
                    'notifications.completionMoonUrl': moonRecommendationUrl || null,
                    completedAt: sentAt,
                },
            });

            if (persisted) {
                entry.notifications = {
                    ...(entry.notifications && typeof entry.notifications === 'object' ? entry.notifications : {}),
                    completionDmSentAt: sentAt,
                    completionDmMessageId: normalizeString(sentMessage?.id) || null,
                    completionKavitaUrl: kavitaUrl || null,
                    completionMoonUrl: moonRecommendationUrl || null,
                };
                entry.completedAt = sentAt;
            }
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to send recommendation completion DM: ${error.message}`);
        } finally {
            inFlightNotifications.delete(key);
        }
    };
    const applyDeferredRecommendationMetadata = async ({entry, existingTitle} = {}) => {
        if (!isApprovedStatus(entry?.status) || !existingTitle) {
            return;
        }

        const metadataSelection = normalizeRecommendationMetadataSelection(entry);
        if (!metadataSelection || metadataSelection.status === 'applied' || !recommendationMetadataHasIdentifiers(metadataSelection)) {
            return;
        }

        if (typeof kavitaClient?.searchTitles !== 'function') {
            return;
        }

        const titleName = getLibraryTitleName(existingTitle) || recommendationTitle(entry);
        if (!titleName) {
            return;
        }

        let searchPayload;
        try {
            searchPayload = await kavitaClient.searchTitles(titleName);
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to search Kavita titles for deferred recommendation metadata "${titleName}": ${error.message}`);
            return;
        }

        const selectedSeries = pickPreferredKavitaSeries(
            Array.isArray(searchPayload?.series) ? searchPayload.series : [],
            titleName,
        );
        const seriesId = normalizeSeriesInteger(selectedSeries?.seriesId);
        if (!seriesId) {
            return;
        }

        const libraryId = normalizeSeriesInteger(selectedSeries?.libraryId);
        const attemptedAt = new Date().toISOString();
        const titleUuid = metadataSelection.titleUuid || normalizeString(existingTitle?.uuid) || null;

        try {
            if (metadataSelection.provider && metadataSelection.providerSeriesId) {
                if (typeof komfClient?.identifySeriesMetadata !== 'function') {
                    return;
                }

                await komfClient.identifySeriesMetadata({
                    seriesId,
                    libraryId,
                    provider: metadataSelection.provider,
                    providerSeriesId: metadataSelection.providerSeriesId,
                });
            } else if (metadataSelection.aniListId || metadataSelection.malId || metadataSelection.cbrId) {
                if (typeof kavitaClient?.applySeriesMetadataMatch !== 'function') {
                    return;
                }

                await kavitaClient.applySeriesMetadataMatch({
                    seriesId,
                    aniListId: metadataSelection.aniListId,
                    malId: metadataSelection.malId,
                    cbrId: metadataSelection.cbrId,
                });
            } else {
                return;
            }

            let coverUrl = metadataSelection.coverImageUrl || normalizeAbsoluteUrl(existingTitle?.coverUrl);
            if (!normalizeAbsoluteUrl(existingTitle?.coverUrl) && metadataSelection.coverImageUrl && titleUuid && typeof ravenClient?.updateTitle === 'function') {
                try {
                    const updatedTitle = await ravenClient.updateTitle(titleUuid, {
                        coverUrl: metadataSelection.coverImageUrl,
                    });
                    coverUrl = normalizeAbsoluteUrl(updatedTitle?.coverUrl) || coverUrl;
                } catch (error) {
                    logger.warn?.(`[Portal/Discord] Failed to backfill recommendation cover art for ${titleUuid}: ${error.message}`);
                }
            }

            if (coverUrl && typeof kavitaClient?.setSeriesCover === 'function') {
                await kavitaClient.setSeriesCover({
                    seriesId,
                    url: coverUrl,
                    lockCover: true,
                });
            }

            let volumeMap = null;
            if (metadataSelection.provider && metadataSelection.providerSeriesId && titleUuid) {
                try {
                    volumeMap = await applyRavenTitleVolumeMap({
                        titleUuid,
                        provider: metadataSelection.provider,
                        providerSeriesId: metadataSelection.providerSeriesId,
                        libraryId,
                        autoRename: true,
                        komfClient,
                        ravenClient,
                    });
                } catch (error) {
                    logger.warn?.(`[Portal/Discord] Failed to store Raven volume map for "${titleName}": ${error.message}`);
                }
            }

            const providerLabel = normalizeString(metadataSelection.provider).toUpperCase();
            const providerDetail = providerLabel
                ? providerLabel
                : metadataSelection.aniListId
                    ? `AniList ${metadataSelection.aniListId}`
                    : metadataSelection.malId
                        ? `MyAnimeList ${metadataSelection.malId}`
                        : metadataSelection.cbrId
                            ? `ComicBookResources ${metadataSelection.cbrId}`
                            : 'saved metadata ids';
            const appliedSelection = {
                ...metadataSelection,
                status: 'applied',
                titleUuid,
                appliedAt: attemptedAt,
                appliedSeriesId: seriesId,
                appliedLibraryId: libraryId,
                appliedTitle:
                    normalizeString(selectedSeries?.name)
                    || normalizeString(selectedSeries?.localizedName)
                    || normalizeString(selectedSeries?.originalName)
                    || titleName,
                lastAttemptedAt: attemptedAt,
                lastError: null,
            };
            const volumeMapSuffix = volumeMap?.status === 'applied'
                ? (
                    (Number(volumeMap?.renameSummary?.renamed) || 0) > 0
                        ? ' Raven also stored the chapter-to-volume map and renamed existing files to the real volume numbers.'
                        : ' Raven also stored the chapter-to-volume map.'
                )
                : volumeMap?.status === 'no-op'
                    ? ' The matched provider did not expose usable chapter-to-volume coverage, so Raven kept fallback v01 file names.'
                    : '';
            const timelineEvent = createSystemTimelineEvent({
                type: 'comment',
                body: `Noona applied the saved metadata selection (${providerDetail}) to Kavita after Raven finished the import.${volumeMapSuffix}`,
                createdAt: attemptedAt,
                username: 'Portal',
            });
            await persistMetadataSelectionUpdate({
                entry,
                metadataSelection: appliedSelection,
                timelineEvent,
            });
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to apply deferred recommendation metadata for "${titleName}": ${error.message}`);
            await persistMetadataSelectionUpdate({
                entry,
                metadataSelection: {
                    ...metadataSelection,
                    status: 'pending',
                    titleUuid,
                    lastAttemptedAt: attemptedAt,
                    lastError: error instanceof Error ? error.message : String(error),
                },
            });
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

            const library =
                typeof ravenClient?.getLibrary === 'function'
                    ? await ravenClient.getLibrary().catch((error) => {
                        logger.warn?.(`[Portal/Discord] Failed to load Raven library for recommendation completion checks: ${error.message}`);
                        return [];
                    })
                    : [];
            const activeDownloads =
                typeof ravenClient?.getDownloadStatus === 'function'
                    ? await ravenClient.getDownloadStatus().catch((error) => {
                        logger.warn?.(`[Portal/Discord] Failed to load Raven download status for recommendation timeline checks: ${error.message}`);
                        return [];
                    })
                    : [];
            const downloadHistory =
                typeof ravenClient?.getDownloadHistory === 'function'
                    ? await ravenClient.getDownloadHistory().catch((error) => {
                        logger.warn?.(`[Portal/Discord] Failed to load Raven download history for recommendation timeline checks: ${error.message}`);
                        return [];
                    })
                    : [];

            for (const recommendation of recommendations) {
                if (!recommendation || typeof recommendation !== 'object') {
                    continue;
                }

                const existingTitle = resolveExistingLibraryTitle({
                    library: Array.isArray(library) ? library : [],
                    selectedTitle: recommendation?.title,
                    selectedHref: recommendation?.href,
                });

                await notifyApprovedRecommendation(recommendation);
                await notifyAdminCommentEvents(recommendation);
                await syncRecommendationDownloadTimeline({
                    entry: recommendation,
                    activeDownloads,
                    downloadHistory,
                });
                await applyDeferredRecommendationMetadata({
                    entry: recommendation,
                    existingTitle,
                });
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
