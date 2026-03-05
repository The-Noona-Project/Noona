"use client";

import {useEffect, useMemo, useState} from "react";
import {Button, Card, Column, Heading, Input, Row, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";
import {RAVEN_TITLE_CARD_WIDTH, RavenTitleCard, type RavenTitleCardEntry} from "./RavenTitleCard";

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LibrariesPage() {
    const [titles, setTitles] = useState<RavenTitleCardEntry[] | null>(null);
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
                setTitles(json as RavenTitleCardEntry[]);
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
            <AuthGate requiredPermission="library_management"
                      deniedMessage="Library access requires Library management permission.">
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
                                gridTemplateColumns: `repeat(auto-fill, minmax(${RAVEN_TITLE_CARD_WIDTH}px, ${RAVEN_TITLE_CARD_WIDTH}px))`,
                                justifyContent: "center",
                            }}
                            s={{style: {gridTemplateColumns: "1fr", justifyContent: "stretch"}}}
                        >
                            {filtered.map((entry) => {
                                const uuid = normalizeString(entry.uuid);

                                return (
                                    <RavenTitleCard
                                        key={uuid || normalizeString(entry.title ?? entry.titleName).trim() || "title"}
                                        entry={entry}
                                    />
                                );
                            })}
                        </Row>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
