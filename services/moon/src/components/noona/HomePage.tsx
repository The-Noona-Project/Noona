"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Button, Card, Column, Flex, GlitchFx, Heading, Row, Spinner, Text, WeatherFx} from "@once-ui-system/core";
import {hasMoonPermission} from "@/utils/moonPermissions";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";
import {RAVEN_TITLE_CARD_WIDTH, RavenTitleCard, type RavenTitleCardEntry} from "./RavenTitleCard";

type AuthStatusResponse = {
    user?: {
        permissions?: string[] | null;
    } | null;
};

const HOME_LEAF_COLORS = [
    "warning-solid-strong",
    "danger-solid-medium",
    "success-solid-medium",
];

const HOME_GLITCH_LINES = [
    "RAVEN.FEED",
    "DOWNLOAD.QUEUE",
    "STACK.CONTROL",
];

export function HomePage() {
    const router = useRouter();

    const [titles, setTitles] = useState<RavenTitleCardEntry[] | null>(null);
    const [authPermissions, setAuthPermissions] = useState<string[] | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [libraryError, setLibraryError] = useState<string | null>(null);

    const titleCards = useMemo(() => (Array.isArray(titles) ? titles.slice(0, 6) : []), [titles]);
    const canAccessLibrary = hasMoonPermission(authPermissions, "library_management");
    const canAccessDownloads = hasMoonPermission(authPermissions, "download_management");

    const loadLatestTitles = async () => {
        setLibraryError(null);
        setTitles(null);

        try {
            const res = await fetch("/api/noona/raven/library/latest", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const errorMessage =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Failed to load latest titles (HTTP ${res.status}).`;
                throw new Error(errorMessage);
            }

            if (Array.isArray(json)) {
                setTitles(json as RavenTitleCardEntry[]);
                return;
            }

            setTitles([]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLibraryError(message);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const loadAuth = async () => {
            try {
                const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as AuthStatusResponse | null;
                if (cancelled) return;

                setAuthPermissions(res.ok ? (json?.user?.permissions ?? null) : []);
            } catch {
                if (!cancelled) {
                    setAuthPermissions([]);
                }
            } finally {
                if (!cancelled) {
                    setAuthReady(true);
                }
            }
        };

        void loadAuth();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!authReady) {
            return;
        }

        void loadLatestTitles();
    }, [authReady]);

    return (
        <SetupModeGate>
            <AuthGate>
                <Flex
                    fillWidth
                    style={{
                        position: "relative",
                        overflow: "hidden",
                    }}
                >
                    <WeatherFx
                        fill
                        position="absolute"
                        top="0"
                        left="0"
                        type="leaves"
                        colors={HOME_LEAF_COLORS}
                        intensity={30}
                        speed={0.65}
                        angle={-8}
                        aria-hidden="true"
                        style={{pointerEvents: "none"}}
                    />
                    <Column
                        fillWidth
                        horizontal="center"
                        gap="24"
                        paddingY="24"
                        paddingX="16"
                        style={{
                            maxWidth: "var(--moon-page-max-width, 116rem)",
                            position: "relative",
                            zIndex: 1,
                        }}
                        m={{style: {paddingInline: "24px"}}}
                    >
                        <Card
                            fillWidth
                            background="surface"
                            border="neutral-alpha-medium"
                            padding="0"
                            radius="xl"
                            style={{
                                position: "relative",
                                overflow: "hidden",
                                minHeight: "19rem",
                            }}
                        >
                            <GlitchFx
                                fill
                                position="absolute"
                                top="0"
                                left="0"
                                speed="slow"
                                interval={4200}
                                trigger="instant"
                                continuous={false}
                                aria-hidden="true"
                                style={{
                                    pointerEvents: "none",
                                    opacity: 0.28,
                                }}
                            >
                                <Column
                                    fillWidth
                                    fillHeight
                                    padding="xl"
                                    style={{
                                        justifyContent: "space-between",
                                        minHeight: "19rem",
                                    }}
                                >
                                    <Column gap="8" style={{marginLeft: "auto", textAlign: "right"}}>
                                        {HOME_GLITCH_LINES.map((line) => (
                                            <Text
                                                key={line}
                                                variant="label-default-s"
                                                onBackground="brand-weak"
                                            >
                                                {line}
                                            </Text>
                                        ))}
                                    </Column>
                                    <Column gap="4" style={{marginLeft: "auto", textAlign: "right"}}>
                                        <Heading as="p" variant="display-strong-l">
                                            NOONA
                                        </Heading>
                                        <Heading as="p" variant="display-default-l" onBackground="neutral-weak">
                                            MOON
                                        </Heading>
                                    </Column>
                                </Column>
                            </GlitchFx>
                            <Column
                                gap="20"
                                padding="xl"
                                style={{
                                    position: "relative",
                                    zIndex: 1,
                                    minHeight: "19rem",
                                    justifyContent: "space-between",
                                }}
                                s={{style: {padding: "24px"}}}
                            >
                                <Column gap="12" style={{maxWidth: "42rem"}}>
                                    <Text variant="label-default-s" onBackground="brand-weak">
                                        Raven library feed // download watch // stack control
                                    </Text>
                                    <Heading variant="display-strong-s" wrap="balance">
                                        Noona Moon
                                    </Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-m" wrap="balance">
                                        Your Noona command deck for Raven libraries, download activity, and stack
                                        controls.
                                    </Text>
                                </Column>

                                {authReady && (
                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                        {canAccessLibrary && (
                                            <Button variant="primary" onClick={() => router.push("/libraries")}>
                                                Open libraries
                                            </Button>
                                        )}
                                        {canAccessDownloads && (
                                            <Button variant="secondary" onClick={() => router.push("/downloads")}>
                                                Open downloads
                                            </Button>
                                        )}
                                        <Button variant="secondary" onClick={() => void loadLatestTitles()}>
                                            Refresh
                                        </Button>
                                    </Row>
                                )}
                            </Column>
                        </Card>

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

                        {authReady && !titles && !libraryError && (
                            <Row fillWidth horizontal="center" paddingY="64">
                                <Spinner/>
                            </Row>
                        )}

                        {titles && (
                            <Column fillWidth gap="16">
                                <Heading as="h2" variant="heading-strong-l">
                                    Recent titles
                                </Heading>
                                {!canAccessLibrary && (
                                    <Text onBackground="neutral-weak">
                                        You can see the latest Raven titles here, but opening title pages still
                                        requires Library management permission.
                                    </Text>
                                )}

                                {titleCards.length === 0 ? (
                                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l"
                                          radius="l">
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
                                            rowGap: "20px",
                                            gridTemplateColumns: `repeat(auto-fill, minmax(${RAVEN_TITLE_CARD_WIDTH}px, ${RAVEN_TITLE_CARD_WIDTH}px))`,
                                            justifyContent: "center",
                                        }}
                                        s={{style: {gridTemplateColumns: "1fr", justifyContent: "stretch"}}}
                                    >
                                        {titleCards.map((entry) => (
                                            <RavenTitleCard
                                                key={entry.uuid || entry.title || entry.titleName || "title"}
                                                entry={entry}
                                                clickable={canAccessLibrary}
                                            />
                                        ))}
                                    </Row>
                                )}
                            </Column>
                        )}
                    </Column>
                </Flex>
            </AuthGate>
        </SetupModeGate>
    );
}
