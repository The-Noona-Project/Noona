"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type RavenTitle = {
    title?: string | null;
    titleName?: string | null;
    uuid?: string | null;
    lastDownloaded?: string | null;
    coverUrl?: string | null;
    type?: string | null;
    chapterCount?: number | null;
    chaptersDownloaded?: number | null;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const TITLE_CARD_WIDTH = 240;
const TITLE_CARD_HEIGHT = 340;

export function LibrariesPage() {
    const [titles, setTitles] = useState<RavenTitle[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("All");

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

    return (
        <SetupModeGate>
            <AuthGate>
                <Column fillWidth maxWidth={120} horizontal="center" gap="16" paddingY="24" paddingX="16"
                        m={{style: {paddingInline: "24px"}}}>
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
                            <Button variant="primary" href="/downloads">
                                Open downloads
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
                                rowGap: "20px",
                                gridTemplateColumns: `repeat(auto-fill, minmax(${TITLE_CARD_WIDTH}px, ${TITLE_CARD_WIDTH}px))`,
                                justifyContent: "center",
                            }}
                            s={{style: {gridTemplateColumns: "1fr", justifyContent: "stretch"}}}
                        >
                            {filtered.map((entry) => {
                                const uuid = normalizeString(entry.uuid);
                                const title = normalizeString(entry.title ?? entry.titleName).trim() || uuid || "Untitled";
                                const lastDownloaded = normalizeString(entry.lastDownloaded);
                                const coverUrl = normalizeString(entry.coverUrl).trim();
                                const type = normalizeString(entry.type).trim();
                                const chapterCount = typeof entry.chapterCount === "number" && Number.isFinite(entry.chapterCount) ? entry.chapterCount : null;
                                const chaptersDownloaded = typeof entry.chaptersDownloaded === "number" && Number.isFinite(entry.chaptersDownloaded) ? entry.chaptersDownloaded : null;
                                const downloadTotal = typeof chaptersDownloaded === "number" ? chaptersDownloaded : 0;
                                const chapterTotalText = typeof chapterCount === "number"
                                    ? `${downloadTotal}/${chapterCount}`
                                    : `${downloadTotal}`;

                                const href = uuid ? `/libraries/${encodeURIComponent(uuid)}` : "/libraries";

                                return (
                                    <SmartLink
                                        key={uuid || title}
                                        href={href}
                                        unstyled
                                        fillWidth
                                        style={{display: "block", width: "100%"}}
                                    >
                                        <Card
                                            background="surface"
                                            border="neutral-alpha-weak"
                                            padding="0"
                                            radius="l"
                                            fillWidth
                                            style={{
                                                position: "relative",
                                                overflow: "hidden",
                                                width: "100%",
                                                height: TITLE_CARD_HEIGHT,
                                            }}
                                        >
                                            {coverUrl && (
                                                <img
                                                    src={coverUrl}
                                                    alt={`${title} cover`}
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                        width: "100%",
                                                        height: "100%",
                                                        objectFit: "cover",
                                                    }}
                                                    loading="lazy"
                                                />
                                            )}
                                            {!coverUrl && (
                                                <Row
                                                    fill
                                                    background="neutral-alpha-weak"
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                    }}
                                                />
                                            )}

                                            <Column
                                                fill
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    justifyContent: "space-between",
                                                }}
                                            >
                                                <Column
                                                    gap="8"
                                                    padding="12"
                                                    background="overlay"
                                                    style={{
                                                        background: "linear-gradient(180deg, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.15) 100%)",
                                                    }}
                                                >
                                                    <Row horizontal="between" vertical="center" gap="8"
                                                         style={{flexWrap: "wrap"}}>
                                                        {type && (
                                                            <Badge background="neutral-alpha-weak"
                                                                   onBackground="neutral-strong">
                                                                {type}
                                                            </Badge>
                                                        )}
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            {chapterTotalText}
                                                        </Badge>
                                                    </Row>
                                                    <Heading
                                                        as="h3"
                                                        variant="heading-strong-m"
                                                        onBackground="neutral-strong"
                                                        wrap="balance"
                                                        style={{
                                                            minWidth: 0,
                                                            lineHeight: 1.2,
                                                            display: "-webkit-box",
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: "vertical",
                                                            overflow: "hidden",
                                                        }}
                                                    >
                                                        {title}
                                                    </Heading>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Downloaded: {chapterTotalText}
                                                    </Text>
                                                </Column>

                                                <Row
                                                    padding="12"
                                                    background="overlay"
                                                    style={{
                                                        background: "linear-gradient(0deg, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0) 100%)",
                                                    }}
                                                >
                                                    <Text
                                                        onBackground="neutral-weak"
                                                        variant="body-default-xs"
                                                        style={{
                                                            minWidth: 0,
                                                            display: "-webkit-box",
                                                            WebkitLineClamp: 1,
                                                            WebkitBoxOrient: "vertical",
                                                            overflow: "hidden",
                                                        }}
                                                    >
                                                        {lastDownloaded ? `Last: ${lastDownloaded}` : uuid || "No chapter metadata yet"}
                                                    </Text>
                                                </Row>
                                            </Column>
                                        </Card>
                                    </SmartLink>
                                );
                            })}
                        </Row>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
