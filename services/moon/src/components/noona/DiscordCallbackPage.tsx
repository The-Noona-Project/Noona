"use client";

import {useEffect, useRef, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type DiscordCallbackResponse = {
    mode?: string | null;
    stage?: string | null;
    returnTo?: string | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const appendQueryParam = (target: string, key: string, value: string): string => {
    const url = new URL(target, window.location.origin);
    url.searchParams.set(key, value);
    return `${url.pathname}${url.search}${url.hash}`;
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
            setError("Discord did not return a valid authorization code and state.");
            return;
        }

        const complete = async () => {
            try {
                const response = await fetch("/api/noona/auth/discord/callback", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({code, state}),
                });
                const payload = (await response.json().catch(() => null)) as DiscordCallbackResponse | null;
                if (!response.ok) {
                    throw new Error(normalizeString(payload?.error).trim() || `Discord callback failed (HTTP ${response.status}).`);
                }

                const mode = normalizeString(payload?.mode).trim();
                const stage = normalizeString(payload?.stage).trim();
                const returnTo = normalizeString(payload?.returnTo).trim() || (mode === "login" ? "/" : "/setupwizard/summary");

                if (stage === "tested") {
                    router.replace(appendQueryParam(returnTo, "discordTest", "success"));
                    return;
                }

                if (stage === "bootstrapped" || stage === "authenticated") {
                    router.replace(appendQueryParam(returnTo, "discordAuth", "success"));
                    return;
                }

                router.replace(returnTo);
            } catch (error_) {
                const detail = error_ instanceof Error ? error_.message : String(error_);
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
