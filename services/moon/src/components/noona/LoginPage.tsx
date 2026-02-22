"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, Spinner, Text} from "@once-ui-system/core";

type AuthStatus = {
    user?: unknown;
    error?: string;
};

type SetupStatus = {
    completed?: boolean;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function LoginPage() {
    const router = useRouter();
    const [checking, setChecking] = useState(true);

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loggingIn, setLoggingIn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const setupRes = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const setupJson = (await setupRes.json().catch(() => null)) as SetupStatus | null;
                const setupCompleted = setupJson?.completed === true;

                const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
                if (cancelled) return;
                if (res.ok) {
                    router.replace(setupCompleted ? "/" : "/setupwizard");
                    return;
                }

                if (!setupCompleted) {
                    router.replace("/signup");
                    return;
                }
            } catch {
                // Ignore.
            } finally {
                if (!cancelled) setChecking(false);
            }
        };

        void check();
        return () => {
            cancelled = true;
        };
    }, [router]);

    const login = async () => {
        setLoggingIn(true);
        setError(null);

        try {
            const res = await fetch("/api/noona/auth/login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({username, password}),
            });
            const json = (await res.json().catch(() => null)) as AuthStatus | null;

            if (!res.ok) {
                const msg = typeof json?.error === "string" && json.error.trim()
                    ? json.error.trim()
                    : `Login failed (HTTP ${res.status}).`;
                throw new Error(msg);
            }

            router.replace("/");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setError(msg);
        } finally {
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
                                Login
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Sign in to manage libraries, downloads, and settings.
                        </Text>
                    </Column>

                    {checking && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}

                    {!checking && (
                        <Column gap="12">
                            <Input
                                id="username"
                                name="username"
                                label="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                            />
                            <Input
                                id="password"
                                name="password"
                                label="Password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                            />

                            {error && (
                                <Text onBackground="danger-strong" variant="body-default-xs">
                                    {normalizeString(error)}
                                </Text>
                            )}

                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="primary"
                                    disabled={loggingIn || !username.trim() || !password}
                                    onClick={() => void login()}
                                >
                                    {loggingIn ? "Signing in..." : "Sign in"}
                                </Button>
                            </Row>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
