export type RecommendationTimelineActor = {
    role?: string | null;
    username?: string | null;
    discordId?: string | null;
    tag?: string | null;
};

export type RecommendationTimelineEvent = {
    id?: string | null;
    type?: string | null;
    createdAt?: string | null;
    body?: string | null;
    actor?: RecommendationTimelineActor | null;
};

export type RecommendationMetadataSelection = {
    status?: string | null;
    query?: string | null;
    title?: string | null;
    provider?: string | null;
    providerSeriesId?: string | null;
    aniListId?: string | null;
    malId?: string | null;
    cbrId?: string | null;
    summary?: string | null;
    sourceUrl?: string | null;
    coverImageUrl?: string | null;
    adultContent?: boolean | null;
    selectedAt?: string | null;
    selectedBy?: {
        username?: string | null;
        discordId?: string | null;
    } | null;
    queuedAt?: string | null;
    titleUuid?: string | null;
    appliedAt?: string | null;
    appliedSeriesId?: number | null;
    appliedLibraryId?: number | null;
    appliedTitle?: string | null;
    lastAttemptedAt?: string | null;
    lastError?: string | null;
};

export type RecommendationRecord = {
    id?: string | null;
    source?: string | null;
    status?: string | null;
    requestedAt?: string | null;
    query?: string | null;
    searchId?: string | null;
    selectedOptionIndex?: number | null;
    title?: string | null;
    href?: string | null;
    sourceAdultContent?: boolean | null;
    approvedAt?: string | null;
    deniedAt?: string | null;
    denialReason?: string | null;
    lastActivityAt?: string | null;
    requestedBy?: {
        discordId?: string | null;
        tag?: string | null;
    } | null;
    approvedBy?: {
        username?: string | null;
        discordId?: string | null;
    } | null;
    deniedBy?: {
        username?: string | null;
        discordId?: string | null;
    } | null;
    discordContext?: {
        guildId?: string | null;
        channelId?: string | null;
    } | null;
    timeline?: RecommendationTimelineEvent[] | null;
    metadataSelection?: RecommendationMetadataSelection | null;
};

export type RecommendationsResponse = {
    recommendations?: RecommendationRecord[] | null;
    canManage?: boolean;
};

export type RecommendationResponse = {
    recommendation?: RecommendationRecord | null;
};

export const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const normalizeBoolean = (value: unknown): boolean | null => {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        if (value === 1) return true;
        if (value === 0) return false;
    }

    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1") {
        return true;
    }

    if (normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0") {
        return false;
    }

    return null;
};

export const normalizeStatus = (value: unknown): string => {
    const normalized = normalizeString(value).toLowerCase();
    return normalized || "pending";
};

export const isPendingRecommendation = (statusRaw: string): boolean => {
    const status = normalizeStatus(statusRaw);
    return status === "pending" || status === "new" || status === "requested";
};

export const formatTimestamp = (value: unknown): string => {
    const iso = normalizeString(value);
    if (!iso) return "";

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    return parsed.toLocaleString();
};

export const parseErrorMessage = (json: unknown, fallback: string): string => {
    if (
        json
        && typeof json === "object"
        && "error" in json
        && typeof (json as { error?: unknown }).error === "string"
    ) {
        const message = normalizeString((json as { error?: unknown }).error);
        if (message) {
            return message;
        }
    }

    return fallback;
};

export const statusBadgeBackground = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    if (status === "approved" || status === "accepted") return "success-alpha-weak";
    if (status === "rejected" || status === "denied" || status === "cancelled" || status === "declined") {
        return "danger-alpha-weak";
    }
    return "brand-alpha-weak";
};

export const resolveRecommendationKey = (entry: RecommendationRecord, index: number): string => {
    const id = normalizeString(entry.id);
    if (id) return id;

    const requestedAt = normalizeString(entry.requestedAt);
    const title = normalizeString(entry.title);
    const query = normalizeString(entry.query);
    return `${title || query || "recommendation"}:${requestedAt || String(index)}`;
};

export const recommendationTitle = (entry: RecommendationRecord): string =>
    normalizeString(entry.title) || normalizeString(entry.query) || "Untitled recommendation";

export const recommendationMetadataLabel = (value: RecommendationMetadataSelection | null | undefined): string => {
    const title = normalizeString(value?.title);
    const provider = normalizeString(value?.provider).toUpperCase();
    if (title && provider) {
        return `${title} (${provider})`;
    }
    if (title) {
        return title;
    }
    if (provider) {
        return provider;
    }
    if (normalizeString(value?.aniListId)) {
        return `AniList ${normalizeString(value?.aniListId)}`;
    }
    if (normalizeString(value?.malId)) {
        return `MyAnimeList ${normalizeString(value?.malId)}`;
    }
    if (normalizeString(value?.cbrId)) {
        return `ComicBookResources ${normalizeString(value?.cbrId)}`;
    }
    return "";
};

export const recommendationMetadataStatusLabel = (value: RecommendationMetadataSelection | null | undefined): string => {
    const status = normalizeString(value?.status).toLowerCase();
    if (status === "applied") return "metadata applied";
    if (status === "failed") return "metadata retrying";
    if (value) return "metadata queued";
    return "";
};

export const recommendationMetadataHasAdultContent = (
    value: RecommendationMetadataSelection | null | undefined,
): boolean => normalizeBoolean(value?.adultContent) === true;

export const recommendationSourceHasAdultContent = (
    value: RecommendationRecord | null | undefined,
): boolean => normalizeBoolean(value?.sourceAdultContent) === true;

export const timelineActorLabel = (event: RecommendationTimelineEvent): string => {
    const role = normalizeString(event?.actor?.role).toLowerCase();
    const username = normalizeString(event?.actor?.username);
    const tag = normalizeString(event?.actor?.tag);
    if (tag) {
        return `@${tag}`;
    }
    if (username) {
        return username;
    }
    if (role === "admin") {
        return "Admin";
    }
    if (role === "user") {
        return "You";
    }
    return "System";
};
