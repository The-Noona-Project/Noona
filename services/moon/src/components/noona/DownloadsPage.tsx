"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

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

type ResolvedSearchOption = {
    optionIndex: number;
    title: string;
    href: string;
    coverUrl: string;
    type: string;
};

type RavenDownloadProgress = {
    title?: string | null;
    queuedAt?: number | null;
    totalChapters?: number | null;
    completedChapters?: number | null;
    currentChapter?: string | null;
    status?: string | null;
    startedAt?: number | null;
    completedAt?: number | null;
    errorMessage?: string | null;
    lastUpdated?: number | null;
};

type RavenDownloadSummary = {
    activeDownloads?: number;
    maxThreads?: number;
    error?: string;
};

type RavenLibrarySyncResponse = {
    message?: string | null;
    queuedChapters?: number | null;
    updatedTitles?: number | null;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const parseOptionIndex = (option: RavenSearchOption, fallbackIndex: number): number => {
    const optionIndexRaw = normalizeString(option.option_number ?? option.index).trim();
    const optionIndexParsed = optionIndexRaw ? Number(optionIndexRaw) : NaN;
    return Number.isFinite(optionIndexParsed) ? optionIndexParsed : fallbackIndex;
};
const formatEpochMs = (value: unknown): string => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    return new Date(value).toLocaleString();
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

export function DownloadsPage() {
    const [addOpen, setAddOpen] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResult, setSearchResult] = useState<RavenSearchResponse | null>(null);
    const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
    const [queueing, setQueueing] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueMessage, setQueueMessage] = useState<string | null>(null);

    const [downloads, setDownloads] = useState<RavenDownloadProgress[] | null>(null);
    const [downloadsError, setDownloadsError] = useState<string | null>(null);

    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summary, setSummary] = useState<RavenDownloadSummary | null>(null);

    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [history, setHistory] = useState<RavenDownloadProgress[]>([]);

    const [syncingLibrary, setSyncingLibrary] = useState(false);
    const [syncLibraryMessage, setSyncLibraryMessage] = useState<string | null>(null);
    const [syncLibraryError, setSyncLibraryError] = useState<string | null>(null);

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

    const pollDownloads = async () => {
        try {
            const res = await fetch("/api/noona/raven/downloads/status", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;

            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Failed to load downloads (HTTP ${res.status}).`));
            }

            setDownloads(Array.isArray(json) ? (json as RavenDownloadProgress[]) : []);
            setDownloadsError(null);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setDownloadsError(message);
        }
    };

    const loadSummary = async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/summary", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as RavenDownloadSummary | null;
            if (!res.ok) {
                setSummaryError(parseErrorMessage(json, `Failed to load summary (HTTP ${res.status}).`));
                return;
            }
            setSummary(json ?? {});
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSummaryError(message);
        } finally {
            setSummaryLoading(false);
        }
    };

    const loadHistory = async () => {
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/history", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setHistoryError(parseErrorMessage(json, `Failed to load history (HTTP ${res.status}).`));
                return;
            }
            setHistory(Array.isArray(json) ? json as RavenDownloadProgress[] : []);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setHistoryError(message);
        } finally {
            setHistoryLoading(false);
        }
    };

    const refreshAll = async () => {
        await Promise.all([pollDownloads(), loadSummary(), loadHistory()]);
    };

    useEffect(() => {
        const interval = window.setInterval(() => {
            void pollDownloads();
        }, 1500);

        void refreshAll();

        return () => {
            window.clearInterval(interval);
        };
    }, []);

    const closeAdd = () => {
        setAddOpen(false);
        setAddQuery("");
        setSearching(false);
        setSearchError(null);
        setSearchResult(null);
        setSelectedOptions([]);
        setQueueing(false);
        setQueueError(null);
        setQueueMessage(null);
    };

    const openAdd = () => {
        setAddOpen(true);
        setAddQuery("");
        setSearching(false);
        setSearchError(null);
        setSearchResult(null);
        setSelectedOptions([]);
        setQueueing(false);
        setQueueError(null);
        setQueueMessage(null);
    };

    useEffect(() => {
        if (!addOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeAdd();
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (!queueing && selectedOptions.length > 0) {
                    void queueSelectedDownloads();
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [addOpen, queueing, selectedOptions, searchResult]);

    const performSearch = async () => {
        const needle = addQuery.trim();
        if (!needle) {
            return;
        }

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

    const queueSelectedDownloads = async () => {
        const searchId = normalizeString(searchResult?.searchId).trim();
        const queueTargets = Array.from(new Set(selectedOptions));
        if (!searchId || queueTargets.length === 0) {
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

                    const json = (await res.json().catch(() => null)) as unknown;
                    if (!res.ok) {
                        throw new Error(parseErrorMessage(json, `Queue failed (HTTP ${res.status}).`));
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
                await refreshAll();
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
        } finally {
            setQueueing(false);
        }
    };

    const checkLibraryForNewChapters = async () => {
        setSyncingLibrary(true);
        setSyncLibraryMessage(null);
        setSyncLibraryError(null);

        try {
            const res = await fetch("/api/noona/raven/library/checkForNew", {
                method: "POST",
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Sync failed (HTTP ${res.status}).`));
            }

            const payload = json && typeof json === "object" ? (json as RavenLibrarySyncResponse) : null;
            const queued = typeof payload?.queuedChapters === "number" && Number.isFinite(payload.queuedChapters)
                ? payload.queuedChapters
                : null;
            const updatedTitles =
                typeof payload?.updatedTitles === "number" && Number.isFinite(payload.updatedTitles)
                    ? payload.updatedTitles
                    : null;

            const fallbackMessage =
                queued != null && queued > 0
                    ? `Queued ${queued} chapter(s) across ${updatedTitles ?? "multiple"} title(s).`
                    : "No new or missing chapters found.";

            setSyncLibraryMessage(normalizeString(payload?.message).trim() || fallbackMessage);
            await refreshAll();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSyncLibraryError(message);
        } finally {
            setSyncingLibrary(false);
        }
    };

    const activeDownloads = useMemo(() => {
        const list = downloads ?? [];
        return list.filter((entry) => {
            const status = normalizeString(entry.status).trim().toLowerCase();
            return status !== "completed" && status !== "failed" && status !== "error" && status !== "cancelled" && status !== "canceled";
        });
    }, [downloads]);

    return (
        <SetupModeGate>
            <AuthGate>
                <Column fillWidth maxWidth={120} horizontal="center" gap="16" paddingY="24" paddingX="16"
                        m={{paddingX: "24"}}>
                    <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                Downloads
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Queue new titles, monitor active downloads, and review Raven history.
                            </Text>
                        </Column>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="primary" onClick={() => openAdd()}>
                                Add download
                            </Button>
                            <Button variant="secondary" onClick={() => void checkLibraryForNewChapters()}
                                    disabled={syncingLibrary}>
                                {syncingLibrary ? "Checking..." : "Check new/missing"}
                            </Button>
                            <Button variant="secondary" onClick={() => void refreshAll()}>
                                Refresh
                            </Button>
                            <Button variant="secondary" href="/libraries">
                                Open library
                            </Button>
                        </Row>
                    </Row>

                    {(syncLibraryError || syncLibraryMessage) && (
                        <Card
                            fillWidth
                            background="surface"
                            border={syncLibraryError ? "danger-alpha-weak" : "neutral-alpha-weak"}
                            padding="m"
                            radius="l"
                        >
                            <Text
                                variant="body-default-xs"
                                onBackground={syncLibraryError ? "danger-strong" : "neutral-weak"}
                                wrap="balance"
                            >
                                {syncLibraryError || syncLibraryMessage}
                            </Text>
                        </Card>
                    )}

                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Active downloads
                                </Heading>
                                <Button variant="secondary" onClick={() => void pollDownloads()}>
                                    Refresh status
                                </Button>
                            </Row>

                            {downloadsError && (
                                <Text onBackground="danger-strong" variant="body-default-xs">
                                    {downloadsError}
                                </Text>
                            )}

                            {!downloads && !downloadsError && (
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Loading download status...
                                </Text>
                            )}

                            {downloads && activeDownloads.length === 0 && (
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    No active downloads.
                                </Text>
                            )}

                            {downloads && activeDownloads.length > 0 && (
                                <Column gap="8">
                                    {activeDownloads.map((entry, idx) => {
                                        const titleName = normalizeString(entry.title).trim() || "Untitled";
                                        const statusRaw = normalizeString(entry.status).trim() || "unknown";
                                        const status = statusRaw.toLowerCase();
                                        const current = normalizeString(entry.currentChapter).trim();
                                        const errorMessage = normalizeString(entry.errorMessage).trim();

                                        const total =
                                            typeof entry.totalChapters === "number" && Number.isFinite(entry.totalChapters)
                                                ? entry.totalChapters
                                                : 0;
                                        const completed =
                                            typeof entry.completedChapters === "number" && Number.isFinite(entry.completedChapters)
                                                ? entry.completedChapters
                                                : 0;

                                        const percent = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;

                                        const badgeBackground =
                                            status === "completed"
                                                ? "success-alpha-weak"
                                                : status === "failed"
                                                    ? "danger-alpha-weak"
                                                    : status === "downloading"
                                                        ? "brand-alpha-weak"
                                                        : "neutral-alpha-weak";

                                        const barBackground =
                                            status === "completed"
                                                ? "success-alpha-medium"
                                                : status === "failed"
                                                    ? "danger-alpha-medium"
                                                    : "brand-alpha-medium";

                                        return (
                                            <Card
                                                key={`${titleName}-${typeof entry.queuedAt === "number" ? entry.queuedAt : statusRaw}-${idx}`}
                                                fillWidth
                                                background="surface"
                                                border="neutral-alpha-weak"
                                                padding="m"
                                                radius="l"
                                            >
                                                <Column gap="12">
                                                    <Row horizontal="between" vertical="center" gap="12">
                                                        <Text variant="heading-default-s" wrap="balance">
                                                            {titleName}
                                                        </Text>
                                                        <Badge background={badgeBackground}
                                                               onBackground="neutral-strong">
                                                            {statusRaw}
                                                        </Badge>
                                                    </Row>

                                                    {(total > 0 || completed > 0) && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            Chapters: {completed}/{total || "?"}
                                                        </Text>
                                                    )}

                                                    {current && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            Current: {current}
                                                        </Text>
                                                    )}

                                                    {status === "failed" && errorMessage && (
                                                        <Text onBackground="danger-strong" variant="body-default-xs"
                                                              wrap="balance">
                                                            {errorMessage}
                                                        </Text>
                                                    )}

                                                    <Row
                                                        fillWidth
                                                        background="neutral-alpha-weak"
                                                        radius="l"
                                                        style={{height: 8, overflow: "hidden"}}
                                                    >
                                                        <Row
                                                            background={barBackground}
                                                            radius="l"
                                                            style={{
                                                                width: status === "queued" ? "12%" : `${percent}%`,
                                                                height: "100%",
                                                                minWidth: status === "queued" ? 18 : 0,
                                                            }}
                                                        />
                                                    </Row>
                                                </Column>
                                            </Card>
                                        );
                                    })}
                                </Column>
                            )}
                        </Column>
                    </Card>

                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="8">
                            <Row horizontal="between" vertical="center">
                                <Heading as="h3" variant="heading-strong-l">Download workers</Heading>
                                <Button variant="secondary" disabled={summaryLoading}
                                        onClick={() => void loadSummary()}>
                                    Refresh
                                </Button>
                            </Row>
                            {summaryError && <Text onBackground="danger-strong"
                                                   variant="body-default-xs">{summaryError}</Text>}
                            {summaryLoading && (
                                <Row fillWidth horizontal="center" paddingY="12">
                                    <Spinner/>
                                </Row>
                            )}
                            {!summaryLoading && (
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        active: {typeof summary?.activeDownloads === "number" ? summary.activeDownloads : 0}
                                    </Badge>
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        max
                                        threads: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                                    </Badge>
                                </Row>
                            )}
                        </Column>
                    </Card>

                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="8" id="raven-history">
                            <Row horizontal="between" vertical="center">
                                <Heading as="h3" variant="heading-strong-l">Download history</Heading>
                                <Button variant="secondary" disabled={historyLoading}
                                        onClick={() => void loadHistory()}>
                                    Refresh
                                </Button>
                            </Row>
                            {historyError && <Text onBackground="danger-strong"
                                                   variant="body-default-xs">{historyError}</Text>}
                            {historyLoading && (
                                <Row fillWidth horizontal="center" paddingY="12">
                                    <Spinner/>
                                </Row>
                            )}
                            {!historyLoading && history.length === 0 && (
                                <Text onBackground="neutral-weak" variant="body-default-xs">No history yet.</Text>
                            )}
                            {!historyLoading && history.length > 0 && (
                                <Column gap="8">
                                    {history.map((entry, index) => {
                                        const title = normalizeString(entry.title).trim() || "Untitled";
                                        const status = normalizeString(entry.status).trim() || "unknown";
                                        const total = typeof entry.totalChapters === "number" && Number.isFinite(entry.totalChapters) ? entry.totalChapters : 0;
                                        const done = typeof entry.completedChapters === "number" && Number.isFinite(entry.completedChapters) ? entry.completedChapters : 0;
                                        return (
                                            <Card key={`${title}-${index}`} fillWidth background="surface"
                                                  border="neutral-alpha-weak" padding="m" radius="l">
                                                <Column gap="8">
                                                    <Row horizontal="between" vertical="center" gap="12"
                                                         style={{flexWrap: "wrap"}}>
                                                        <Text variant="heading-default-s"
                                                              wrap="balance">{title}</Text>
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">{status}</Badge>
                                                    </Row>
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-xs">Chapters: {done}/{total || "?"}</Text>
                                                    {formatEpochMs(entry.completedAt) && (
                                                        <Text onBackground="neutral-weak"
                                                              variant="body-default-xs">Completed: {formatEpochMs(entry.completedAt)}</Text>
                                                    )}
                                                    {normalizeString(entry.errorMessage).trim() && (
                                                        <Text onBackground="danger-strong"
                                                              variant="body-default-xs">{normalizeString(entry.errorMessage).trim()}</Text>
                                                    )}
                                                </Column>
                                            </Card>
                                        );
                                    })}
                                </Column>
                            )}
                        </Column>
                    </Card>

                    {addOpen && (
                        <Row
                            fillWidth
                            fillHeight
                            role="presentation"
                            onClick={(event) => {
                                if (event.target === event.currentTarget) {
                                    closeAdd();
                                }
                            }}
                            horizontal="center"
                            vertical="center"
                            style={{
                                position: "fixed",
                                inset: 0,
                                background: "rgba(3, 8, 18, 0.76)",
                                backdropFilter: "blur(6px)",
                                zIndex: 70,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "clamp(12px, 2vw, 28px)",
                            }}
                        >
                            <Card
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="0"
                                radius="l"
                                fillWidth
                                style={{
                                    width: "min(960px, 100%)",
                                    maxHeight: "min(90vh, 920px)",
                                    overflow: "hidden",
                                }}
                            >
                                <Column fillHeight gap="0" style={{minHeight: 0}}>
                                    <Row
                                        horizontal="between"
                                        vertical="center"
                                        gap="12"
                                        paddingX="l"
                                        paddingY="m"
                                        style={{flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,0.1)"}}
                                    >
                                        <Column gap="4" style={{minWidth: 0}}>
                                            <Heading as="h2" variant="heading-strong-l">
                                                Add download
                                            </Heading>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                Search a title, select one or more results, then queue in one action.
                                            </Text>
                                        </Column>
                                        <Button variant="secondary" onClick={() => closeAdd()} disabled={queueing}>
                                            Close
                                        </Button>
                                    </Row>

                                    <Column
                                        gap="16"
                                        paddingX="l"
                                        paddingY="m"
                                        style={{overflowY: "auto", minHeight: 0}}
                                    >
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Input
                                                id="add-title-query"
                                                name="add-title-query"
                                                type="text"
                                                placeholder="Search titles (ex: Absolute Duo)"
                                                value={addQuery}
                                                onChange={(e) => setAddQuery(e.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        void performSearch();
                                                    }
                                                }}
                                            />
                                            <Button
                                                variant="primary"
                                                disabled={searching || !addQuery.trim()}
                                                onClick={() => void performSearch()}
                                            >
                                                {searching ? "Searching..." : "Search"}
                                            </Button>
                                        </Row>

                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Press `Enter` to search and `Ctrl+Enter` to queue selected results.
                                        </Text>

                                        {searchError && (
                                            <Text onBackground="danger-strong" variant="body-default-xs">
                                                {searchError}
                                            </Text>
                                        )}

                                        {searching && (
                                            <Row fillWidth horizontal="center" paddingY="24">
                                                <Spinner/>
                                            </Row>
                                        )}

                                        {searchResult && (
                                            <Column gap="12">
                                                <Row horizontal="between" vertical="center" gap="12"
                                                     style={{flexWrap: "wrap"}}>
                                                    <Heading as="h3" variant="heading-strong-m">
                                                        Results
                                                    </Heading>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        {resolvedSearchOptions.length} found, {selectedOptions.length} selected
                                                    </Text>
                                                </Row>

                                                {resolvedSearchOptions.length === 0 && (
                                                    <Text onBackground="neutral-weak">No results found.</Text>
                                                )}

                                                {resolvedSearchOptions.length > 0 && (
                                                    <Column gap="8">
                                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                                            <Button
                                                                variant="secondary"
                                                                disabled={queueing || resolvedSearchOptions.length === 0}
                                                                onClick={() => selectAllOptions()}
                                                            >
                                                                Select all
                                                            </Button>
                                                            <Button
                                                                variant="secondary"
                                                                disabled={queueing || selectedOptions.length === 0}
                                                                onClick={() => clearSelectedOptions()}
                                                            >
                                                                Clear selection
                                                            </Button>
                                                        </Row>

                                                        <Column gap="8" style={{maxHeight: "45vh", overflowY: "auto"}}>
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
                                                                        style={{cursor: "pointer"}}
                                                                        onClick={() => toggleSelectedOption(option.optionIndex)}
                                                                    >
                                                                        <Column gap="8">
                                                                            <Row horizontal="between" vertical="center"
                                                                                 gap="12">
                                                                                <Row gap="12" vertical="center"
                                                                                     style={{minWidth: 0}}>
                                                                                    {option.coverUrl && (
                                                                                        <img
                                                                                            src={option.coverUrl}
                                                                                            alt={`${option.title || `Option ${option.optionIndex}`} cover`}
                                                                                            style={{
                                                                                                width: 44,
                                                                                                height: 66,
                                                                                                objectFit: "cover",
                                                                                                borderRadius: 10,
                                                                                                border: "1px solid rgba(255,255,255,0.12)",
                                                                                                flex: "0 0 auto",
                                                                                            }}
                                                                                            loading="lazy"
                                                                                        />
                                                                                    )}
                                                                                    <Column gap="8"
                                                                                            style={{minWidth: 0}}>
                                                                                        <Text
                                                                                            variant="heading-default-s"
                                                                                            wrap="balance">
                                                                                            {option.title || `Option ${option.optionIndex}`}
                                                                                        </Text>
                                                                                        {option.type && (
                                                                                            <Row>
                                                                                                <Badge
                                                                                                    background="neutral-alpha-weak"
                                                                                                    onBackground="neutral-strong">
                                                                                                    {option.type}
                                                                                                </Badge>
                                                                                            </Row>
                                                                                        )}
                                                                                    </Column>
                                                                                </Row>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    name="download-source"
                                                                                    checked={checked}
                                                                                    onClick={(event) => event.stopPropagation()}
                                                                                    onChange={() => toggleSelectedOption(option.optionIndex)}
                                                                                    aria-label={`Select option ${option.optionIndex}`}
                                                                                />
                                                                            </Row>
                                                                            {option.href && (
                                                                                <Text onBackground="neutral-weak"
                                                                                      variant="body-default-xs">
                                                                                    Source:{" "}
                                                                                    <SmartLink
                                                                                        href={option.href}
                                                                                        onClick={(event) => event.stopPropagation()}
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

                                                        <Row gap="12" style={{flexWrap: "wrap"}}>
                                                            <Button
                                                                variant="primary"
                                                                disabled={queueing || selectedOptions.length === 0}
                                                                onClick={() => void queueSelectedDownloads()}
                                                            >
                                                                {queueing ? "Queueing..." : `Queue selected (${selectedOptions.length})`}
                                                            </Button>
                                                            {queueMessage && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">
                                                                    {queueMessage}
                                                                </Text>
                                                            )}
                                                            {queueError && (
                                                                <Text onBackground="danger-strong"
                                                                      variant="body-default-xs">
                                                                    {queueError}
                                                                </Text>
                                                            )}
                                                        </Row>
                                                    </Column>
                                                )}
                                            </Column>
                                        )}
                                    </Column>
                                </Column>
                            </Card>
                        </Row>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
