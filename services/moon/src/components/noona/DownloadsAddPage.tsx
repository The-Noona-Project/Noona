"use client";

import {type MouseEvent, useEffect, useEffectEvent, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {AuthGate} from "./AuthGate";
import {SetupModeGate} from "./SetupModeGate";
import {interpretRavenQueueResponse} from "./downloadQueueResults.mjs";
import styles from "./DownloadsPage.module.scss";

type RavenSearchOption = {
    index?: string | null;
    option_number?: string | null;
    title?: string | null;
    href?: string | null;
    coverUrl?: string | null;
    type?: string | null;
};

type RavenSearchResponse = {
    searchId?: string | null;
    options?: RavenSearchOption[] | null;
};

type RavenQueueResponse = {
    status?: string | null;
    message?: string | null;
    error?: string | null;
};

type ResolvedSearchOption = {
    optionIndex: number;
    title: string;
    href: string;
    coverUrl: string;
    type: string;
};

const RECENT_DOWNLOAD_SEARCHES_KEY = "moon-recent-download-searches";
const RECENT_DOWNLOAD_SEARCH_LIMIT = 6;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const parseOptionIndex = (option: RavenSearchOption, fallbackIndex: number): number => {
    const optionIndexRaw = normalizeString(option.option_number ?? option.index).trim();
    const optionIndexParsed = optionIndexRaw ? Number(optionIndexRaw) : NaN;
    return Number.isFinite(optionIndexParsed) ? optionIndexParsed : fallbackIndex;
};
const parseErrorMessage = (json: unknown, fallback: string): string => {
    if (json && typeof json === "object" && "error" in json && typeof (json as {
        error?: unknown
    }).error === "string") {
        const message = normalizeString((json as { error?: unknown }).error).trim();
        if (message) return message;
    }
    return fallback;
};

const normalizeRecentSearches = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const entry of value) {
        const query = normalizeString(entry).trim();
        if (!query) continue;
        const key = query.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(query);
        if (normalized.length >= RECENT_DOWNLOAD_SEARCH_LIMIT) break;
    }

    return normalized;
};

type DownloadsAddPageProps = {
    initialQuery?: string;
};

