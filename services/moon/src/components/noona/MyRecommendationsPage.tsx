"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {AuthGate} from "./AuthGate";
import {SetupModeGate} from "./SetupModeGate";
import {
    formatTimestamp,
    normalizeStatus,
    normalizeString,
    parseErrorMessage,
    type RecommendationRecord,
    type RecommendationsResponse,
    recommendationTitle,
    resolveRecommendationKey,
    statusBadgeBackground,
} from "./recommendationsCommon";

export function MyRecommendationsPage() {
    const [recommendations, setRecommendations] = useState<RecommendationRecord[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadRecommendations = async () => {
        setError(null);
        setRecommendations(null);

        try {
            const response = await fetch("/api/noona/myrecommendations?limit=200", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as RecommendationsResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to load your recommendations (HTTP ${response.status}).`));
            }

            setRecommendations(Array.isArray(payload?.recommendations) ? payload.recommendations : []);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
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
                                My Recommendations
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Track each request and open the timeline to see admin decisions and comments.
                            </Text>
                        </Column>
                        <Button variant="primary" onClick={() => void loadRecommendations()}>
                            Refresh
                        </Button>
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
                            <Column gap="8">
                                <Text>You have not submitted any recommendations yet.</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Use Discord `/recommend` and it will appear here.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {recommendations && rows.length > 0 && (
                        <Column fillWidth gap="12">
                            {rows.map((entry, index) => {
                                const id = normalizeString(entry.id);
                                const status = normalizeStatus(entry.status);
                                const title = recommendationTitle(entry);
                                const requestedAt = formatTimestamp(entry.requestedAt);
                                const sourceUrl = normalizeString(entry.href);
                                const query = normalizeString(entry.query);

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

                                            {id && (
                                                <Row gap="8">
                                                    <Button
                                                        size="s"
                                                        variant="secondary"
                                                        href={`/myrecommendations/${encodeURIComponent(id)}`}
                                                    >
                                                        View timeline
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
