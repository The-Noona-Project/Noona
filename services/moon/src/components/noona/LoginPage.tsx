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
    const [showPassword, setShowPassword] = useState(false);
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

    const canSubmit = username.trim().length > 0 && password.length > 0;

    const login = async () => {
        if (!canSubmit || loggingIn) {
            return;
        }

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

    const submitWithEnter = (key: string) => {
        if (key !== "Enter") {
            return;
        }

        void login();
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
                                Sign in
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Sign in with a Moon-enabled account to manage libraries, downloads, and settings.
                        </Text>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Press Enter to submit. Moon login permission is required for the account you use here.
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
                                onKeyDown={(event) => submitWithEnter(event.key)}
                                autoComplete="username"
                                autoFocus
                            />
                            <Column gap="8">
                                <Input
                                    id="password"
                                    name="password"
                                    label="Password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyDown={(event) => submitWithEnter(event.key)}
                                    autoComplete="current-password"
                                />
                                <Row fillWidth horizontal="between" vertical="center" gap="12"
                                     style={{flexWrap: "wrap"}}>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Use the same credentials configured in Sage.
                                    </Text>
                                    <Button
                                        variant="secondary"
                                        size="s"
                                        onClick={() => setShowPassword((current) => !current)}
                                    >
                                        {showPassword ? "Hide password" : "Show password"}
                                    </Button>
                                </Row>
                            </Column>

                            {error && (
                                <Text onBackground="danger-strong" variant="body-default-xs" aria-live="polite">
                                    {normalizeString(error)}
                                </Text>
                            )}

                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="primary"
                                    disabled={checking || loggingIn || !canSubmit}
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