export function DownloadsAddPage({initialQuery = ""}: DownloadsAddPageProps) {
    const router = useRouter();
    const [addQuery, setAddQuery] = useState(initialQuery.trim());
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResult, setSearchResult] = useState<RavenSearchResponse | null>(null);
    const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
    const [queueing, setQueueing] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueMessage, setQueueMessage] = useState<string | null>(null);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    const resolvedSearchOptions = useMemo<ResolvedSearchOption[]>(() => {
        if (!Array.isArray(searchResult?.options)) return [];
        return searchResult.options.map((option, idx) => {
            const optionIndex = parseOptionIndex(option, idx + 1);
            return {
                optionIndex,
                title: normalizeString(option?.title).trim(),
                href: normalizeString(option?.href).trim(),
                coverUrl: normalizeString(option?.coverUrl).trim(),
                type: normalizeString(option?.type).trim(),
            };
        });
    }, [searchResult]);

    const selectedOptionSet = useMemo(() => new Set<number>(selectedOptions), [selectedOptions]);
    const searchResultCount = resolvedSearchOptions.length;
    const selectedCount = selectedOptions.length;
    const hasSearchResult = searchResult != null;

    const rememberQuery = (query: string) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery || typeof window === "undefined") {
            return;
        }

        setRecentSearches((current) => {
            const normalized = normalizeRecentSearches([trimmedQuery, ...current]);
            window.localStorage.setItem(RECENT_DOWNLOAD_SEARCHES_KEY, JSON.stringify(normalized));
            return normalized;
        });
    };

    useEffect(() => {
        const focusTimer = window.setTimeout(() => {
            const input = document.getElementById("add-title-query");
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.select();
            }
        }, 40);

        const rawRecentSearches = window.localStorage.getItem(RECENT_DOWNLOAD_SEARCHES_KEY);
        if (rawRecentSearches) {
            try {
                const parsed = JSON.parse(rawRecentSearches) as unknown;
                setRecentSearches(normalizeRecentSearches(parsed));
            } catch {
                setRecentSearches([]);
            }
        }

        return () => {
            window.clearTimeout(focusTimer);
        };
    }, []);

    const performSearch = async (queryOverride?: string) => {
        const needle = normalizeString(queryOverride ?? addQuery).trim();
        if (!needle) {
            return;
        }

        setAddQuery(needle);
        setSearching(true);
        setSearchError(null);
        setSearchResult(null);
        setSelectedOptions([]);
        setQueueError(null);
        setQueueMessage(null);

        try {
            const res = await fetch("/api/noona/raven/search", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({query: needle}),
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Search failed (HTTP ${res.status}).`));
            }

            const payload = json && typeof json === "object" ? (json as RavenSearchResponse) : null;
            setSearchResult(payload);
            rememberQuery(needle);

            const options = Array.isArray(payload?.options) ? payload.options : [];
            if (options.length === 1) {
                setSelectedOptions([parseOptionIndex(options[0], 1)]);
            } else {
                setSelectedOptions([]);
            }
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSearchError(message);
        } finally {
            setSearching(false);
        }
    };

    const toggleSelectedOption = (optionIndex: number) => {
        setSelectedOptions((prev) => (
            prev.includes(optionIndex)
                ? prev.filter((entry) => entry !== optionIndex)
                : [...prev, optionIndex]
        ));
    };

    const selectAllOptions = () => {
        setSelectedOptions(resolvedSearchOptions.map((entry) => entry.optionIndex));
    };

    const clearSelectedOptions = () => {
        setSelectedOptions([]);
    };

    const resetSearchState = () => {
        setSearchError(null);
        setSearchResult(null);
        setSelectedOptions([]);
        setQueueError(null);
        setQueueMessage(null);
    };

    const queueSelectedDownloads = async ({
                                              optionIndexes,
                                              returnToDownloads = false,
                                          }: {
        optionIndexes?: number[];
        returnToDownloads?: boolean;
    } = {}) => {
        const searchId = normalizeString(searchResult?.searchId).trim();
        const queueTargets = Array.from(new Set(optionIndexes ?? selectedOptions));
        if (!searchId || queueTargets.length === 0 || queueing) {
            return;
        }

        setQueueing(true);
        setQueueError(null);
        setQueueMessage(null);

        let successCount = 0;
        const failedOptionIndexes = new Set<number>();
        const failures: string[] = [];
        const optionByIndex = new Map<number, ResolvedSearchOption>();
        for (const option of resolvedSearchOptions) {
            optionByIndex.set(option.optionIndex, option);
        }

        try {
            for (const optionIndex of queueTargets) {
                try {
                    const res = await fetch("/api/noona/raven/download", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({searchId, optionIndex}),
                    });

                    const json = (await res.json().catch(() => null)) as RavenQueueResponse | null;
                    const queueResult = interpretRavenQueueResponse({
                        httpStatus: res.status,
                        payload: json,
                        fallbackMessage: parseErrorMessage(json, `Queue failed (HTTP ${res.status}).`),
                    });
                    if (!queueResult.accepted) {
                        throw new Error(queueResult.message);
                    }
                    successCount += 1;
                } catch (error_) {
                    const message = error_ instanceof Error ? error_.message : String(error_);
                    const label = optionByIndex.get(optionIndex)?.title || `Option ${optionIndex}`;
                    failedOptionIndexes.add(optionIndex);
                    failures.push(`${label}: ${message}`);
                }
            }

            if (successCount > 0) {
                const downloadWord = successCount === 1 ? "download" : "downloads";
                const failedText = failures.length > 0 ? ` (${failures.length} failed)` : "";
                setQueueMessage(`Queued ${successCount} ${downloadWord}${failedText}.`);
            }

            if (failures.length > 0) {
                const extraCount = failures.length - 1;
                const extraText = extraCount > 0 ? ` (+${extraCount} more)` : "";
                setQueueError(`${failures[0]}${extraText}`);
            }

            if (failedOptionIndexes.size > 0) {
                setSelectedOptions(Array.from(failedOptionIndexes));
            } else {
                setSelectedOptions([]);
            }

            if (returnToDownloads && successCount > 0 && failures.length === 0) {
                router.push("/downloads");
            }
        } finally {
            setQueueing(false);
        }
    };

    const handleKeyboardShortcut = useEffectEvent((event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (!queueing && selectedOptions.length > 0) {
                void queueSelectedDownloads();
            }
        }
    });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            handleKeyboardShortcut(event);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <SetupModeGate>
            <AuthGate requiredPermission="download_management"
                      deniedMessage="Downloads access requires Download management permission.">
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    paddingX="16"
                    style={{maxWidth: "var(--moon-page-max-width-narrow, 92rem)"}}
                    className={styles.pageShell}
                    m={{style: {paddingInline: "24px"}}}
                >
                    <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                Add download
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Search Raven, pick source entries, and queue titles without leaving the downloads
                                workflow.
                            </Text>
                        </Column>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" href="/downloads">
                                Back to downloads
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={!hasSearchResult && !searchError}
                                onClick={() => resetSearchState()}
                            >
                                Clear results
                            </Button>
                        </Row>
                    </Row>

                    <Card
                        fillWidth
                        background="surface"
                        border="neutral-alpha-weak"
                        padding="l"
                        radius="l"
                        className={`${styles.sectionCard} ${styles.heroPanel}`}
                    >
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Column gap="4" style={{minWidth: 0}}>
                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                        Download flow
                                    </Text>
                                    <Text variant="body-default-s" wrap="balance">
                                        Press <span className={styles.shortcutKey}>Enter</span> to search and{" "}
                                        <span className={styles.shortcutKey}>Ctrl+Enter</span> to queue selected
                                        results.
                                    </Text>
                                </Column>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        {searchResultCount} results
                                    </Badge>
                                    <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                        {selectedCount} selected
                                    </Badge>
                                </Row>
                            </Row>

                            {recentSearches.length > 0 && (
                                <Column gap="8">
                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                        Recent searches
                                    </Text>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        {recentSearches.map((query) => (
                                            <Button
                                                key={query}
                                                size="s"
                                                variant="secondary"
                                                onClick={() => void performSearch(query)}
                                            >
                                                {query}
                                            </Button>
                                        ))}
                                    </Row>
                                </Column>
                            )}
                        </Column>
                    </Card>

                    <Card
                        fillWidth
                        background="surface"
                        border="neutral-alpha-weak"
                        padding="l"
                        radius="l"
                        className={`${styles.sectionCard} ${styles.searchPanel}`}
                    >
                        <Column gap="12">
                            <Column gap="4">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Search title
                                </Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Start with the series name, then select the exact source options you want to queue.
                                </Text>
                            </Column>
                            <Row gap="8" style={{flexWrap: "wrap", alignItems: "flex-end"}}>
                                <Column fillWidth style={{flex: "1 1 420px"}}>
                                    <Input
                                        id="add-title-query"
                                        name="add-title-query"
                                        type="text"
                                        label="Search query"
                                        placeholder="Absolute Duo"
                                        value={addQuery}
                                        onChange={(event) => setAddQuery(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                void performSearch();
                                            }
                                        }}
                                    />
                                </Column>
                                <Button
                                    variant="primary"
                                    disabled={searching || !addQuery.trim()}
                                    onClick={() => void performSearch()}
                                >
                                    {searching ? "Searching..." : "Search Raven"}
                                </Button>
                            </Row>
                            {searchError && (
                                <Card fillWidth background="surface" border="danger-alpha-weak" padding="m" radius="l">
                                    <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                        {searchError}
                                    </Text>
                                </Card>
                            )}
                            {!hasSearchResult && !searching && !searchError && (
                                <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                    <Column gap="8">
                                        <Text variant="body-default-s">Ready to search.</Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Search once, review the source options, then queue only the entries you
                                            want.
                                        </Text>
                                    </Column>
                                </Card>
                            )}
                        </Column>
                    </Card>

                    {searching && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l"
                              className={styles.sectionCard}>
                            <Row fillWidth horizontal="center" vertical="center" gap="12" paddingY="12">
                                <Spinner/>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Searching Raven sources...
                                </Text>
                            </Row>
                        </Card>
                    )}

                    {hasSearchResult && (
                        <Card
                            fillWidth
                            background="surface"
                            border="neutral-alpha-weak"
                            padding="0"
                            radius="l"
                            className={`${styles.sectionCard} ${styles.resultsPanel}`}
                        >
                            <Column gap="0">
                                <Column gap="12" padding="l">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4">
                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                Search results
                                            </Text>
                                            <Heading as="h2" variant="heading-strong-l">
                                                Pick source entries
                                            </Heading>
                                        </Column>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Button
                                                variant="secondary"
                                                disabled={queueing || searchResultCount === 0}
                                                onClick={selectAllOptions}
                                            >
                                                Select all
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                disabled={queueing || selectedCount === 0}
                                                onClick={clearSelectedOptions}
                                            >
                                                Clear selection
                                            </Button>
                                        </Row>
                                    </Row>

                                    {searchResultCount === 0 && (
                                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m"
                                              radius="l">
                                            <Column gap="8">
                                                <Text variant="body-default-s">No matches found.</Text>
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    Try a shorter title, an alternate romanization, or a broader query.
                                                </Text>
                                            </Column>
                                        </Card>
                                    )}

                                    {searchResultCount > 0 && (
                                        <Column gap="8" className={styles.resultsViewport}>
                                            {resolvedSearchOptions.map((option) => {
                                                const checked = selectedOptionSet.has(option.optionIndex);

                                                return (
                                                    <Card
                                                        key={`${option.optionIndex}-${option.title || option.href}`}
                                                        background="surface"
                                                        border={checked ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                        padding="m"
                                                        radius="l"
                                                        fillWidth
                                                        className={`${styles.resultCard} ${checked ? styles.resultCardSelected : ""}`}
                                                        onClick={() => toggleSelectedOption(option.optionIndex)}
                                                    >
                                                        <Column gap="8">
                                                            <Row horizontal="between" vertical="center" gap="12">
                                                                <Row gap="12" vertical="center" style={{minWidth: 0}}>
                                                                    {option.coverUrl && (
                                                                        // eslint-disable-next-line @next/next/no-img-element -- Raven cover URLs come from arbitrary remote hosts.
                                                                        <img
                                                                            src={option.coverUrl}
                                                                            alt={`${option.title || `Option ${option.optionIndex}`} cover`}
                                                                            className={styles.coverThumb}
                                                                            loading="lazy"
                                                                        />
                                                                    )}
                                                                    <Column gap="8" style={{minWidth: 0}}>
                                                                        <Text variant="heading-default-s"
                                                                              wrap="balance">
                                                                            {option.title || `Option ${option.optionIndex}`}
                                                                        </Text>
                                                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                                                            <Badge
                                                                                background={checked ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                                                onBackground="neutral-strong">
                                                                                Option {option.optionIndex}
                                                                            </Badge>
                                                                            {option.type && (
                                                                                <Badge
                                                                                    background="neutral-alpha-weak"
                                                                                    onBackground="neutral-strong">
                                                                                    {option.type}
                                                                                </Badge>
                                                                            )}
                                                                        </Row>
                                                                    </Column>
                                                                </Row>
                                                                <input
                                                                    type="checkbox"
                                                                    name="download-source"
                                                                    checked={checked}
                                                                    className={styles.selectionCheckbox}
                                                                    onClick={(event: MouseEvent<HTMLInputElement>) => event.stopPropagation()}
                                                                    onChange={() => toggleSelectedOption(option.optionIndex)}
                                                                    aria-label={`Select option ${option.optionIndex}`}
                                                                />
                                                            </Row>

                                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                                <Button
                                                                    size="s"
                                                                    variant="secondary"
                                                                    disabled={queueing}
                                                                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                                                                        event.stopPropagation();
                                                                        void queueSelectedDownloads({optionIndexes: [option.optionIndex]});
                                                                    }}
                                                                >
                                                                    Queue only this
                                                                </Button>
                                                            </Row>

                                                            {option.href && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs"
                                                                      wrap="balance">
                                                                    Source:{" "}
                                                                    <SmartLink
                                                                        href={option.href}
                                                                        onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
                                                                    >
                                                                        {option.href}
                                                                    </SmartLink>
                                                                </Text>
                                                            )}
                                                        </Column>
                                                    </Card>
                                                );
                                            })}
                                        </Column>
                                    )}
                                </Column>

                                {searchResultCount > 0 && (
                                    <Row
                                        horizontal="between"
                                        vertical="center"
                                        gap="12"
                                        paddingX="l"
                                        paddingY="m"
                                        className={styles.queueBar}
                                        style={{flexWrap: "wrap"}}
                                    >
                                        <Column gap="4" style={{minWidth: 0}}>
                                            <Text variant="body-default-s">
                                                {selectedCount === 0
                                                    ? "Select at least one result to queue."
                                                    : `${selectedCount} result${selectedCount === 1 ? "" : "s"} ready to queue.`}
                                            </Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                Tip: use <span className={styles.shortcutKey}>Ctrl+Enter</span> to queue
                                                selected entries.
                                            </Text>
                                            {queueMessage && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    {queueMessage}
                                                </Text>
                                            )}
                                            {queueError && (
                                                <Text onBackground="danger-strong" variant="body-default-xs"
                                                      wrap="balance">
                                                    {queueError}
                                                </Text>
                                            )}
                                        </Column>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Button
                                                variant="secondary"
                                                disabled={queueing || selectedCount === 0}
                                                onClick={() => void queueSelectedDownloads({returnToDownloads: true})}
                                            >
                                                {queueing ? "Queueing..." : "Queue + back"}
                                            </Button>
                                            <Button
                                                variant="primary"
                                                disabled={queueing || selectedCount === 0}
                                                onClick={() => void queueSelectedDownloads()}
                                            >
                                                {queueing ? "Queueing..." : `Queue selected (${selectedCount})`}
                                            </Button>
                                        </Row>
                                    </Row>
                                )}
                            </Column>
                        </Card>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
