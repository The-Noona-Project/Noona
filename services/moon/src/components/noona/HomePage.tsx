"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Button, Card, Column, Heading, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

export function HomePage() {
    const router = useRouter();

    const [titles, setTitles] = useState<
        Array<{ title?: string; titleName?: string; uuid?: string; lastDownloaded?: string }> | null
    >(null);
    const [libraryError, setLibraryError] = useState<string | null>(null);

    const titleCards = useMemo(() => (Array.isArray(titles) ? titles.slice(0, 6) : []), [titles]);

    const loadLibrary = async () => {
        setLibraryError(null);
        setTitles(null);

        try {
            const res = await fetch("/api/noona/raven/library", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const errorMessage =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Failed to load library (HTTP ${res.status}).`;
                throw new Error(errorMessage);
            }

            if (Array.isArray(json)) {
                setTitles(json as Array<{ title?: string; uuid?: string; lastDownloaded?: string }>);
                return;
            }

            setTitles([]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLibraryError(message);
        }
    };

    useEffect(() => {
        void loadLibrary();
    }, []);

    return (
        <SetupModeGate>
            <AuthGate>
                <Column maxWidth="l" horizontal="center" gap="24" paddingY="24">
                    <Column gap="8" horizontal="center" align="center">
                        <Heading variant="display-strong-s" wrap="balance">
                            Noona Library
                        </Heading>
                        <Text onBackground="neutral-weak" wrap="balance">
                            Titles tracked by Raven. Open a title to see downloaded files and timestamps.
                        </Text>
                    </Column>

                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="primary" onClick={() => router.push("/libraries")}>
                            Open library
                        </Button>
                        <Button variant="secondary" onClick={() => router.push("/downloads")}>
                            Open downloads
                        </Button>
                        <Button variant="secondary" onClick={() => void loadLibrary()}>
                            Refresh
                        </Button>
                    </Row>

                    {libraryError && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Heading as="h2" variant="heading-strong-l">
                                    Raven unavailable
                                </Heading>
                                <Text>{libraryError}</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Ensure `noona-raven` is installed and running.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {!titles && !libraryError && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {titles && (
                        <Column fillWidth gap="16">
                            <Heading as="h2" variant="heading-strong-l">
                                Recent titles
                            </Heading>

                            {titleCards.length === 0 ? (
                                <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                    <Column gap="8">
                                        <Text>No titles yet.</Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Use Raven to download a title, then it will show up here.
                                        </Text>
                                    </Column>
                                </Card>
                            ) : (
                                <Row
                                    fillWidth
                                    gap="16"
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                                    }}
                                >
                                    {titleCards.map((entry) => {
                                        const uuid = typeof entry.uuid === "string" ? entry.uuid : "";
                                        const label =
                                            typeof entry.title === "string"
                                                ? entry.title
                                                : typeof entry.titleName === "string"
                                                    ? entry.titleName
                                                    : uuid || "Untitled";
                                        const lastDownloaded = typeof entry.lastDownloaded === "string" ? entry.lastDownloaded : null;

                                        return (
                                            <SmartLink key={uuid || label}
                                                       href={uuid ? `/libraries/${encodeURIComponent(uuid)}` : "/libraries"}>
                                                <Card background="surface" border="neutral-alpha-weak" padding="l"
                                                      radius="l" fillWidth>
                                                    <Column gap="8">
                                                        <Heading as="h3" variant="heading-strong-m" wrap="balance">
                                                            {label}
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
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
