"use client";

import {useEffect, useRef, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Button, Card, Column, dev, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type DiscordCallbackResponse = {
    mode?: string | null;
    stage?: string | null;
    returnTo?: string | null;
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
const navigateToReturnTarget = (target: string) => {
    if (target.startsWith("/")) {
        window.location.replace(new URL(target, window.location.origin).toString());
        return;
    }
    const absoluteTarget = normalizeAbsoluteHttpUrl(target);
    if (absoluteTarget) {
        window.location.replace(absoluteTarget);
        return;
    }
    window.location.replace(new URL("/", window.location.origin).toString());
};

const appendQueryParam = (target: string, key: string, value: string): string => {
    const url = new URL(target, window.location.origin);
    url.searchParams.set(key, value);
    return target.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
};

export function DiscordCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const startedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const code = normalizeString(searchParams.get("code")).trim();
        const state = normalizeString(searchParams.get("state")).trim();
        if (!code || !state) {
            dev.error("[NoonaDiscordCallback] Missing OAuth code/state", {
                hasCode: Boolean(code),
                hasState: Boolean(state)
            });
            setError("Discord did not return a valid authorization code and state.");
            return;
        }

        const complete = async () => {
            try {
                dev.info("[NoonaDiscordCallback] Completing callback exchange");
                const response = await fetch("/api/noona/auth/discord/callback", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({code, state}),
                });
                const payload = (await response.json().catch(() => null)) as DiscordCallbackResponse | null;
                if (!response.ok) {
                    dev.warn("[NoonaDiscordCallback] Callback request failed", {status: response.status});
                    throw new Error(normalizeString(payload?.error).trim() || `Discord callback failed (HTTP ${response.status}).`);
                }

                const mode = normalizeString(payload?.mode).trim();
                const stage = normalizeString(payload?.stage).trim();
                const returnTo = normalizeMoonReturnTarget(
                    payload?.returnTo,
                    window.location.origin,
                    mode === "login" ? "/" : "/setupwizard/summary",
                );
                dev.info("[NoonaDiscordCallback] Callback exchange succeeded", {mode, stage, returnTo});

                if (stage === "tested") {
                    dev.debug("[NoonaDiscordCallback] Redirecting with discordTest=success");
                    navigateToReturnTarget(appendQueryParam(returnTo, "discordTest", "success"));
                    return;
                }

                if (stage === "bootstrapped" || stage === "authenticated") {
                    dev.debug("[NoonaDiscordCallback] Redirecting with discordAuth=success");
                    navigateToReturnTarget(appendQueryParam(returnTo, "discordAuth", "success"));
                    return;
                }

                dev.debug("[NoonaDiscordCallback] Redirecting to return target");
                navigateToReturnTarget(returnTo);
            } catch (error_) {
                const detail = error_ instanceof Error ? error_.message : String(error_);
                dev.error("[NoonaDiscordCallback] Callback completion failed", detail);
                setError(detail);
            }
        };

        void complete();
    }, [router, searchParams]);

    return (
        <Column maxWidth="s" horizontal="center" gap="16" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Heading as="h1" variant="heading-strong-l">Discord callback</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            Completing the Discord OAuth round-trip with Sage and Moon.
                        </Text>
                    </Column>

                    {!error && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}

                    {error && (
                        <Column gap="12">
                            <Text onBackground="danger-strong" variant="body-default-s">{error}</Text>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button variant="secondary" onClick={() => router.push("/setupwizard/summary")}>
                                    Back to setup summary
                                </Button>
                                <Button variant="secondary" onClick={() => router.push("/login")}>
                                    Go to login
                                </Button>
                            </Row>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
