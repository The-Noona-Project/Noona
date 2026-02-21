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

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LibrariesPage() {
    const router = useRouter();
    const [titles, setTitles] = useState<RavenTitle[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");

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
            </Column>
        </SetupModeGate>
    );
}
