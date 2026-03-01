"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type SetupStatus = {
    completed?: boolean;
};

type DiscordConfigStatus = {
    configured?: boolean;
    error?: string;
};

type DiscordStartResponse = {
    authorizeUrl?: string | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LoginPage() {
    const router = useRouter();
    const [checking, setChecking] = useState(true);
    const [configured, setConfigured] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const setupRes = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const setupJson = (await setupRes.json().catch(() => null)) as SetupStatus | null;
                const setupCompleted = setupJson?.completed === true;

                const authRes = await fetch("/api/noona/auth/status", {cache: "no-store"});
                if (cancelled) return;
                if (authRes.ok) {
                    router.replace(setupCompleted ? "/" : "/setupwizard/summary");
                    return;
                }

                if (!setupCompleted) {
                    router.replace("/setupwizard");
                    return;
                }

                const configRes = await fetch("/api/noona/auth/discord/config", {cache: "no-store"});
                const configJson = (await configRes.json().catch(() => null)) as DiscordConfigStatus | null;
                if (cancelled) return;
                if (configRes.ok) {
                    setConfigured(configJson?.configured === true);
                } else {
                    setError(normalizeString(configJson?.error).trim() || `Failed to load Discord auth config (HTTP ${configRes.status}).`);
                }
            } catch (error_) {
                if (cancelled) return;
                const detail = error_ instanceof Error ? error_.message : String(error_);
                setError(detail);
            } finally {
                if (!cancelled) setChecking(false);
            }
        };

        void check();
        return () => {
            cancelled = true;
        };
    }, [router]);

    const startDiscordLogin = async () => {
        if (loggingIn) return;

        setLoggingIn(true);
        setError(null);

        try {
            const response = await fetch("/api/noona/auth/discord/start", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    mode: "login",
                    returnTo: "/",
                }),
            });
            const payload = (await response.json().catch(() => null)) as DiscordStartResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Discord login failed to start (HTTP ${response.status}).`);
            }

            const authorizeUrl = normalizeString(payload?.authorizeUrl).trim();
            if (!authorizeUrl) {
                throw new Error("Discord login is configured, but no authorize URL was returned.");
            }

            window.location.assign(authorizeUrl);
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            setError(detail);
            setLoggingIn(false);
        }
    };

    return (
        <Column maxWidth="s" horizontal="center" gap="16" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Row gap="8" vertical="center">
                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                Noona
                            </Badge>
                            <Heading as="h1" variant="heading-strong-l">
                                Sign in with Discord
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Moon now uses Discord OAuth for web login. Username/password sign-in is no longer part of
                            the web flow.
                        </Text>
                    </Column>

                    {checking && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}

                    {!checking && (
                        <Column gap="12">
                            {!configured && !error && (
                                <Text onBackground="warning-strong" variant="body-default-xs">
                                    Discord OAuth is not configured yet. Finish the setup wizard summary first.
                                </Text>
                            )}

                            {error && (
                                <Text onBackground="danger-strong" variant="body-default-xs" aria-live="polite">
                                    {error}
                                </Text>
                            )}

                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="primary"
                                    disabled={checking || loggingIn || !configured}
                                    onClick={() => void startDiscordLogin()}
                                >
                                    {loggingIn ? "Redirecting..." : "Continue with Discord"}
                                </Button>
                                {!configured && (
                                    <Button variant="secondary" onClick={() => router.push("/setupwizard")}>
                                        Open setup wizard
                                    </Button>
                                )}
                            </Row>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
