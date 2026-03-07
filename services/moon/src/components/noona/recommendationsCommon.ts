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
};

export type RecommendationsResponse = {
    recommendations?: RecommendationRecord[] | null;
    canManage?: boolean;
};

export type RecommendationResponse = {
    recommendation?: RecommendationRecord | null;
};

export const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

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
