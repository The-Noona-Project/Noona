export const NOONA_OPEN_MUSIC_CONTROLS_EVENT = "noona:open-music-controls";
export const LIVE_NOTIFICATION_SEEN_STATE_VERSION = 1;
export const LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX = "noona-site-notifications.live";

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Math.floor(parsed);
};

const parseTimestamp = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return 0;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

const cloneRecommendationItems = (items) => {
    const next = {};
    if (!items || typeof items !== "object" || Array.isArray(items)) {
        return next;
    }

    for (const [id, signature] of Object.entries(items)) {
        const normalizedId = normalizeString(id);
        const normalizedSignature = normalizeString(signature);
        if (!normalizedId || !normalizedSignature) {
            continue;
        }
        next[normalizedId] = normalizedSignature;
    }

    return next;
};

const cloneSubscriptionItems = (items) => {
    const next = {};
    if (!items || typeof items !== "object" || Array.isArray(items)) {
        return next;
    }

    for (const [id, signature] of Object.entries(items)) {
        const normalizedId = normalizeString(id);
        if (!normalizedId || !signature || typeof signature !== "object" || Array.isArray(signature)) {
            continue;
        }

        next[normalizedId] = {
            chapterDmCount: normalizeCount(signature.chapterDmCount),
            lastChapterDmAt: normalizeString(signature.lastChapterDmAt),
        };
    }

    return next;
};

export const createEmptyLiveNotificationSeenState = () => ({
    version: LIVE_NOTIFICATION_SEEN_STATE_VERSION,
    recommendations: {
        seeded: false,
        items: {},
    },
    subscriptions: {
        seeded: false,
        items: {},
    },
});

export const parseLiveNotificationSeenState = (rawValue) => {
    if (!rawValue) {
        return createEmptyLiveNotificationSeenState();
    }

    let parsed;
    if (typeof rawValue === "string") {
        try {
            parsed = JSON.parse(rawValue);
        } catch {
            return createEmptyLiveNotificationSeenState();
        }
    } else {
        parsed = rawValue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return createEmptyLiveNotificationSeenState();
    }

    const recommendations = parsed.recommendations && typeof parsed.recommendations === "object"
        ? parsed.recommendations
        : {};
    const subscriptions = parsed.subscriptions && typeof parsed.subscriptions === "object"
        ? parsed.subscriptions
        : {};

    return {
        version: LIVE_NOTIFICATION_SEEN_STATE_VERSION,
        recommendations: {
            seeded: recommendations.seeded === true,
            items: cloneRecommendationItems(recommendations.items),
        },
        subscriptions: {
            seeded: subscriptions.seeded === true,
            items: cloneSubscriptionItems(subscriptions.items),
        },
    };
};

export const buildLiveNotificationStorageKey = ({discordUserId = "", username = ""} = {}) => {
    const normalizedDiscordUserId = normalizeString(discordUserId);
    if (normalizedDiscordUserId) {
        return `${LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX}:discord.${normalizedDiscordUserId}`;
    }

    const normalizedUsername = normalizeString(username).toLowerCase();
    if (normalizedUsername) {
        return `${LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX}:user.${normalizedUsername}`;
    }

    return "";
};

const normalizeRecommendationDecisionKind = (value) => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === "approved" || normalized === "accepted") {
        return "approval";
    }
    if (
        normalized === "denied"
        || normalized === "rejected"
        || normalized === "declined"
        || normalized === "cancelled"
    ) {
        return "denial";
    }
    return null;
};

const recommendationDecisionTimestamp = (entry, decisionKind) => {
    if (decisionKind === "approval") {
        return normalizeString(entry?.approvedAt) || normalizeString(entry?.lastActivityAt);
    }

    if (decisionKind === "denial") {
        return normalizeString(entry?.deniedAt) || normalizeString(entry?.lastActivityAt);
    }

    return "";
};

const recommendationDisplayTitle = (entry) =>
    normalizeString(entry?.title) || normalizeString(entry?.query) || "Untitled recommendation";

export const buildRecommendationDecisionSignature = (entry) => {
    const id = normalizeString(entry?.id);
    if (!id) {
        return null;
    }

    const decisionKind = normalizeRecommendationDecisionKind(entry?.status);
    if (!decisionKind) {
        return null;
    }

    const timestamp = recommendationDecisionTimestamp(entry, decisionKind);
    return `${decisionKind}:${timestamp || "state"}`;
};

export const collectRecommendationDecisionChanges = (entries, previousItems = {}) => {
    const changes = [];
    const nextItems = {};
    const previous = cloneRecommendationItems(previousItems);

    if (!Array.isArray(entries)) {
        return {changes, nextItems};
    }

    for (const entry of entries) {
        const id = normalizeString(entry?.id);
        if (!id) {
            continue;
        }

        const signature = buildRecommendationDecisionSignature(entry);
        if (!signature) {
            continue;
        }

        nextItems[id] = signature;
        if (previous[id] !== signature) {
            changes.push({
                entry,
                id,
                signature,
                decisionKind: signature.startsWith("approval:") ? "approval" : "denial",
            });
        }
    }

    return {changes, nextItems};
};

