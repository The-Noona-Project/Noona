"use client";

import {useEffect, useEffectEvent, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import styles from "./RecommendationApprovalModal.module.scss";
import {
    normalizeString,
    parseErrorMessage,
    type RecommendationMetadataSelection,
    type RecommendationRecord,
    recommendationSourceHasAdultContent,
    recommendationTitle,
} from "./recommendationsCommon";

type RecommendationApprovalModalProps = {
    open: boolean;
    recommendation: RecommendationRecord | null;
    onClose: () => void;
    onApproved: (recommendation: RecommendationRecord | null) => void;
};

type MetadataCandidate = {
    provider?: string | null;
    title?: string | null;
    summary?: string | null;
    score?: number | null;
    coverImageUrl?: string | null;
    sourceUrl?: string | null;
    providerSeriesId?: string | null;
    aniListId?: string | number | null;
    malId?: string | number | null;
    cbrId?: string | number | null;
};

type MetadataSearchResponse = {
    query?: string | null;
    matches?: MetadataCandidate[] | null;
    error?: string;
};

type RecommendationApprovalResponse = {
    recommendation?: RecommendationRecord | null;
    error?: string;
};

const normalizeIdentifier = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    const normalized = normalizeString(value);
    return normalized || null;
};

const hasMetadataIdentifiers = (candidate: MetadataCandidate | null | undefined): boolean =>
    Boolean(
        (
            normalizeString(candidate?.provider)
            && normalizeIdentifier(candidate?.providerSeriesId)
        )
        || normalizeIdentifier(candidate?.aniListId)
        || normalizeIdentifier(candidate?.malId)
        || normalizeIdentifier(candidate?.cbrId),
    );

const buildCandidateKey = (candidate: MetadataCandidate, index: number): string =>
    [
        normalizeString(candidate.provider).toUpperCase(),
        normalizeIdentifier(candidate.providerSeriesId),
        normalizeIdentifier(candidate.aniListId),
        normalizeIdentifier(candidate.malId),
        normalizeIdentifier(candidate.cbrId),
        String(index),
    ].filter(Boolean).join(":");

const buildMetadataSelectionPayload = (
    candidate: MetadataCandidate,
    query: string,
): RecommendationMetadataSelection => ({
    query,
    title: normalizeString(candidate.title) || null,
    provider: normalizeString(candidate.provider) || null,
    providerSeriesId: normalizeIdentifier(candidate.providerSeriesId),
    aniListId: normalizeIdentifier(candidate.aniListId),
    malId: normalizeIdentifier(candidate.malId),
    cbrId: normalizeIdentifier(candidate.cbrId),
    summary: normalizeString(candidate.summary) || null,
    sourceUrl: normalizeString(candidate.sourceUrl) || null,
    coverImageUrl: normalizeString(candidate.coverImageUrl) || null,
});

