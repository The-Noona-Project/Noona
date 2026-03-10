"use client";

import {useEffect, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Badge, Button, Card, Column, dev, Heading, Row, Spinner, Text} from "@once-ui-system/core";

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
const normalizeAbsoluteHttpUrl = (value: unknown): string => {
    const normalized = normalizeString(value).trim();
    if (!normalized) return "";

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return "";
        }
        return parsed.toString();
    } catch {
        return "";
    }
};
const normalizeMoonReturnTarget = (value: unknown, currentOrigin: string, fallback = "/"): string => {
    const candidate = normalizeString(value).trim();
    if (!candidate) return fallback;
    if (candidate.startsWith("/")) return candidate;

    const absoluteTarget = normalizeAbsoluteHttpUrl(candidate);
    if (!absoluteTarget || !currentOrigin) {
        return fallback;
    }

    try {
        const parsed = new URL(absoluteTarget);
        return parsed.origin === currentOrigin ? parsed.toString() : fallback;
    } catch {
        return fallback;
    }
};
const navigateToReturnTarget = (router: { replace: (href: string) => void }, target: string) => {
    if (target.startsWith("/")) {
        window.location.replace(new URL(target, window.location.origin).toString());
        return;
    }
    const absoluteTarget = normalizeAbsoluteHttpUrl(target);
    if (absoluteTarget) {
        window.location.replace(absoluteTarget);
        return;
    }
    router.replace("/");
};

export function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [checking, setChecking] = useState(true);
    const [configured, setConfigured] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const currentOrigin = window.location.origin;
                const returnTo = normalizeMoonReturnTarget(searchParams.get("returnTo"), currentOrigin, "/");
                dev.info("[NoonaLogin] Page check started", {returnTo, currentOrigin});
                const setupRes = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const setupJson = (await setupRes.json().catch(() => null)) as SetupStatus | null;
                const setupCompleted = setupJson?.completed === true;
                dev.debug("[NoonaLogin] Setup status fetched", {setupCompleted, status: setupRes.status});

                const authRes = await fetch("/api/noona/auth/status", {cache: "no-store"});
                if (cancelled) return;
                if (authRes.ok) {
                    dev.info("[NoonaLogin] Existing session found; redirecting", {
                        destination: setupCompleted ? returnTo : "/setupwizard/summary",
                    });
                    navigateToReturnTarget(router, setupCompleted ? returnTo : "/setupwizard/summary");
                    return;
                }
                dev.debug("[NoonaLogin] No active session", {status: authRes.status});

                if (!setupCompleted) {
                    dev.info("[NoonaLogin] Setup incomplete; redirecting to setup wizard");
                    router.replace("/setupwizard");
                    return;
                }

                const configRes = await fetch("/api/noona/auth/discord/config", {cache: "no-store"});
                const configJson = (await configRes.json().catch(() => null)) as DiscordConfigStatus | null;
                if (cancelled) return;
                if (configRes.ok) {
                    setConfigured(configJson?.configured === true);
                    dev.info("[NoonaLogin] Discord config loaded", {configured: configJson?.configured === true});
                } else {
                    dev.warn("[NoonaLogin] Discord config request failed", {status: configRes.status});
                    setError(normalizeString(configJson?.error).trim() || `Failed to load Discord auth config (HTTP ${configRes.status}).`);
                }
            } catch (error_) {
                if (cancelled) return;
                const detail = error_ instanceof Error ? error_.message : String(error_);
                dev.error("[NoonaLogin] Page check failed", detail);
                setError(detail);
            } finally {
                if (!cancelled) setChecking(false);
            }
        };

        void check();
        return () => {
            cancelled = true;
        };
    }, [router, searchParams]);

    const startDiscordLogin = async () => {
        if (loggingIn) return;

        setLoggingIn(true);
        setError(null);

        try {
            const returnTo = normalizeMoonReturnTarget(searchParams.get("returnTo"), window.location.origin, "/");
            dev.info("[NoonaLogin] Starting Discord login", {returnTo});
            const response = await fetch("/api/noona/auth/discord/start", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    mode: "login",
                    returnTo,
                }),
            });
            const payload = (await response.json().catch(() => null)) as DiscordStartResponse | null;
            if (!response.ok) {
                dev.warn("[NoonaLogin] Discord login start failed", {status: response.status});
                throw new Error(normalizeString(payload?.error).trim() || `Discord login failed to start (HTTP ${response.status}).`);
            }

            const authorizeUrl = normalizeString(payload?.authorizeUrl).trim();
            if (!authorizeUrl) {
                throw new Error("Discord login is configured, but no authorize URL was returned.");
            }

            dev.info("[NoonaLogin] Redirecting browser to Discord authorize URL");
            window.location.assign(authorizeUrl);
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            dev.error("[NoonaLogin] Discord login start threw", detail);
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
                                Sign in or create account with Discord
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Moon uses Discord OAuth for web login. If this is your first sign-in, Noona will create
                            your account automatically with the default permissions chosen by an admin.
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
                                    Discord OAuth is not configured yet. Finish the setup wizard summary first before
                                    sign-in or account creation can work.
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
