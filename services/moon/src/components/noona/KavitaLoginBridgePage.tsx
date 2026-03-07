"use client";

import {useEffect, useRef, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type KavitaLoginResponse = {
    token?: string | null;
    baseUrl?: string | null;
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

const buildKavitaLoginUrl = (baseUrl: string, token: string, fallbackTarget = ""): string => {
    const target = normalizeAbsoluteHttpUrl(fallbackTarget) || normalizeAbsoluteHttpUrl(baseUrl);
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

export function KavitaLoginBridgePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const startedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const target = normalizeString(searchParams.get("target")).trim();

        const complete = async () => {
            try {
                const response = await fetch("/api/noona/kavita/login", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                });
                const payload = (await response.json().catch(() => null)) as KavitaLoginResponse | null;
                if (!response.ok) {
                    throw new Error(normalizeString(payload?.error).trim() || `Kavita login handoff failed (HTTP ${response.status}).`);
                }

                const token = normalizeString(payload?.token).trim();
                const baseUrl = normalizeString(payload?.baseUrl).trim();
                if (!token) {
                    throw new Error("Portal did not return a valid Kavita login token.");
                }

                window.location.replace(buildKavitaLoginUrl(baseUrl, token, target));
            } catch (error_) {
                const detail = error_ instanceof Error ? error_.message : String(error_);
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
