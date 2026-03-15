"use client";

import {useEffect, useRef, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Button, Card, Column, dev, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type KavitaLoginResponse = {
    token?: string | null;
    baseUrl?: string | null;
    error?: string;
    details?: unknown;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

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

const isTrustedKavitaTarget = (targetUrl: URL, baseUrl: URL): boolean => {
    if (targetUrl.origin !== baseUrl.origin) {
        return false;
    }

    const normalizedBasePath = trimTrailingSlashes(baseUrl.pathname) || "/";
    if (normalizedBasePath === "/") {
        return true;
    }

    const normalizedTargetPath = trimTrailingSlashes(targetUrl.pathname) || "/";
    return normalizedTargetPath === normalizedBasePath || normalizedTargetPath.startsWith(`${normalizedBasePath}/`);
};

const resolveTrustedKavitaTarget = (baseUrl: string, fallbackTarget = ""): string => {
    const normalizedBaseUrl = normalizeAbsoluteHttpUrl(baseUrl);
    if (!normalizedBaseUrl) {
        return "";
    }

    const parsedBaseUrl = new URL(normalizedBaseUrl);
    const normalizedFallbackTarget = normalizeAbsoluteHttpUrl(fallbackTarget);
    if (!normalizedFallbackTarget) {
        return parsedBaseUrl.toString();
    }

    try {
        const parsedFallbackTarget = new URL(normalizedFallbackTarget);
        return isTrustedKavitaTarget(parsedFallbackTarget, parsedBaseUrl)
            ? parsedFallbackTarget.toString()
            : parsedBaseUrl.toString();
    } catch {
        return parsedBaseUrl.toString();
    }
};

const buildKavitaLoginUrl = (baseUrl: string, token: string, fallbackTarget = ""): string => {
    const target = resolveTrustedKavitaTarget(baseUrl, fallbackTarget);
    if (!target) {
        throw new Error("Moon could not resolve the Kavita login URL for the Noona handoff.");
    }

    const nextUrl = new URL(target);
    if (!/\/login\/?$/i.test(nextUrl.pathname)) {
        nextUrl.pathname = `${nextUrl.pathname.replace(/\/+$/, "")}/login`;
    }
    nextUrl.searchParams.set("noonaToken", token);
    return nextUrl.toString();
};

const maskNoonaToken = (value: string): string => {
    try {
        const parsed = new URL(value);
        if (parsed.searchParams.has("noonaToken")) {
            parsed.searchParams.set("noonaToken", "***");
        }
        return parsed.toString();
    } catch {
        return value;
    }
};

const buildMoonLoginRetryUrl = (): string => {
    const loginUrl = new URL("/login", window.location.origin);
    const returnToUrl = new URL(window.location.href);
    returnToUrl.searchParams.set("moonRetry", "1");
    loginUrl.searchParams.set("returnTo", `${returnToUrl.pathname}${returnToUrl.search}`);
    return loginUrl.toString();
};

export function KavitaLoginBridgePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const startedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const target = normalizeString(searchParams.get("target")).trim();
        const alreadyRetried = normalizeString(searchParams.get("moonRetry")).trim() === "1";
        dev.info("[NoonaKavitaBridge] Bridge started", {target});

        const complete = async () => {
            try {
                dev.info("[NoonaKavitaBridge] Requesting Kavita login token from Moon API");
                const response = await fetch("/api/noona/kavita/login", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                });
                const payload = (await response.json().catch(() => null)) as KavitaLoginResponse | null;
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        if (alreadyRetried) {
                            throw new Error("Moon login succeeded, but the Noona session was still unavailable when returning to the Kavita handoff.");
                        }

                        const loginUrl = buildMoonLoginRetryUrl();
                        dev.warn("[NoonaKavitaBridge] Missing Noona session during bridge; retrying Moon login", {
                            status: response.status,
                            loginUrl,
                        });
                        window.location.replace(loginUrl);
                        return;
                    }

                    dev.warn("[NoonaKavitaBridge] Moon API rejected Kavita bridge request", {
                        status: response.status,
                        error: normalizeString(payload?.error).trim(),
                        details: payload?.details ?? null,
                    });
                    throw new Error(normalizeString(payload?.error).trim() || `Kavita login handoff failed (HTTP ${response.status}).`);
                }

                const token = normalizeString(payload?.token).trim();
                const baseUrl = normalizeString(payload?.baseUrl).trim();
                if (!token) {
                    dev.error("[NoonaKavitaBridge] Missing token in Moon API response");
                    throw new Error("Portal did not return a valid Kavita login token.");
                }

                const redirectUrl = buildKavitaLoginUrl(baseUrl, token, target);
                dev.info("[NoonaKavitaBridge] Redirecting back to Kavita", {
                    baseUrl,
                    redirectUrl: maskNoonaToken(redirectUrl),
                });
                window.location.replace(redirectUrl);
            } catch (error_) {
                const detail = error_ instanceof Error ? error_.message : String(error_);
                dev.error("[NoonaKavitaBridge] Bridge failed", detail);
                setError(detail);
            }
        };

        void complete();
    }, [searchParams]);

    return (
        <Column maxWidth="s" horizontal="center" gap="16" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Heading as="h1" variant="heading-strong-l">Kavita login</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            Finishing the Noona account handoff and redirecting you back to Kavita.
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
                                <Button variant="secondary" onClick={() => router.push("/login")}>
                                    Back to Moon login
                                </Button>
                            </Row>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