export const buildRecommendationDecisionToast = (entry) => {
    const id = normalizeString(entry?.id);
    const signature = buildRecommendationDecisionSignature(entry);
    const decisionKind = normalizeRecommendationDecisionKind(entry?.status);
    if (!id || !signature || !decisionKind) {
        return null;
    }

    const title = recommendationDisplayTitle(entry);
    const approved = decisionKind === "approval";

    return {
        title: approved ? "Request approved" : "Request denied",
        message: approved
            ? `${title} was approved.`
            : `${title} was denied.`,
        variant: approved ? "success" : "danger",
        clickLabel: "Open request timeline",
        dedupeKey: `recommendation-decision:${id}:${signature}`,
        action: {
            type: "href",
            href: `/myrecommendations/${encodeURIComponent(id)}`,
        },
    };
};

export const buildSubscriptionNotificationSignature = (entry) => ({
    chapterDmCount: normalizeCount(entry?.notifications?.chapterDmCount),
    lastChapterDmAt: normalizeString(entry?.notifications?.lastChapterDmAt),
});

const subscriptionDisplayTitle = (entry) =>
    normalizeString(entry?.title) || normalizeString(entry?.titleQuery) || "A followed title";

const isTimestampAdvanced = (previous, next) => {
    const previousValue = normalizeString(previous);
    const nextValue = normalizeString(next);
    if (!nextValue || nextValue === previousValue) {
        return false;
    }

    const previousTimestamp = parseTimestamp(previousValue);
    const nextTimestamp = parseTimestamp(nextValue);
    if (!previousValue) {
        return true;
    }
    if (previousTimestamp > 0 && nextTimestamp > 0) {
        return nextTimestamp > previousTimestamp;
    }
    return true;
};

export const buildSubscriptionUpdateMessage = ({title = "", deltaCount = 0} = {}) => {
    const label = normalizeString(title) || "A followed title";
    const resolvedDelta = normalizeCount(deltaCount) || 1;
    if (resolvedDelta === 1) {
        return `${label} has 1 new chapter update.`;
    }
    return `${label} has ${resolvedDelta} new chapter updates.`;
};

export const collectSubscriptionNotificationChanges = (entries, previousItems = {}) => {
    const changes = [];
    const nextItems = {};
    const previous = cloneSubscriptionItems(previousItems);

    if (!Array.isArray(entries)) {
        return {changes, nextItems};
    }

    for (const entry of entries) {
        const id = normalizeString(entry?.id);
        if (!id) {
            continue;
        }

        const signature = buildSubscriptionNotificationSignature(entry);
        nextItems[id] = signature;

        const previousSignature = hasOwn(previous, id) ? previous[id] : null;
        const deltaCount = previousSignature
            ? Math.max(0, signature.chapterDmCount - previousSignature.chapterDmCount)
            : signature.chapterDmCount;
        const timestampAdvanced = isTimestampAdvanced(previousSignature?.lastChapterDmAt, signature.lastChapterDmAt);

        if (deltaCount <= 0 && !timestampAdvanced) {
            continue;
        }

        changes.push({
            entry,
            id,
            signature,
            deltaCount: deltaCount > 0 ? deltaCount : 1,
        });
    }

    return {changes, nextItems};
};

export const buildSubscriptionUpdateToast = (entry, deltaCount) => {
    const id = normalizeString(entry?.id);
    if (!id) {
        return null;
    }

    const signature = buildSubscriptionNotificationSignature(entry);
    const titleUuid = normalizeString(entry?.titleUuid);
    const message = buildSubscriptionUpdateMessage({
        title: subscriptionDisplayTitle(entry),
        deltaCount,
    });

    return {
        title: "Subscription update",
        message,
        variant: "info",
        clickLabel: titleUuid ? "Open library title" : "Open subscriptions",
        dedupeKey: `subscription-update:${id}:${signature.chapterDmCount}:${signature.lastChapterDmAt || "none"}`,
        action: {
            type: "href",
            href: titleUuid
                ? `/libraries/${encodeURIComponent(titleUuid)}`
                : "/mysubscriptions",
        },
    };
};

export const buildMoonMusicNotificationMessage = () => (
    "Song: Dosi & Aisake - Cruising [NCS Release]\nMusic provided by NoCopyrightSounds"
);

export const buildMoonMusicNotification = (playSessionId) => {
    const sessionId = normalizeString(playSessionId);
    if (!sessionId) {
        return null;
    }

    return {
        title: "Now Playing",
        message: buildMoonMusicNotificationMessage(),
        variant: "info",
        clickLabel: "Open music controls",
        dedupeKey: `moon-music:${sessionId}`,
        action: {
            type: "event",
            eventName: NOONA_OPEN_MUSIC_CONTROLS_EVENT,
        },
    };
};
