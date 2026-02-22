"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, Spinner, Text} from "@once-ui-system/core";

type SetupStatus = {
    completed?: boolean;
};

type BootstrapStatus = {
    adminExists?: boolean;
    username?: string | null;
};

type ApiResponse = {
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export function SignupPage() {
    const router = useRouter();
    const [checking, setChecking] = useState(true);
    const [adminExists, setAdminExists] = useState(false);
    const [existingAdminUsername, setExistingAdminUsername] = useState<string | null>(null);

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
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
                    router.replace(setupCompleted ? "/" : "/setupwizard");
                    return;
                }

                if (setupCompleted) {
                    router.replace("/login");
                    return;
                }

                const bootstrapRes = await fetch("/api/noona/auth/bootstrap/status", {cache: "no-store"});
                const bootstrapJson = (await bootstrapRes.json().catch(() => null)) as BootstrapStatus | null;
                if (cancelled) return;

                if (bootstrapRes.ok && bootstrapJson?.adminExists === true) {
                    setAdminExists(true);
                    const existingName =
                        typeof bootstrapJson.username === "string" && bootstrapJson.username.trim()
                            ? bootstrapJson.username.trim()
                            : null;
                    setExistingAdminUsername(existingName);
                }
            } catch {
                // Keep form available so setup can continue manually.
            } finally {
                if (!cancelled) setChecking(false);
            }
        };

        void check();
        return () => {
            cancelled = true;
        };
    }, [router]);

    const signup = async () => {
        setError(null);

        const usernameTrimmed = username.trim();
        if (!usernameTrimmed) {
            setError("Username is required.");
            return;
        }
        if (!password || password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setSubmitting(true);
        try {
            const bootstrapRes = await fetch("/api/noona/auth/bootstrap", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({username: usernameTrimmed, password}),
            });
            const bootstrapJson = (await bootstrapRes.json().catch(() => null)) as ApiResponse | null;
            if (!bootstrapRes.ok) {
                const message = typeof bootstrapJson?.error === "string" && bootstrapJson.error.trim()
                    ? bootstrapJson.error.trim()
                    : `Signup failed (HTTP ${bootstrapRes.status}).`;
                throw new Error(message);
            }

            const loginRes = await fetch("/api/noona/auth/login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({username: usernameTrimmed, password}),
            });
            const loginJson = (await loginRes.json().catch(() => null)) as ApiResponse | null;
            if (!loginRes.ok) {
                const message = typeof loginJson?.error === "string" && loginJson.error.trim()
                    ? loginJson.error.trim()
                    : `Admin account saved but login failed (HTTP ${loginRes.status}).`;
                throw new Error(message);
            }

            router.replace("/");
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Column maxWidth="s" horizontal="center" gap="16" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Row gap="8" vertical="center">
                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                Admin setup
                            </Badge>
                            <Heading as="h1" variant="heading-strong-l">
                                Create admin account
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Create the initial admin account before running the setup wizard.
                        </Text>
                        {adminExists && (
                            <Text onBackground="warning-strong" variant="body-default-xs">
                                Admin account already exists
                                {existingAdminUsername ? ` (${existingAdminUsername})` : ""}. Submitting here will
                                replace
                                that admin while setup is still open.
                            </Text>
                        )}
                    </Column>

                    {checking && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}

                    {!checking && (
                        <Column gap="12">
                            <Input
                                id="signup-username"
                                name="signup-username"
                                label="Admin username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                            />
                            <Input
                                id="signup-password"
                                name="signup-password"
                                label="Admin password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                            />
                            <Input
                                id="signup-confirm-password"
                                name="signup-confirm-password"
                                label="Confirm password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                autoComplete="new-password"
                            />

                            {error && (
                                <Text onBackground="danger-strong" variant="body-default-xs">
                                    {normalizeString(error)}
                                </Text>
                            )}

                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="primary"
                                    disabled={submitting || !username.trim() || !password || !confirmPassword}
                                    onClick={() => void signup()}
                                >
                                    {submitting ? "Creating..." : "Create admin and continue"}
                                </Button>
                                {adminExists && (
                                    <Button variant="secondary" onClick={() => router.push("/login")}>
                                        Go to login
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
