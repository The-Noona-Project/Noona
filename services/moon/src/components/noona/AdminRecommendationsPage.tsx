"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {AuthGate} from "./AuthGate";
import {RecommendationApprovalModal} from "./RecommendationApprovalModal";
import {SetupModeGate} from "./SetupModeGate";
import {
    formatTimestamp,
    isPendingRecommendation,
    normalizeStatus,
    normalizeString,
    parseErrorMessage,
    recommendationMetadataLabel,
    recommendationMetadataStatusLabel,
    type RecommendationRecord,
    recommendationSourceHasAdultContent,
    type RecommendationsResponse,
    recommendationTitle,
    resolveRecommendationKey,
    statusBadgeBackground,
} from "./recommendationsCommon";

type RecommendationMutationResponse = {
    recommendation?: RecommendationRecord | null;
};

export function AdminRecommendationsPage() {
    const [recommendations, setRecommendations] = useState<RecommendationRecord[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actingId, setActingId] = useState<string | null>(null);
    const [approvalRecommendation, setApprovalRecommendation] = useState<RecommendationRecord | null>(null);

    const loadRecommendations = async () => {
        setError(null);
        setRecommendations(null);

        try {
            const response = await fetch("/api/noona/recommendations?limit=200", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as RecommendationsResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to load recommendations (HTTP ${response.status}).`));
            }

            setRecommendations(Array.isArray(payload?.recommendations) ? payload.recommendations : []);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        }
    };

    const closeRecommendation = async (id: string) => {
        const safeId = normalizeString(id);
        if (!safeId || actingId) return;

        setActingId(safeId);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(safeId)}`, {
                method: "DELETE",
            });
            const payload = (await response.json().catch(() => null)) as unknown;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to close recommendation (HTTP ${response.status}).`));
            }

            setRecommendations((prev) =>
                Array.isArray(prev) ? prev.filter((entry) => normalizeString(entry.id) !== safeId) : prev,
            );
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setActingId(null);
        }
    };

    const denyRecommendation = async (id: string) => {
        const safeId = normalizeString(id);
        if (!safeId || actingId) return;

        const promptResult = window.prompt("Optional denial reason for the requester:", "");
        if (promptResult == null) {
            return;
        }

        setActingId(safeId);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(safeId)}/deny`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({reason: promptResult}),
            });
            const payload = (await response.json().catch(() => null)) as RecommendationMutationResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to deny recommendation (HTTP ${response.status}).`));
            }

            const updated = payload?.recommendation ?? null;
            if (!updated) {
                await loadRecommendations();
                return;
            }

            setRecommendations((prev) =>
                Array.isArray(prev)
                    ? prev.map((entry) => (normalizeString(entry.id) === safeId ? updated : entry))
                    : prev,
            );
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setActingId(null);
        }
    };

    useEffect(() => {
        void loadRecommendations();
    }, []);

    const rows = useMemo(
        () => (Array.isArray(recommendations) ? recommendations : []),
        [recommendations],
    );

    return (
        <SetupModeGate>
            <AuthGate
                requiredPermission="manageRecommendations"
                deniedMessage="Recommendations management requires Manage recommendations permission."
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
                                Admin queue for approving, denying, and reviewing user requests.
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
                            </Column>
                        </Card>
                    )}

                    {!recommendations && !error && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {recommendations && rows.length === 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Text>No recommendations are waiting right now.</Text>
                        </Card>
                    )}

                    {recommendations && rows.length > 0 && (
                        <Column fillWidth gap="12">
                            {rows.map((entry, index) => {
                                const id = normalizeString(entry.id);
                                const status = normalizeStatus(entry.status);
                                const title = recommendationTitle(entry);
                                const requestedAt = formatTimestamp(entry.requestedAt);
                                const requesterTag = normalizeString(entry.requestedBy?.tag);
                                const sourceUrl = normalizeString(entry.href);
                                const query = normalizeString(entry.query);
                                const metadataLabel = recommendationMetadataLabel(entry.metadataSelection);
                                const metadataStatus = recommendationMetadataStatusLabel(entry.metadataSelection);
                                const hasAdultContent = recommendationSourceHasAdultContent(entry);
                                const busy = actingId === id;
                                const canTransition = isPendingRecommendation(status);

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
                                                {metadataStatus && (
                                                    <Badge background="neutral-alpha-weak">
                                                        {metadataStatus}
                                                    </Badge>
                                                )}
                                                {hasAdultContent && (
                                                    <Badge background="danger-alpha-weak">
                                                        Adult Content
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

                                            {sourceUrl && (
                                                <Text>
                                                    Source: <SmartLink href={sourceUrl}>{sourceUrl}</SmartLink>
                                                </Text>
                                            )}
                                            {metadataLabel && (
                                                <Text>
                                                    Metadata: <Text as="span"
                                                                    onBackground="neutral-weak">{metadataLabel}</Text>
                                                </Text>
                                            )}

                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                {id && (
                                                    <Button size="s" variant="secondary"
                                                            href={`/recommendations/${encodeURIComponent(id)}`}>
                                                        View timeline
                                                    </Button>
                                                )}
                                                {id && canTransition && (
                                                    <Button
                                                        size="s"
                                                        variant="primary"
                                                        disabled={busy}
                                                        onClick={() => setApprovalRecommendation(entry)}
                                                    >
                                                        Approve
                                                    </Button>
                                                )}
                                                {id && canTransition && (
                                                    <Button
                                                        size="s"
                                                        variant="secondary"
                                                        disabled={busy}
                                                        onClick={() => void denyRecommendation(id)}
                                                    >
                                                        {busy ? "Saving..." : "Deny"}
                                                    </Button>
                                                )}
                                                {id && (
                                                    <Button
                                                        size="s"
                                                        variant="secondary"
                                                        disabled={busy}
                                                        onClick={() => void closeRecommendation(id)}
                                                    >
                                                        {busy ? "Saving..." : "Close"}
                                                    </Button>
                                                )}
                                            </Row>
                                        </Column>
                                    </Card>
                                );
                            })}
                        </Column>
                    )}
                </Column>
                <RecommendationApprovalModal
                    open={approvalRecommendation != null}
                    recommendation={approvalRecommendation}
                    onClose={() => setApprovalRecommendation(null)}
                    onApproved={(updatedRecommendation) => {
                        const safeId = normalizeString(updatedRecommendation?.id);
                        if (!safeId || !updatedRecommendation) {
                            void loadRecommendations();
                            return;
                        }
                        setRecommendations((prev) =>
                            Array.isArray(prev)
                                ? prev.map((entry) => (normalizeString(entry.id) === safeId ? updatedRecommendation : entry))
                                : prev,
                        );
                        setApprovalRecommendation(null);
                    }}
                />
            </AuthGate>
        </SetupModeGate>
    );
}
