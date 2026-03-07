"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {AuthGate} from "./AuthGate";
import {SetupModeGate} from "./SetupModeGate";
import {
    formatTimestamp,
    isPendingRecommendation,
    normalizeStatus,
    normalizeString,
    parseErrorMessage,
    type RecommendationRecord,
    type RecommendationResponse,
    type RecommendationTimelineEvent,
    recommendationTitle,
    statusBadgeBackground,
    timelineActorLabel,
} from "./recommendationsCommon";

type DetailScope = "admin" | "my";

type RecommendationDetailPageProps = {
    recommendationId: string;
    scope: DetailScope;
};

type RecommendationMutationResponse = {
    recommendation?: RecommendationRecord | null;
};

const timelineEventLabel = (event: RecommendationTimelineEvent): string => {
    const type = normalizeString(event.type).toLowerCase();
    if (type === "created") return "Created";
    if (type === "approved") return "Approved";
    if (type === "denied") return "Denied";
    if (type === "comment") return "Comment";
    return "Update";
};

export function RecommendationDetailPage({recommendationId, scope}: RecommendationDetailPageProps) {
    const router = useRouter();
    const isAdminScope = scope === "admin";
    const listPath = isAdminScope ? "/recommendations" : "/myrecommendations";
    const detailApiBase = isAdminScope ? "/api/noona/recommendations" : "/api/noona/myrecommendations";
    const commentsApiPath = `${detailApiBase}/${encodeURIComponent(recommendationId)}/comments`;
    const requiredPermission = isAdminScope ? "manageRecommendations" : "myRecommendations";
    const deniedMessage = isAdminScope
        ? "Recommendation management requires Manage recommendations permission."
        : "My recommendations permission is required.";

    const [recommendation, setRecommendation] = useState<RecommendationRecord | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [comment, setComment] = useState("");
    const [submittingComment, setSubmittingComment] = useState(false);
    const [acting, setActing] = useState(false);

    const loadRecommendation = useCallback(async () => {
        setError(null);
        setRecommendation(null);

        try {
            const response = await fetch(`${detailApiBase}/${encodeURIComponent(recommendationId)}`, {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as RecommendationResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to load recommendation (HTTP ${response.status}).`));
            }

            setRecommendation(payload?.recommendation ?? null);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        }
    }, [detailApiBase, recommendationId]);

    useEffect(() => {
        if (!normalizeString(recommendationId)) {
            setError("Recommendation id is required.");
            setRecommendation(null);
            return;
        }
        void loadRecommendation();
    }, [loadRecommendation, recommendationId]);

    const applyMutation = async (path: string, init: RequestInit) => {
        setActing(true);
        setError(null);
        try {
            const response = await fetch(path, init);
            const payload = (await response.json().catch(() => null)) as RecommendationMutationResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Request failed (HTTP ${response.status}).`));
            }

            if (payload?.recommendation) {
                setRecommendation(payload.recommendation);
            } else {
                await loadRecommendation();
            }
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setActing(false);
        }
    };

    const approveRecommendation = async () => {
        await applyMutation(`/api/noona/recommendations/${encodeURIComponent(recommendationId)}/approve`, {
            method: "POST",
        });
    };

    const denyRecommendation = async () => {
        const promptResult = window.prompt("Optional denial reason for the requester:", "");
        if (promptResult == null) {
            return;
        }

        await applyMutation(`/api/noona/recommendations/${encodeURIComponent(recommendationId)}/deny`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({reason: promptResult}),
        });
    };

    const closeRecommendation = async () => {
        setActing(true);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(recommendationId)}`, {
                method: "DELETE",
            });
            const payload = (await response.json().catch(() => null)) as unknown;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to close recommendation (HTTP ${response.status}).`));
            }

            router.push("/recommendations");
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setActing(false);
        }
    };

    const submitComment = async () => {
        if (submittingComment || acting) return;
        const body = normalizeString(comment);
        if (!body) {
            setError("Comment text is required.");
            return;
        }

        setSubmittingComment(true);
        setError(null);
        try {
            const response = await fetch(commentsApiPath, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({comment: body}),
            });
            const payload = (await response.json().catch(() => null)) as RecommendationMutationResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to save comment (HTTP ${response.status}).`));
            }

            setComment("");
            if (payload?.recommendation) {
                setRecommendation(payload.recommendation);
            } else {
                await loadRecommendation();
            }
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setSubmittingComment(false);
        }
    };

    const timelineRows = useMemo(
        () => (Array.isArray(recommendation?.timeline) ? recommendation.timeline : []),
        [recommendation?.timeline],
    );

    const status = normalizeStatus(recommendation?.status);
    const canTransition = isPendingRecommendation(status);
    const sourceUrl = normalizeString(recommendation?.href);
    const query = normalizeString(recommendation?.query);
    const requestedBy = normalizeString(recommendation?.requestedBy?.tag);
    const title = recommendationTitle(recommendation ?? {});

    return (
        <SetupModeGate>
            <AuthGate requiredPermission={requiredPermission} deniedMessage={deniedMessage}>
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
                                Recommendation Timeline
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                {isAdminScope
                                    ? "Review status and comments for this recommendation."
                                    : "Track updates and reply to admin comments."}
                            </Text>
                        </Column>
                        <Button variant="secondary" href={listPath}>
                            Back to list
                        </Button>
                    </Row>

                    {error && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Text>{error}</Text>
                        </Card>
                    )}

                    {!recommendation && !error && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {recommendation && (
                        <>
                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
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
                                        {formatTimestamp(recommendation.requestedAt) && (
                                            <Badge background="neutral-alpha-weak">
                                                Requested {formatTimestamp(recommendation.requestedAt)}
                                            </Badge>
                                        )}
                                        {requestedBy && (
                                            <Badge background="neutral-alpha-weak">
                                                By @{requestedBy}
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

                                    {isAdminScope && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {canTransition && (
                                                <Button size="s" variant="primary" disabled={acting}
                                                        onClick={() => void approveRecommendation()}>
                                                    {acting ? "Saving..." : "Approve"}
                                                </Button>
                                            )}
                                            {canTransition && (
                                                <Button size="s" variant="secondary" disabled={acting}
                                                        onClick={() => void denyRecommendation()}>
                                                    {acting ? "Saving..." : "Deny"}
                                                </Button>
                                            )}
                                            <Button size="s" variant="secondary" disabled={acting}
                                                    onClick={() => void closeRecommendation()}>
                                                {acting ? "Saving..." : "Close"}
                                            </Button>
                                        </Row>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Heading as="h3" variant="heading-strong-m">
                                        Add comment
                                    </Heading>
                                    <Input
                                        id="recommendation-comment"
                                        name="recommendation-comment"
                                        type="text"
                                        label="Comment"
                                        placeholder={isAdminScope ? "Leave an update for the requester" : "Reply to admin comments"}
                                        value={comment}
                                        onChange={(event) => setComment(event.target.value)}
                                    />
                                    <Row gap="8">
                                        <Button
                                            size="s"
                                            variant="primary"
                                            disabled={submittingComment || acting || !normalizeString(comment)}
                                            onClick={() => void submitComment()}
                                        >
                                            {submittingComment ? "Posting..." : "Post comment"}
                                        </Button>
                                    </Row>
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Heading as="h3" variant="heading-strong-m">
                                        Timeline
                                    </Heading>

                                    {timelineRows.length === 0 && (
                                        <Text onBackground="neutral-weak">
                                            No timeline events were recorded for this recommendation yet.
                                        </Text>
                                    )}

                                    {timelineRows.map((event) => {
                                        const key = normalizeString(event.id) || `${normalizeString(event.type)}:${normalizeString(event.createdAt)}`;
                                        const actor = timelineActorLabel(event);
                                        const createdAt = formatTimestamp(event.createdAt);
                                        const body = normalizeString(event.body);

                                        return (
                                            <Card
                                                key={key}
                                                fillWidth
                                                background="surface"
                                                border="neutral-alpha-weak"
                                                padding="m"
                                                radius="m"
                                            >
                                                <Column gap="8">
                                                    <Row fillWidth horizontal="between" vertical="center" gap="8"
                                                         s={{direction: "column"}}>
                                                        <Badge background="neutral-alpha-weak">
                                                            {timelineEventLabel(event)}
                                                        </Badge>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {createdAt || "Unknown time"}
                                                        </Text>
                                                    </Row>
                                                    <Text variant="body-default-xs" onBackground="neutral-weak">
                                                        {actor}
                                                    </Text>
                                                    {body && (
                                                        <Text wrap="balance">
                                                            {body}
                                                        </Text>
                                                    )}
                                                </Column>
                                            </Card>
                                        );
                                    })}
                                </Column>
                            </Card>
                        </>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
