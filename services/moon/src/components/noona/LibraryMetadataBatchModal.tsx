"use client";

import {useEffect, useEffectEvent, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import styles from "./LibraryMetadataBatchModal.module.scss";
import type {RavenTitleCardEntry} from "./RavenTitleCard";

type Props = {
    open: boolean;
    titles: RavenTitleCardEntry[];
    onClose: (result?: { appliedCount: number }) => void;
};

type QueueSeries = {
    seriesId?: number | null;
    libraryId?: number | null;
    name?: string | null;
    originalName?: string | null;
    localizedName?: string | null;
    aliases?: string[] | null;
    libraryName?: string | null;
    url?: string | null;
};

type QueueEntry = {
    series: QueueSeries;
    ravenTitle: RavenTitleCardEntry;
};

type QueueResponse = {
    items?: QueueSeries[] | null;
    error?: string;
};

type Match = {
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
    adultContent?: boolean | null;
};

type MatchResponse = {
    matches?: Match[] | null;
    error?: string;
};

type ApplyResponse = {
    message?: string | null;
    coverSync?: {
        status?: string | null;
        message?: string | null;
    } | null;
    error?: string;
};

const s = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const key = (value: unknown): string => s(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const id = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const normalized = s(value);
    return normalized || null;
};
const parseError = (payload: unknown, fallback: string): string =>
    payload && typeof payload === "object" && "error" in payload && typeof (payload as {
        error?: unknown
    }).error === "string"
        ? s((payload as { error?: unknown }).error) || fallback
        : fallback;
const hasIds = (match: Match | null | undefined): boolean =>
    Boolean((s(match?.provider) && id(match?.providerSeriesId)) || id(match?.aniListId) || id(match?.malId) || id(match?.cbrId));
const matchKey = (match: Match, index: number): string =>
    [s(match.provider).toUpperCase(), id(match.providerSeriesId), id(match.aniListId), id(match.malId), id(match.cbrId), String(index)]
        .filter(Boolean)
        .join(":");

const buildLookup = (titles: RavenTitleCardEntry[]) => {
    const lookup = new Map<string, RavenTitleCardEntry[]>();
    for (const title of titles) {
        for (const candidate of [title.title, title.titleName]) {
            const normalized = key(candidate);
            if (!normalized) continue;
            const list = lookup.get(normalized) ?? [];
            list.push(title);
            lookup.set(normalized, list);
        }
    }
    return lookup;
};

const findRavenTitle = (series: QueueSeries, lookup: Map<string, RavenTitleCardEntry[]>): RavenTitleCardEntry | null => {
    const candidates = [series.name, series.originalName, series.localizedName, ...(Array.isArray(series.aliases) ? series.aliases : [])];
    for (const candidate of candidates) {
        const hit = lookup.get(key(candidate))?.[0] ?? null;
        if (hit) return hit;
    }
    return null;
};

const defaultQuery = (entry: QueueEntry | null): string =>
    s(entry?.ravenTitle.title ?? entry?.ravenTitle.titleName) || s(entry?.series.name) || s(entry?.series.localizedName) || s(entry?.series.originalName);

export function LibraryMetadataBatchModal({open, titles, onClose}: Props) {
    const lookup = useMemo(() => buildLookup(titles), [titles]);
    const [queue, setQueue] = useState<QueueEntry[]>([]);
    const [unmappedCount, setUnmappedCount] = useState(0);
    const [appliedCount, setAppliedCount] = useState(0);
    const [loadingQueue, setLoadingQueue] = useState(false);
    const [loadingMatches, setLoadingMatches] = useState(false);
    const [applying, setApplying] = useState(false);
    const [query, setQuery] = useState("");
    const [matches, setMatches] = useState<Match[]>([]);
    const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const current = queue[0] ?? null;
    const totalCount = queue.length + appliedCount;
    const selectedMatch = useMemo(
        () => matches.find((entry, index) => matchKey(entry, index) === selectedMatchKey) ?? null,
        [matches, selectedMatchKey],
    );

    const loadQueue = async () => {
        setLoadingQueue(true);
        setError(null);
        try {
            const response = await fetch("/api/noona/portal/kavita/series-metadata?state=notMatched&pageSize=0", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as QueueResponse | null;
            if (!response.ok) throw new Error(parseError(payload, `Unable to load metadata queue (HTTP ${response.status}).`));
            const rawItems = Array.isArray(payload?.items) ? payload.items : [];
            const nextQueue = rawItems
                .map((series) => ({series, ravenTitle: findRavenTitle(series, lookup)}))
                .filter((entry): entry is QueueEntry => entry.ravenTitle != null);
            setQueue(nextQueue);
            setUnmappedCount(Math.max(0, rawItems.length - nextQueue.length));
        } catch (error_) {
            setQueue([]);
            setUnmappedCount(0);
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setLoadingQueue(false);
        }
    };

    const loadMatches = async (entry: QueueEntry | null, nextQuery: string) => {
        if (entry?.series.seriesId == null) {
            setMatches([]);
            setSelectedMatchKey(null);
            setError("The current Kavita series is missing a series id.");
            return;
        }
        if (!nextQuery) {
            setMatches([]);
            setSelectedMatchKey(null);
            setError("A metadata search query is required.");
            return;
        }
        setLoadingMatches(true);
        setError(null);
        try {
            const response = await fetch("/api/noona/portal/kavita/title-match", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({seriesId: entry.series.seriesId, query: nextQuery}),
            });
            const payload = (await response.json().catch(() => null)) as MatchResponse | null;
            if (!response.ok) throw new Error(parseError(payload, `Metadata lookup failed (HTTP ${response.status}).`));
            const nextMatches = Array.isArray(payload?.matches) ? payload.matches.filter((entry_) => hasIds(entry_)) : [];
            setMatches(nextMatches);
            setSelectedMatchKey(nextMatches.length > 0 ? matchKey(nextMatches[0], 0) : null);
        } catch (error_) {
            setMatches([]);
            setSelectedMatchKey(null);
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setLoadingMatches(false);
        }
    };

    const loadQueueOnOpen = useEffectEvent(() => {
        void loadQueue();
    });

    useEffect(() => {
        if (!open) return;
        setQueue([]);
        setUnmappedCount(0);
        setAppliedCount(0);
        setQuery("");
        setMatches([]);
        setSelectedMatchKey(null);
        setError(null);
        loadQueueOnOpen();
    }, [open, lookup]);

    const loadMatchesOnChange = useEffectEvent((entry: QueueEntry, nextQuery: string) => {
        void loadMatches(entry, nextQuery);
    });

    useEffect(() => {
        if (!open || !current) return;
        const nextQuery = defaultQuery(current);
        setQuery(nextQuery);
        setMatches([]);
        setSelectedMatchKey(null);
        loadMatchesOnChange(current, nextQuery);
    }, [open, current]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || loadingQueue || loadingMatches || applying) return;
            onClose({appliedCount});
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, loadingQueue, loadingMatches, applying, appliedCount, onClose]);

    const skipCurrent = () => {
        setQueue((value) => (value.length <= 1 ? value : [...value.slice(1), value[0]]));
        setError(null);
    };

    const applySelectedMatch = async () => {
        if (!current || !selectedMatch || applying) return;
        const provider = s(selectedMatch.provider);
        const providerSeriesId = id(selectedMatch.providerSeriesId);
        const aniListId = id(selectedMatch.aniListId);
        const malId = id(selectedMatch.malId);
        const cbrId = id(selectedMatch.cbrId);
        if (!(provider && providerSeriesId) && !aniListId && !malId && !cbrId) {
            setError("The selected metadata candidate does not include a provider id Noona can apply.");
            return;
        }

        setApplying(true);
        setError(null);
        try {
            const response = await fetch("/api/noona/portal/kavita/title-match/apply", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    seriesId: current.series.seriesId,
                    libraryId: current.series.libraryId,
                    titleUuid: s(current.ravenTitle.uuid) || null,
                    provider: provider || null,
                    providerSeriesId,
                    aniListId,
                    malId,
                    cbrId,
                    coverImageUrl: s(selectedMatch.coverImageUrl) || null,
                }),
            });
            const payload = (await response.json().catch(() => null)) as ApplyResponse | null;
            if (!response.ok) throw new Error(parseError(payload, `Metadata apply failed (HTTP ${response.status}).`));
            if (s(payload?.coverSync?.status).toLowerCase() === "failed") {
                throw new Error(s(payload?.coverSync?.message) || s(payload?.message) || "Metadata apply succeeded, but cover sync failed.");
            }
            setAppliedCount((value) => value + 1);
            setQueue((value) => value.slice(1));
        } catch (error_) {
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setApplying(false);
        }
    };

    if (!open) return null;

    return (
        <Column
            role="presentation"
            className={styles.overlay}
            onClick={(event) => {
                if (event.target !== event.currentTarget || loadingQueue || loadingMatches || applying) return;
                onClose({appliedCount});
            }}
        >
            <Card
                background="surface"
                border="neutral-alpha-weak"
                padding="l"
                radius="xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="library-metadata-batch-title"
                className={styles.dialogCard}
            >
                <Column gap="16">
                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading as="h2" id="library-metadata-batch-title" variant="heading-strong-l"
                                     wrap="balance">
                                Find Missing Metadata
                            </Heading>
                            <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                Step through Raven library series that still need metadata and apply the right Komf
                                match.
                            </Text>
                        </Column>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={loadingQueue || loadingMatches || applying}
                                    onClick={() => void loadQueue()}>
                                {loadingQueue ? "Refreshing..." : "Refresh queue"}
                            </Button>
                            <Button variant="secondary" disabled={loadingQueue || loadingMatches || applying}
                                    onClick={() => onClose({appliedCount})}>
                                Close
                            </Button>
                        </Row>
                    </Row>

                    <div className={styles.summaryGrid}>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak"
                              className={styles.summaryTile}>
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">Progress</Text>
                                <Text
                                    variant="body-strong-s">{queue.length > 0 ? `${appliedCount + 1} of ${totalCount}` : `${appliedCount} applied`}</Text>
                                <Text onBackground="neutral-weak"
                                      variant="body-default-xs">{queue.length} remaining</Text>
                            </Column>
                        </Card>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak"
                              className={styles.summaryTile}>
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">Raven title</Text>
                                <Text variant="body-strong-s"
                                      wrap="balance">{s(current?.ravenTitle.title ?? current?.ravenTitle.titleName) || "No mapped title"}</Text>
                                {s(current?.ravenTitle.uuid) && <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">{s(current?.ravenTitle.uuid)}</Text>}
                            </Column>
                        </Card>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak"
                              className={styles.summaryTile}>
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">Kavita series</Text>
                                <Text variant="body-strong-s"
                                      wrap="balance">{s(current?.series.name) || "No unmatched series"}</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                      wrap="balance">{s(current?.series.libraryName) || "Unknown library"}</Text>
                            </Column>
                        </Card>
                    </div>

                    {unmappedCount > 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                Skipped {unmappedCount} unmatched Kavita series that could not be linked back to a Raven
                                title.
                            </Text>
                        </Card>
                    )}

                    {error && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="m" radius="l">
                            <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">{error}</Text>
                        </Card>
                    )}

                    {loadingQueue && (
                        <Row fillWidth horizontal="center" vertical="center" gap="12" paddingY="12">
                            <Spinner/>
                            <Text onBackground="neutral-weak" variant="body-default-xs">Loading unmatched metadata
                                queue...</Text>
                        </Row>
                    )}

                    {!loadingQueue && queue.length === 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Text variant="body-default-s">
                                    {appliedCount > 0 ? "Batch metadata run complete." : "No unmatched Raven-linked series were found."}
                                </Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    {appliedCount > 0
                                        ? `Applied metadata to ${appliedCount} title(s).`
                                        : "Moon only queues Kavita series that it can link back to the Raven library."}
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {!loadingQueue && current && (
                        <>
                            <Row fillWidth gap="12" vertical="end" s={{direction: "column"}}>
                                <Input
                                    id="library-metadata-query"
                                    name="library-metadata-query"
                                    type="text"
                                    label="Metadata search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search Komf metadata titles"
                                />
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary" disabled={loadingMatches || applying}
                                            onClick={() => void loadMatches(current, query)}>
                                        {loadingMatches ? "Searching..." : "Search"}
                                    </Button>
                                    <Button variant="secondary" disabled={loadingMatches || applying}
                                            onClick={() => setQuery(defaultQuery(current))}>
                                        Reset query
                                    </Button>
                                    {s(current.series.url) && (
                                        <Button
                                            variant="secondary"
                                            disabled={loadingMatches || applying}
                                            onClick={() => window.open(s(current.series.url), "_blank", "noopener,noreferrer")}
                                        >
                                            Open in Kavita
                                        </Button>
                                    )}
                                </Row>
                            </Row>

                            {loadingMatches && (
                                <Row fillWidth horizontal="center" vertical="center" gap="12" paddingY="12">
                                    <Spinner/>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">Fetching metadata
                                        candidates...</Text>
                                </Row>
                            )}

                            {!loadingMatches && matches.length === 0 && (
                                <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                    <Column gap="8">
                                        <Text variant="body-default-s">No metadata candidates were returned.</Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Change the query and search again, or skip this title for now.
                                        </Text>
                                    </Column>
                                </Card>
                            )}

                            {!loadingMatches && matches.length > 0 && (
                                <Column gap="8" className={styles.candidateList}>
                                    {matches.map((entry, index) => {
                                        const entryKey = matchKey(entry, index);
                                        const selected = entryKey === selectedMatchKey;
                                        return (
                                            <div
                                                key={entryKey}
                                                className={`${styles.candidateRow} ${selected ? styles.candidateRowSelected : ""}`.trim()}
                                                onClick={() => setSelectedMatchKey(entryKey)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        setSelectedMatchKey(entryKey);
                                                    }
                                                }}
                                            >
                                                <input
                                                    type="radio"
                                                    name="library-metadata-selection"
                                                    checked={selected}
                                                    onChange={() => setSelectedMatchKey(entryKey)}
                                                    aria-label={`Select metadata candidate ${index + 1}`}
                                                    className={styles.candidateRadio}
                                                />
                                                <Column gap="8" style={{minWidth: 0}}>
                                                    <Row horizontal="between" vertical="center" gap="8"
                                                         style={{flexWrap: "wrap"}}>
                                                        <Text variant="body-strong-s"
                                                              wrap="balance">{s(entry.title) || "Untitled metadata result"}</Text>
                                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                                            <Badge
                                                                background="brand-alpha-weak">{s(entry.provider).toUpperCase() || "Unknown provider"}</Badge>
                                                            {typeof entry.score === "number" && Number.isFinite(entry.score) && (
                                                                <Badge
                                                                    background="neutral-alpha-weak">score {entry.score}</Badge>
                                                            )}
                                                            {entry.adultContent === true &&
                                                                <Badge background="danger-alpha-weak">adult</Badge>}
                                                        </Row>
                                                    </Row>
                                                    {s(entry.summary) &&
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">{s(entry.summary)}</Text>}
                                                    {s(entry.sourceUrl) && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            <SmartLink
                                                                href={s(entry.sourceUrl)}>{s(entry.sourceUrl)}</SmartLink>
                                                        </Text>
                                                    )}
                                                </Column>
                                            </div>
                                        );
                                    })}
                                </Column>
                            )}

                            <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    {selectedMatch ? `Selected metadata: ${s(selectedMatch.title) || s(selectedMatch.provider) || "match"}` : "No metadata candidate selected."}
                                </Text>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary"
                                            disabled={loadingMatches || applying || queue.length <= 1}
                                            onClick={skipCurrent}>
                                        Skip for now
                                    </Button>
                                    <Button variant="primary"
                                            disabled={loadingMatches || applying || selectedMatch == null}
                                            onClick={() => void applySelectedMatch()}>
                                        {applying ? "Applying..." : "Apply and continue"}
                                    </Button>
                                </Row>
                            </Row>
                        </>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
