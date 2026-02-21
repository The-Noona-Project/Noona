"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";

type RavenTitle = {
    title?: string | null;
    titleName?: string | null;
    uuid?: string | null;
    sourceUrl?: string | null;
    lastDownloaded?: string | null;
};

type RavenSearchOption = {
    index?: string | null;
    option_number?: string | null;
    title?: string | null;
    href?: string | null;
};

type RavenSearchResponse = {
    searchId?: string | null;
    options?: RavenSearchOption[] | null;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LibrariesPage() {
    const router = useRouter();
    const [titles, setTitles] = useState<RavenTitle[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    const [addOpen, setAddOpen] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResult, setSearchResult] = useState<RavenSearchResponse | null>(null);
    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [queueing, setQueueing] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueMessage, setQueueMessage] = useState<string | null>(null);

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
        if (!needle) return list;

        return list.filter((entry) => {
            const title = normalizeString(entry.title ?? entry.titleName).toLowerCase();
            const uuid = normalizeString(entry.uuid).toLowerCase();
            return title.includes(needle) || uuid.includes(needle);
        });
    }, [query, titles]);

    return (
        <SetupModeGate>
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

                <Input
                    id="library-search"
                    name="library-search"
                    type="text"
                    placeholder="Search titles..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />

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

                            const href = uuid ? `/libraries/${encodeURIComponent(uuid)}` : "/libraries";

                            return (
                                <SmartLink key={uuid || title} href={href}>
                                    <Card background="surface" border="neutral-alpha-weak" padding="l" radius="l"
                                          fillWidth>
                                        <Column gap="8">
                                            <Heading as="h3" variant="heading-strong-m" wrap="balance">
                                                {title}
                                            </Heading>
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
                                    </Card>
                                </SmartLink>
                            );
                        })}
                    </Row>
                )}

                {addOpen && (
                    <div
                        role="presentation"
                        onClick={(event) => {
                            if (event.target === event.currentTarget) {
                                closeAdd();
                            }
                        }}
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
                                                                    <Text variant="heading-default-s" wrap="balance">
                                                                        {title || `Option ${optionIndex}`}
                                                                    </Text>
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
                    </div>
                )}
            </Column>
        </SetupModeGate>
    );
}