export function RecommendationApprovalModal({
                                                open,
                                                recommendation,
                                                onClose,
                                                onApproved,
                                            }: RecommendationApprovalModalProps) {
    const recommendationId = normalizeString(recommendation?.id);
    const recommendationName = recommendationTitle(recommendation ?? {});
    const sourceUrl = normalizeString(recommendation?.href);
    const sourceAdultContent = recommendationSourceHasAdultContent(recommendation);
    const initialQuery = normalizeString(recommendation?.title) || normalizeString(recommendation?.query);

    const [query, setQuery] = useState(initialQuery);
    const [matches, setMatches] = useState<MetadataCandidate[]>([]);
    const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedMatch = useMemo(
        () => matches.find((entry, index) => buildCandidateKey(entry, index) === selectedMatchKey) ?? null,
        [matches, selectedMatchKey],
    );
    const loadMatchesOnOpen = useEffectEvent((nextQuery: string) => {
        void loadMatches(nextQuery);
    });

    const loadMatches = async (queryOverride?: string) => {
        const normalizedQuery = normalizeString(queryOverride ?? query);
        if (!normalizedQuery) {
            setMatches([]);
            setSelectedMatchKey(null);
            setError("A metadata search query is required.");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/noona/portal/kavita/title-match/search", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({query: normalizedQuery}),
            });
            const payload = (await response.json().catch(() => null)) as MetadataSearchResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Metadata lookup failed (HTTP ${response.status}).`));
            }

            const nextMatches = Array.isArray(payload?.matches)
                ? payload.matches.filter((entry) => hasMetadataIdentifiers(entry))
                : [];
            setMatches(nextMatches);
            setSelectedMatchKey(nextMatches.length > 0 ? buildCandidateKey(nextMatches[0], 0) : null);
        } catch (error_) {
            setMatches([]);
            setSelectedMatchKey(null);
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setLoading(false);
        }
    };

    const submitApproval = async ({skipMetadata = false}: { skipMetadata?: boolean } = {}) => {
        if (!recommendationId || approving) return;

        const metadataQuery = normalizeString(query) || recommendationName;
        if (!skipMetadata && !selectedMatch) {
            setError("Pick a metadata candidate or approve without metadata.");
            return;
        }

        if (sourceAdultContent) {
            const confirmed = window.confirm("Are you sure? This title has Adult Content on the source website.");
            if (!confirmed) {
                return;
            }
        }

        setApproving(true);
        setError(null);
        try {
            const response = await fetch(`/api/noona/recommendations/${encodeURIComponent(recommendationId)}/approve`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    metadataQuery,
                    metadataSelection: skipMetadata || !selectedMatch
                        ? null
                        : buildMetadataSelectionPayload(selectedMatch, metadataQuery),
                }),
            });
            const payload = (await response.json().catch(() => null)) as RecommendationApprovalResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Approval failed (HTTP ${response.status}).`));
            }

            onApproved(payload?.recommendation ?? null);
            onClose();
        } catch (error_) {
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setApproving(false);
        }
    };

    useEffect(() => {
        if (!open) {
            return;
        }

        setQuery(initialQuery);
        setMatches([]);
        setSelectedMatchKey(null);
        setError(null);
        if (initialQuery) {
            loadMatchesOnOpen(initialQuery);
        }
    }, [open, recommendationId, initialQuery]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || loading || approving) {
                return;
            }
            onClose();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [approving, loading, onClose, open]);

    if (!open || !recommendation) {
        return null;
    }

    return (
        <Column
            role="presentation"
            className={styles.overlay}
            onClick={(event) => {
                if (event.target !== event.currentTarget || loading || approving) {
                    return;
                }
                onClose();
            }}
        >
            <Card
                background="surface"
                border="neutral-alpha-weak"
                padding="l"
                radius="xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="recommendation-approve-title"
                className={styles.dialogCard}
            >
                <Column gap="16">
                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading as="h2" id="recommendation-approve-title" variant="heading-strong-l"
                                     wrap="balance">
                                Approve Recommendation
                            </Heading>
                            <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                Pick the metadata title Noona should hold for later Kavita apply. Raven will be queued
                                now,
                                but metadata waits until the download finishes and the library scan can resolve the new
                                series.
                            </Text>
                        </Column>
                        <Button variant="secondary" disabled={loading || approving} onClick={onClose}>
                            Close
                        </Button>
                    </Row>

                    <div className={styles.summaryGrid}>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak"
                              className={styles.summaryTile}>
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Recommendation
                                </Text>
                                <Text variant="body-strong-s" wrap="balance">
                                    {recommendationName}
                                </Text>
                            </Column>
                        </Card>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak"
                              className={styles.summaryTile}>
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Raven source
                                </Text>
                                {sourceUrl ? (
                                    <SmartLink href={sourceUrl}>{sourceUrl}</SmartLink>
                                ) : (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        No source URL stored on this recommendation.
                                    </Text>
                                )}
                            </Column>
                        </Card>
                    </div>

                    <Row fillWidth gap="12" vertical="end" s={{direction: "column"}}>
                        <Input
                            id="recommendation-approve-metadata-query"
                            name="recommendation-approve-metadata-query"
                            type="text"
                            label="Metadata search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search Komf metadata titles"
                        />
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={loading || approving}
                                    onClick={() => void loadMatches()}>
                                {loading ? "Searching..." : "Search"}
                            </Button>
                            <Button variant="secondary" disabled={loading || approving}
                                    onClick={() => setQuery(initialQuery)}>
                                Reset query
                            </Button>
                        </Row>
                    </Row>

                    {error && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="m" radius="l">
                            <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                {error}
                            </Text>
                        </Card>
                    )}

                    {loading && (
                        <Row fillWidth horizontal="center" vertical="center" gap="12" paddingY="12">
                            <Spinner/>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Fetching metadata candidates...
                            </Text>
                        </Row>
                    )}

                    {!loading && matches.length === 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                            <Column gap="8">
                                <Text variant="body-default-s">No metadata candidates were returned.</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    You can change the query and search again, or approve this recommendation without
                                    saving metadata.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {!loading && matches.length > 0 && (
                        <Column gap="8" className={styles.candidateList}>
                            {matches.map((candidate, index) => {
                                const candidateKey = buildCandidateKey(candidate, index);
                                const selected = candidateKey === selectedMatchKey;
                                const providerLabel = normalizeString(candidate.provider).toUpperCase() || "Unknown provider";
                                return (
                                    <div
                                        key={candidateKey}
                                        className={`${styles.candidateRow} ${selected ? styles.candidateRowSelected : ""}`.trim()}
                                        onClick={() => setSelectedMatchKey(candidateKey)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setSelectedMatchKey(candidateKey);
                                            }
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="recommendation-metadata-selection"
                                            checked={selected}
                                            onChange={() => setSelectedMatchKey(candidateKey)}
                                            aria-label={`Select metadata candidate ${index + 1}`}
                                            className={styles.candidateRadio}
                                        />
                                        <Column gap="8" style={{minWidth: 0}}>
                                            <Row horizontal="between" vertical="center" gap="8"
                                                 style={{flexWrap: "wrap"}}>
                                                <Text variant="body-strong-s" wrap="balance">
                                                    {normalizeString(candidate.title) || "Untitled metadata result"}
                                                </Text>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Badge background="brand-alpha-weak">{providerLabel}</Badge>
                                                    {typeof candidate.score === "number" && Number.isFinite(candidate.score) && (
                                                        <Badge
                                                            background="neutral-alpha-weak">score {candidate.score}</Badge>
                                                    )}
                                                </Row>
                                            </Row>
                                            {normalizeString(candidate.summary) && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    {normalizeString(candidate.summary)}
                                                </Text>
                                            )}
                                            {normalizeString(candidate.sourceUrl) && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    <SmartLink href={normalizeString(candidate.sourceUrl)}>
                                                        {normalizeString(candidate.sourceUrl)}
                                                    </SmartLink>
                                                </Text>
                                            )}
                                        </Column>
                                    </div>
                                );
                            })}
                        </Column>
                    )}

                    {sourceAdultContent && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="m" radius="l">
                            <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                The Raven source page for this recommendation is marked `Adult Content: yes`. Noona will
                                ask you to confirm before Raven is queued.
                            </Text>
                        </Card>
                    )}

                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            {selectedMatch
                                ? `Selected metadata: ${normalizeString(selectedMatch.title) || normalizeString(selectedMatch.provider) || "match"}${sourceAdultContent ? " • Source Adult Content: yes" : ""}`
                                : "No metadata candidate selected."}
                        </Text>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={loading || approving}
                                    onClick={() => void submitApproval({skipMetadata: true})}>
                                {approving ? "Saving..." : "Approve without metadata"}
                            </Button>
                            <Button
                                variant="primary"
                                disabled={loading || approving || selectedMatch == null}
                                onClick={() => void submitApproval()}
                            >
                                {approving ? "Queueing..." : "Approve and queue"}
                            </Button>
                        </Row>
                    </Row>
                </Column>
            </Card>
        </Column>
    );
}
