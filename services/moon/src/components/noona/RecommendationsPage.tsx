"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type RecommendationRecord = {
    id?: string | null;
    source?: string | null;
    status?: string | null;
    requestedAt?: string | null;
    query?: string | null;
    searchId?: string | null;
    selectedOptionIndex?: number | null;
    title?: string | null;
    href?: string | null;
    requestedBy?: {
        discordId?: string | null;
        tag?: string | null;
    } | null;
    discordContext?: {
        guildId?: string | null;
        channelId?: string | null;
    } | null;
};

type RecommendationsResponse = {
    recommendations?: RecommendationRecord[] | null;
    canManage?: boolean;
};

type RecommendationApproveResponse = {
    ok?: boolean;
    recommendation?: RecommendationRecord | null;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeStatus = (value: unknown): string => {
    const normalized = normalizeString(value).toLowerCase();
    return normalized || "pending";
};
const formatTimestamp = (value: unknown): string => {
    const iso = normalizeString(value);
    if (!iso) return "";

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    return parsed.toLocaleString();
};
const parseErrorMessage = (json: unknown, fallback: string): string => {
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
const statusBadgeBackground = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    if (status === "approved" || status === "accepted") return "success-alpha-weak";
    if (status === "rejected" || status === "denied" || status === "cancelled") return "danger-alpha-weak";
    return "brand-alpha-weak";
};
const isRecommendationApprovable = (statusRaw: string): boolean => {
    const status = normalizeStatus(statusRaw);
    return status === "pending" || status === "new" || status === "requested";
};
const resolveRecommendationKey = (entry: RecommendationRecord, index: number): string => {
    const id = normalizeString(entry.id);
    if (id) return id;

    const requestedAt = normalizeString(entry.requestedAt);
    const title = normalizeString(entry.title);
    const query = normalizeString(entry.query);
    return `${title || query || "recommendation"}:${requestedAt || String(index)}`;
};

export function RecommendationsPage() {
    const [recommendations, setRecommendations] = useState<RecommendationRecord[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [approvingId, setApprovingId] = useState<string | null>(null);

    const loadRecommendations = async () => {
        setError(null);
        setRecommendations(null);
        setCanManage(false);

        try {
            const response = await fetch("/api/noona/recommendations?limit=200", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as RecommendationsResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to load recommendations (HTTP ${response.status}).`));
            }

            setRecommendations(Array.isArray(payload?.recommendations) ? payload.recommendations : []);
            setCanManage(payload?.canManage === true);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        }
    };

    const deleteRecommendation = async (id: string) => {
        const safeId = normalizeString(id);
        if (!safeId || deletingId || approvingId) {
            return;
        }

        setDeletingId(safeId);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(safeId)}`, {
                method: "DELETE",
            });
            const payload = (await response.json().catch(() => null)) as unknown;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to delete recommendation (HTTP ${response.status}).`));
            }

            setRecommendations((prev) =>
                Array.isArray(prev) ? prev.filter((entry) => normalizeString(entry.id) !== safeId) : prev,
            );
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setDeletingId(null);
        }
    };

    const approveRecommendation = async (id: string) => {
        const safeId = normalizeString(id);
        if (!safeId || approvingId || deletingId) {
            return;
        }

        setApprovingId(safeId);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(safeId)}/approve`, {
                method: "POST",
            });
            const payload = (await response.json().catch(() => null)) as RecommendationApproveResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to approve recommendation (HTTP ${response.status}).`));
            }

            const approvedEntry = payload?.recommendation ?? null;
            setRecommendations((prev) => {
                if (!Array.isArray(prev)) return prev;
                return prev.map((entry) => {
                    if (normalizeString(entry.id) !== safeId) {
                        return entry;
                    }

                    if (approvedEntry && typeof approvedEntry === "object") {
                        return approvedEntry;
                    }

                    return {
                        ...entry,
                        status: "approved",
                    };
                });
            });
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setApprovingId(null);
        }
    };

    useEffect(() => {
        void loadRecommendations();
    }, []);

    const recommendationRows = useMemo(
        () => (Array.isArray(recommendations) ? recommendations : []),
        [recommendations],
    );

    return (
        <SetupModeGate>
            <AuthGate
                requiredPermission="myRecommendations"
                deniedMessage="Recommendations access requires My recommendations permission."
            >
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    paddingX="16"
                    style={{maxWidth: "var(--moon-page-max-width, 116rem)"}}
                    m={{style: {paddingInline: "24px"}}}
                >
                    <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                Recommendations
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                {canManage
                                    ? "All user-submitted title recommendations stored in Vault."
                                    : "Your user-submitted title recommendations stored in Vault."}
                            </Text>
                        </Column>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" href="/downloads">
                                Open downloads
                            </Button>
                            <Button variant="primary" onClick={() => void loadRecommendations()}>
                                Refresh
                            </Button>
                        </Row>
                    </Row>

                    {error && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Heading as="h2" variant="heading-strong-l">
                                    Recommendations unavailable
                                </Heading>
                                <Text>{error}</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Ensure `noona-sage` and `noona-vault` are installed and running.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {!recommendations && !error && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {recommendations && recommendationRows.length === 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Text>No recommendations have been saved yet.</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Discord `/recommend` submissions will appear here.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {recommendations && recommendationRows.length > 0 && (
                        <Column fillWidth gap="12">
                            {recommendationRows.map((entry, index) => {
                                const status = normalizeStatus(entry.status);
                                const requestedAt = formatTimestamp(entry.requestedAt);
                                const title = normalizeString(entry.title) || "Untitled recommendation";
                                const query = normalizeString(entry.query);
                                const href = normalizeString(entry.href);
                                const requesterTag = normalizeString(entry.requestedBy?.tag);
                                const id = normalizeString(entry.id);
                                const canApprove = Boolean(id) && isRecommendationApprovable(status);

                                return (
                                    <Card
                                        key={resolveRecommendationKey(entry, index)}
                                        fillWidth
                                        background="surface"
                                        border="neutral-alpha-weak"
                                        padding="l"
                                        radius="l"
                                    >
                                        <Column gap="12">
                                            <Row fillWidth horizontal="between" vertical="center" gap="8"
                                                 s={{direction: "column"}}>
                                                <Heading as="h2" variant="heading-strong-m" wrap="balance">
                                                    {title}
                                                </Heading>
                                                <Badge background={statusBadgeBackground(status)}>
                                                    {status}
                                                </Badge>
                                            </Row>

                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                {requestedAt && (
                                                    <Badge background="neutral-alpha-weak">
                                                        Requested {requestedAt}
                                                    </Badge>
                                                )}
                                                {requesterTag && (
                                                    <Badge background="neutral-alpha-weak">
                                                        By @{requesterTag}
                                                    </Badge>
                                                )}
                                            </Row>

                                            {query && (
                                                <Text>
                                                    Query: <Text as="span" onBackground="neutral-weak">{query}</Text>
                                                </Text>
                                            )}

                                            {href && (
                                                <Text>
                                                    Source: <SmartLink href={href}>{href}</SmartLink>
                                                </Text>
                                            )}

                                            {canManage && (
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    {canApprove && (
                                                        <Button
                                                            size="s"
                                                            variant="primary"
                                                            disabled={!id || approvingId === id || deletingId === id}
                                                            onClick={() => void approveRecommendation(id)}
                                                        >
                                                            {approvingId === id ? "Approving..." : "Approve"}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="s"
                                                        variant="secondary"
                                                        disabled={!id || deletingId === id || approvingId === id}
                                                        onClick={() => void deleteRecommendation(id)}
                                                    >
                                                        {deletingId === id ? "Closing..." : "Close recommendation"}
                                                    </Button>
                                                </Row>
                                            )}
                                        </Column>
                                    </Card>
                                );
                            })}
                        </Column>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
