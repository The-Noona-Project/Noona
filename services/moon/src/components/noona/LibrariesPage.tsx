"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type RavenTitle = {
    title?: string | null;
    titleName?: string | null;
    uuid?: string | null;
    sourceUrl?: string | null;
    lastDownloaded?: string | null;
    coverUrl?: string | null;
    type?: string | null;
    chapterCount?: number | null;
    chaptersDownloaded?: number | null;
};

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

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LibrariesPage() {
    const router = useRouter();
    const [titles, setTitles] = useState<RavenTitle[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("All");

    const [addOpen, setAddOpen] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResult, setSearchResult] = useState<RavenSearchResponse | null>(null);
    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [queueing, setQueueing] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueMessage, setQueueMessage] = useState<string | null>(null);

    const [downloads, setDownloads] = useState<RavenDownloadProgress[] | null>(null);
    const [downloadsError, setDownloadsError] = useState<string | null>(null);

    const load = async () => {
        setError(null);
        setTitles(null);

        try {
            const res = await fetch("/api/noona/raven/library", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;

            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Failed to load library (HTTP ${res.status}).`;
                throw new Error(message);
            }

            if (Array.isArray(json)) {
                setTitles(json as RavenTitle[]);
                return;
            }

            setTitles([]);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const libraryTabs = useMemo(() => {
        const list = titles ?? [];
        const counts = new Map<string, number>();

        for (const entry of list) {
            const raw = normalizeString(entry?.type).trim();
            const key = raw || "Unknown";
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        const sorted = Array.from(counts.keys()).filter((key) => key !== "Unknown");
        sorted.sort((a, b) => a.localeCompare(b));

        if (counts.has("Unknown")) {
            sorted.push("Unknown");
        }

        return ["All", ...sorted];
    }, [titles]);

    useEffect(() => {
        if (!libraryTabs.includes(typeFilter)) {
            setTypeFilter("All");
        }
    }, [libraryTabs, typeFilter]);

    const pollDownloads = async () => {
        try {
            const res = await fetch("/api/noona/raven/downloads/status", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;

            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Failed to load downloads (HTTP ${res.status}).`;
                throw new Error(message);
            }

            setDownloads(Array.isArray(json) ? (json as RavenDownloadProgress[]) : []);
            setDownloadsError(null);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setDownloadsError(message);
        }
    };

    useEffect(() => {
        const interval = window.setInterval(() => {
            void pollDownloads();
        }, 1500);

        void pollDownloads();

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
        setSelectedOption(null);
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
        setSelectedOption(null);
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
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [addOpen]);

    const performSearch = async () => {
        const needle = addQuery.trim();
        if (!needle) {
            return;
        }

        setSearching(true);
        setSearchError(null);
        setSearchResult(null);
        setSelectedOption(null);
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
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Search failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            setSearchResult(json && typeof json === "object" ? (json as RavenSearchResponse) : null);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSearchError(message);
        } finally {
            setSearching(false);
        }
    };

    const queueDownload = async () => {
        const searchId = normalizeString(searchResult?.searchId).trim();
        if (!searchId || selectedOption == null) {
            return;
        }

        setQueueing(true);
        setQueueError(null);
        setQueueMessage(null);

        try {
            const res = await fetch("/api/noona/raven/download", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({searchId, optionIndex: selectedOption}),
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Queue failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            setQueueMessage("Download queued. Raven will add the title to your library as it runs.");
            void load();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setQueueError(message);
        } finally {
            setQueueing(false);
        }
    };

    const filtered = useMemo(() => {
        const list = titles ?? [];
        const needle = query.trim().toLowerCase();
        const normalizedType = typeFilter === "All" ? "" : typeFilter.trim().toLowerCase();

        return list.filter((entry) => {
            if (normalizedType) {
                const rawType = normalizeString(entry.type).trim();
                const entryType = rawType ? rawType.toLowerCase() : "unknown";

                if (normalizedType === "unknown") {
                    if (rawType) return false;
                } else if (entryType !== normalizedType) {
                    return false;
                }
            }

            if (!needle) {
                return true;
            }

            const title = normalizeString(entry.title ?? entry.titleName).toLowerCase();
            const uuid = normalizeString(entry.uuid).toLowerCase();
            return title.includes(needle) || uuid.includes(needle);
        });
    }, [query, titles, typeFilter]);

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
                <Column maxWidth="l" horizontal="center" gap="16" paddingY="24">
                <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                    <Column gap="4" style={{minWidth: 0}}>
                        <Heading variant="display-strong-s" wrap="balance">
                            Library
                        </Heading>
                        <Text onBackground="neutral-weak" wrap="balance">
                            Titles tracked by Raven. Click a card to view downloaded files.
                        </Text>
                    </Column>
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="primary" onClick={() => openAdd()}>
                            Add to library
                        </Button>
                        <Button variant="secondary" onClick={() => void load()}>
                            Refresh
                        </Button>
                    </Row>
                </Row>

                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        {libraryTabs.map((value) => (
                            <Button
                                key={value}
                                variant={typeFilter === value ? "primary" : "secondary"}
                                onClick={() => setTypeFilter(value)}
                            >
                                {value}
                            </Button>
                        ))}
                    </Row>

                <Input
                    id="library-search"
                    name="library-search"
                    type="text"
                    placeholder="Search titles..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />

                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Downloads
                                </Heading>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary" onClick={() => void pollDownloads()}>
                                        Refresh
                                    </Button>
                                    <Button variant="secondary" onClick={() => router.push("/settings?tab=raven")}>
                                        Download history
                                    </Button>
                                </Row>
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
                                <Column gap="8">
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        No active downloads.
                                    </Text>
                                    <Button variant="secondary" onClick={() => router.push("/settings?tab=raven")}>
                                        View download history
                                    </Button>
                                </Column>
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

                {error && (
                    <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                        <Column gap="8">
                            <Heading as="h2" variant="heading-strong-l">
                                Raven unavailable
                            </Heading>
                            <Text>{error}</Text>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Ensure `noona-raven` is installed and running.
                            </Text>
                        </Column>
                    </Card>
                )}

                {!titles && !error && (
                    <Row fillWidth horizontal="center" paddingY="64">
                        <Spinner/>
                    </Row>
                )}

                {titles && (
                    <Row
                        fillWidth
                        gap="16"
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                        }}
                    >
                        {filtered.map((entry) => {
                            const uuid = normalizeString(entry.uuid);
                            const title = normalizeString(entry.title ?? entry.titleName) || uuid || "Untitled";
                            const lastDownloaded = normalizeString(entry.lastDownloaded);
                            const coverUrl = normalizeString(entry.coverUrl).trim();
                            const type = normalizeString(entry.type).trim();
                            const chapterCount = typeof entry.chapterCount === "number" && Number.isFinite(entry.chapterCount) ? entry.chapterCount : null;
                            const chaptersDownloaded = typeof entry.chaptersDownloaded === "number" && Number.isFinite(entry.chaptersDownloaded) ? entry.chaptersDownloaded : null;

                            const href = uuid ? `/libraries/${encodeURIComponent(uuid)}` : "/libraries";

                            return (
                                <SmartLink key={uuid || title} href={href}>
                                    <Card background="surface" border="neutral-alpha-weak" padding="l" radius="l"
                                          fillWidth>
                                        <Row gap="12" vertical="start">
                                            {coverUrl && (
                                                <img
                                                    src={coverUrl}
                                                    alt={`${title} cover`}
                                                    style={{
                                                        width: 52,
                                                        height: 78,
                                                        objectFit: "cover",
                                                        borderRadius: 10,
                                                        border: "1px solid rgba(255,255,255,0.12)",
                                                        flex: "0 0 auto",
                                                    }}
                                                    loading="lazy"
                                                />
                                            )}
                                            <Column gap="8" style={{minWidth: 0}}>
                                                <Row horizontal="between" vertical="start" gap="8"
                                                     style={{flexWrap: "wrap"}}>
                                                    <Heading
                                                        as="h3"
                                                        variant="heading-strong-m"
                                                        wrap="balance"
                                                        style={{
                                                            minWidth: 0,
                                                            lineHeight: 1.2,
                                                            display: "-webkit-box",
                                                            WebkitLineClamp: 3,
                                                            WebkitBoxOrient: "vertical",
                                                            overflow: "hidden",
                                                        }}
                                                    >
                                                        {title}
                                                    </Heading>
                                                    {type && (
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            {type}
                                                        </Badge>
                                                    )}
                                                </Row>

                                                {typeof chapterCount === "number" && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Chapters:{" "}
                                                        {typeof chaptersDownloaded === "number"
                                                            ? `${chaptersDownloaded}/${chapterCount}`
                                                            : chapterCount}
                                                    </Text>
                                                )}

                                                {lastDownloaded && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Last downloaded: {lastDownloaded}
                                                    </Text>
                                                )}
                                                {uuid && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        {uuid}
                                                    </Text>
                                                )}
                                            </Column>
                                        </Row>
                                    </Card>
                                </SmartLink>
                            );
                        })}
                    </Row>
                )}

                {addOpen && (
                    <Row
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
                            background: "rgba(0,0,0,0.55)",
                            zIndex: 50,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "24px",
                        }}
                    >
                        <Card
                            background="surface"
                            border="neutral-alpha-weak"
                            padding="l"
                            radius="l"
                            fillWidth
                            style={{maxWidth: 760, maxHeight: "85vh", overflow: "auto"}}
                        >
                            <Column gap="16">
                                <Row horizontal="between" vertical="center" gap="12">
                                    <Column gap="4" style={{minWidth: 0}}>
                                        <Heading as="h2" variant="heading-strong-l">
                                            Add to library
                                        </Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Search a title, then confirm the Raven download source.
                                        </Text>
                                    </Column>
                                    <Button variant="secondary" onClick={() => closeAdd()}>
                                        Close
                                    </Button>
                                </Row>

                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Input
                                        id="add-title-query"
                                        name="add-title-query"
                                        type="text"
                                        placeholder="Search titles (ex: Absolute Duo)"
                                        value={addQuery}
                                        onChange={(e) => setAddQuery(e.target.value)}
                                    />
                                    <Button
                                        variant="primary"
                                        disabled={searching || !addQuery.trim()}
                                        onClick={() => void performSearch()}
                                    >
                                        {searching ? "Searching..." : "Search"}
                                    </Button>
                                </Row>

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
                                        <Heading as="h3" variant="heading-strong-m">
                                            Results
                                        </Heading>

                                        {(!Array.isArray(searchResult.options) || searchResult.options.length === 0) && (
                                            <Text onBackground="neutral-weak">No results found.</Text>
                                        )}

                                        {Array.isArray(searchResult.options) && searchResult.options.length > 0 && (
                                            <Column gap="8">
                                                {searchResult.options.map((option, idx) => {
                                                    const title = normalizeString(option?.title).trim();
                                                    const href = normalizeString(option?.href).trim();
                                                    const coverUrl = normalizeString(option?.coverUrl).trim();
                                                    const type = normalizeString(option?.type).trim();
                                                    const optionIndexRaw = normalizeString(option?.option_number ?? option?.index).trim();
                                                    const optionIndexParsed = optionIndexRaw ? Number(optionIndexRaw) : NaN;
                                                    const optionIndex = Number.isFinite(optionIndexParsed) ? optionIndexParsed : idx + 1;
                                                    const checked = selectedOption === optionIndex;

                                                    return (
                                                        <Card
                                                            key={`${optionIndex}-${title || href}`}
                                                            background="surface"
                                                            border={checked ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                            padding="m"
                                                            radius="l"
                                                            fillWidth
                                                            style={{cursor: "pointer"}}
                                                            onClick={() => setSelectedOption(optionIndex)}
                                                        >
                                                            <Column gap="8">
                                                                <Row horizontal="between" vertical="center" gap="12">
                                                                    <Row gap="12" vertical="center"
                                                                         style={{minWidth: 0}}>
                                                                        {coverUrl && (
                                                                            <img
                                                                                src={coverUrl}
                                                                                alt={`${title || `Option ${optionIndex}`} cover`}
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
                                                                        <Column gap="8" style={{minWidth: 0}}>
                                                                            <Text variant="heading-default-s"
                                                                                  wrap="balance">
                                                                                {title || `Option ${optionIndex}`}
                                                                            </Text>
                                                                            {type && (
                                                                                <Row>
                                                                                    <Badge
                                                                                        background="neutral-alpha-weak"
                                                                                        onBackground="neutral-strong">
                                                                                        {type}
                                                                                    </Badge>
                                                                                </Row>
                                                                            )}
                                                                        </Column>
                                                                    </Row>
                                                                    <input
                                                                        type="radio"
                                                                        name="download-source"
                                                                        checked={checked}
                                                                        onChange={() => setSelectedOption(optionIndex)}
                                                                        aria-label={`Select option ${optionIndex}`}
                                                                    />
                                                                </Row>
                                                                {href && (
                                                                    <Text onBackground="neutral-weak"
                                                                          variant="body-default-xs">
                                                                        Source:{" "}
                                                                        <SmartLink href={href}>
                                                                            {href}
                                                                        </SmartLink>
                                                                    </Text>
                                                                )}
                                                            </Column>
                                                        </Card>
                                                    );
                                                })}

                                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                                    <Button
                                                        variant="primary"
                                                        disabled={queueing || selectedOption == null}
                                                        onClick={() => void queueDownload()}
                                                    >
                                                        {queueing ? "Queueing..." : "Confirm download"}
                                                    </Button>
                                                    {queueMessage && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {queueMessage}
                                                        </Text>
                                                    )}
                                                    {queueError && (
                                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                                            {queueError}
                                                        </Text>
                                                    )}
                                                </Row>
                                            </Column>
                                        )}
                                    </Column>
                                )}
                            </Column>
                        </Card>
                    </Row>
                )}
            </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
