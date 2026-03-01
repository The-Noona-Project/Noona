"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, Spinner, Text} from "@once-ui-system/core";

type ServiceEntry = {
    name?: string | null;
    description?: string | null;
    hostServiceUrl?: string | null;
    installed?: boolean | null;
    required?: boolean | null;
};

type ServicesResponse = {
    services?: ServiceEntry[] | null;
    error?: string;
};

type DiscordConfigResponse = {
    configured?: boolean;
    clientId?: string | null;
    callbackPath?: string | null;
    updatedAt?: string | null;
    lastTestedAt?: string | null;
    lastTestedUser?: {
        id?: string | null;
        username?: string | null;
        globalName?: string | null;
        avatarUrl?: string | null;
        email?: string | null;
    } | null;
    error?: string;
};

type AuthUser = {
    username?: string | null;
    role?: string | null;
    permissions?: string[] | null;
    authProvider?: string | null;
    discordUserId?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
};

type AuthStatusResponse = {
    user?: AuthUser | null;
    error?: string;
};

type DiscordStartResponse = {
    authorizeUrl?: string | null;
    error?: string;
};

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
    "noona-moon": "Moon is the main Noona web console for setup, libraries, downloads, and service controls.",
    "noona-portal": "Portal connects Discord to your stack for join, search, scan, and library commands.",
    "noona-raven": "Raven discovers, organizes, and downloads manga into the shared library tree.",
    "noona-sage": "Sage coordinates setup, auth, and service-facing helper APIs for Moon.",
    "noona-vault": "Vault provides the shared settings, Mongo, Redis, and secret-backed storage layer.",
    "noona-redis": "Redis stores live stack state such as sessions, wizard progress, and cache entries.",
    "noona-mongo": "Mongo stores Noona settings, users, metadata, and service data.",
    "noona-kavita": "Kavita is the reader and library server for your downloaded manga.",
    komf: "Komf enriches Kavita titles with metadata and matching automation.",
};
const SERVICE_ORDER = [
    "noona-moon",
    "noona-sage",
    "noona-vault",
    "noona-redis",
    "noona-mongo",
    "noona-portal",
    "noona-raven",
    "noona-kavita",
    "komf",
] as const;
const SERVICE_ORDER_INDEX = new Map<string, number>(
    SERVICE_ORDER.map((service, index) => [service, index]),
);

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const parseSelectedServices = (raw: string | null): string[] => {
    const value = normalizeString(raw).trim();
    if (!value) return [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of value.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
};

const hasPermission = (permissions: string[] | null | undefined, permission: string): boolean =>
    Array.isArray(permissions) && (permissions.includes("admin") || permissions.includes(permission));

const formatIso = (value: unknown): string => {
    const raw = normalizeString(value).trim();
    if (!raw) return "";
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : raw;
};

export function SetupSummaryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const selectedServices = useMemo(
        () => parseSelectedServices(searchParams.get("selected")),
        [searchParams],
    );

    const [loading, setLoading] = useState(true);
    const [services, setServices] = useState<ServiceEntry[]>([]);
    const [config, setConfig] = useState<DiscordConfigResponse | null>(null);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [copyState, setCopyState] = useState<string | null>(null);
    const [urlCopyState, setUrlCopyState] = useState<string | null>(null);
    const [flowLoading, setFlowLoading] = useState<"test" | "bootstrap" | null>(null);
    const [finalizing, setFinalizing] = useState(false);
    const [callbackUrl, setCallbackUrl] = useState("");
    const [returnTo, setReturnTo] = useState("/setupwizard/summary");

    const visibleServices = useMemo(() => {
        const selectedSet = new Set(selectedServices);
        const filtered = services.filter((entry) => {
            const name = normalizeString(entry?.name).trim();
            if (!name) return false;
            return entry?.installed === true || selectedSet.has(name);
        });

        return filtered.sort((left, right) => {
            const leftName = normalizeString(left?.name).trim();
            const rightName = normalizeString(right?.name).trim();
            const leftIndex = SERVICE_ORDER_INDEX.get(leftName);
            const rightIndex = SERVICE_ORDER_INDEX.get(rightName);
            if (typeof leftIndex === "number" && typeof rightIndex === "number") {
                return leftIndex - rightIndex;
            }
            if (typeof leftIndex === "number") return -1;
            if (typeof rightIndex === "number") return 1;
            return leftName.localeCompare(rightName);
        });
    }, [selectedServices, services]);

    const canCreateSuperuser = Boolean(config?.lastTestedAt);
    const isLoggedIn = Boolean(normalizeString(authUser?.username).trim());
    const canFinalize = isLoggedIn && hasPermission(authUser?.permissions, "admin");
    const installedCount = visibleServices.filter((entry) => entry?.installed === true).length;
    const selectedSet = useMemo(() => new Set(selectedServices), [selectedServices]);
    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            setCallbackUrl(`${window.location.origin}/discord/callback/`);
            setReturnTo(`${window.location.pathname}${window.location.search}`);

            try {
                const [servicesRes, configRes, authRes] = await Promise.all([
                    fetch("/api/noona/services", {cache: "no-store"}),
                    fetch("/api/noona/auth/discord/config", {cache: "no-store"}),
                    fetch("/api/noona/auth/status", {cache: "no-store"}),
                ]);

                const servicesJson = (await servicesRes.json().catch(() => null)) as ServicesResponse | null;
                const configJson = (await configRes.json().catch(() => null)) as DiscordConfigResponse | null;
                const authJson = (await authRes.json().catch(() => null)) as AuthStatusResponse | null;
                if (cancelled) return;

                if (!servicesRes.ok) {
                    throw new Error(normalizeString(servicesJson?.error).trim() || `Failed to load services (HTTP ${servicesRes.status}).`);
                }

                setServices(Array.isArray(servicesJson?.services) ? servicesJson.services : []);
                setConfig(configJson ?? {});
                setAuthUser(authRes.ok ? (authJson?.user ?? null) : null);

                const authNotice = normalizeString(searchParams.get("discordAuth")).trim();
                const testNotice = normalizeString(searchParams.get("discordTest")).trim();
                if (authNotice === "success") {
                    setMessage("Discord login completed. Review the summary, then finalize setup.");
                } else if (testNotice === "success") {
                    setMessage("Discord callback test completed. You can now create the superuser account.");
                } else {
                    setMessage(null);
                }
            } catch (error_) {
                if (cancelled) return;
                const detail = error_ instanceof Error ? error_.message : String(error_);
                setError(detail);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [searchParams]);

    const copyCallbackUrl = async () => {
        if (!callbackUrl || !navigator?.clipboard?.writeText) {
            setCopyState("Copy the callback URL manually.");
            return;
        }

        try {
            await navigator.clipboard.writeText(callbackUrl);
            setCopyState("Callback URL copied.");
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            setCopyState(detail || "Unable to copy the callback URL.");
        }
    };

    const copyServiceUrl = async (serviceName: string, serviceUrl: string) => {
        if (!serviceUrl || !navigator?.clipboard?.writeText) {
            setUrlCopyState("Copy the service URL manually.");
            return;
        }

        try {
            await navigator.clipboard.writeText(serviceUrl);
            setUrlCopyState(`${serviceName} URL copied.`);
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            setUrlCopyState(detail || "Unable to copy the service URL.");
        }
    };

    const beginDiscordFlow = async (mode: "test" | "bootstrap") => {
        setFlowLoading(mode);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch("/api/noona/auth/discord/start", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    mode,
                    returnTo,
                }),
            });
            const payload = (await response.json().catch(() => null)) as DiscordStartResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Discord OAuth start failed (HTTP ${response.status}).`);
            }

            const authorizeUrl = normalizeString(payload?.authorizeUrl).trim();
            if (!authorizeUrl) {
                throw new Error("Discord OAuth start succeeded, but no authorize URL was returned.");
            }

            window.location.assign(authorizeUrl);
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            setError(detail);
            setFlowLoading(null);
        }
    };

    const finalizeSetup = async () => {
        setFinalizing(true);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch("/api/noona/setup/complete", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({selectedServices}),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Failed to finalize setup (HTTP ${response.status}).`);
            }

            window.location.assign("/");
        } catch (error_) {
            const detail = error_ instanceof Error ? error_.message : String(error_);
            setError(detail);
        } finally {
            setFinalizing(false);
        }
    };

    return (
        <Column maxWidth="l" horizontal="center" gap="16" paddingY="24">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Badge background="brand-alpha-weak" onBackground="neutral-strong">Setup Summary</Badge>
                        <Heading as="h1" variant="display-strong-s">
                            Review the stack and finish Discord setup
                        </Heading>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            Confirm what Noona installed, register the Discord callback URL, test the OAuth loop, then
                            create the first superuser with Discord.
                        </Text>
                    </Column>

                    {!loading && (
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                {installedCount} installed
                            </Badge>
                            {selectedServices.length > 0 && (
                                <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                    {selectedServices.length} selected
                                </Badge>
                            )}
                            {config?.lastTestedAt && (
                                <Badge background="success-alpha-weak" onBackground="neutral-strong">
                                    Callback tested
                                </Badge>
                            )}
                            {canFinalize && (
                                <Badge background="success-alpha-weak" onBackground="neutral-strong">
                                    Superuser ready
                                </Badge>
                            )}
                        </Row>
                    )}

                    {loading && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}

                    {!loading && (
                        <Column gap="16">
                            {error && <Text onBackground="danger-strong">{error}</Text>}
                            {message && <Text onBackground="neutral-weak">{message}</Text>}
                            {canFinalize && (
                                <Card fillWidth background="surface" border="success-alpha-weak" padding="m" radius="l">
                                    <Column gap="8">
                                        <Heading as="h2" variant="heading-strong-l">Ready to finalize</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-s">
                                            Discord OAuth is verified and the first Moon superuser is signed in. Review
                                            the installed services below, then finalize setup.
                                        </Text>
                                    </Column>
                                </Card>
                            )}

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">Installed services</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        This is the current Noona stack summary for the services selected in setup plus
                                        the supporting services already installed.
                                    </Text>
                                    {visibleServices.length === 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            No selected services were found in the current service catalog yet.
                                        </Text>
                                    )}
                                    {visibleServices.map((entry) => {
                                        const name = normalizeString(entry?.name).trim();
                                        const description = normalizeString(entry?.description).trim() || FALLBACK_DESCRIPTIONS[name] || "No description available.";
                                        const serviceUrl = normalizeString(entry?.hostServiceUrl).trim();
                                        return (
                                            <Card key={name || description} fillWidth background="surface"
                                                  border="neutral-alpha-weak" padding="m" radius="l">
                                                <Column gap="8">
                                                    <Row horizontal="between" vertical="center" gap="12"
                                                         style={{flexWrap: "wrap"}}>
                                                        <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                            <Heading as="h3"
                                                                     variant="heading-strong-m">{name || "Service"}</Heading>
                                                            <Badge
                                                                background={entry?.installed ? "success-alpha-weak" : "neutral-alpha-weak"}
                                                                onBackground="neutral-strong">
                                                                {entry?.installed ? "Installed" : "Pending"}
                                                            </Badge>
                                                            {selectedSet.has(name) && (
                                                                <Badge background="brand-alpha-weak"
                                                                       onBackground="neutral-strong">
                                                                    Selected
                                                                </Badge>
                                                            )}
                                                            {entry?.required && (
                                                                <Badge background="neutral-alpha-weak"
                                                                       onBackground="neutral-strong">
                                                                    Core service
                                                                </Badge>
                                                            )}
                                                        </Row>
                                                    </Row>
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-s">{description}</Text>
                                                    {serviceUrl ? (
                                                        <Column gap="8">
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                URL: {serviceUrl}
                                                            </Text>
                                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                                <Button
                                                                    variant="secondary"
                                                                    size="s"
                                                                    onClick={() => void copyServiceUrl(name || "Service", serviceUrl)}
                                                                >
                                                                    Copy URL
                                                                </Button>
                                                                <Button
                                                                    variant="secondary"
                                                                    size="s"
                                                                    onClick={() => window.open(serviceUrl, "_blank", "noopener,noreferrer")}
                                                                >
                                                                    Open service
                                                                </Button>
                                                            </Row>
                                                        </Column>
                                                    ) : (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            No public web URL exposed for this service.
                                                        </Text>
                                                    )}
                                                </Column>
                                            </Card>
                                        );
                                    })}
                                    {urlCopyState && <Text onBackground="neutral-weak"
                                                           variant="body-default-xs">{urlCopyState}</Text>}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">Discord callback</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Add this callback URL in the Discord Developer Portal for the bot/application
                                        OAuth settings before testing the full loop.
                                    </Text>
                                    <Input
                                        id="discord-callback-url"
                                        name="discord-callback-url"
                                        label="Callback URL"
                                        value={callbackUrl}
                                        readOnly
                                    />
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button variant="secondary" onClick={() => void copyCallbackUrl()}>
                                            Copy callback URL
                                        </Button>
                                        <Button
                                            variant="primary"
                                            disabled={!config?.configured || flowLoading !== null}
                                            onClick={() => void beginDiscordFlow("test")}
                                        >
                                            {flowLoading === "test" ? "Testing..." : config?.lastTestedAt ? "Re-test callback loop" : "Test callback loop"}
                                        </Button>
                                    </Row>
                                    {copyState &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">{copyState}</Text>}
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        {config?.configured
                                            ? `Client ID: ${normalizeString(config.clientId).trim() || "saved"}`
                                            : "Discord OAuth client ID and secret have not been saved yet."}
                                    </Text>
                                    {config?.lastTestedAt && (
                                        <Column gap="4">
                                            <Text onBackground="success-strong" variant="body-default-xs">
                                                Last successful callback test: {formatIso(config.lastTestedAt)}
                                            </Text>
                                            {config?.lastTestedUser && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Verified
                                                    as {normalizeString(config.lastTestedUser.globalName).trim() || normalizeString(config.lastTestedUser.username).trim() || "Discord user"}.
                                                </Text>
                                            )}
                                        </Column>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">Create the superuser</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        The first Moon superuser now comes from Discord OAuth. Username/password signup
                                        is no longer part of the web setup flow.
                                    </Text>
                                    {!canCreateSuperuser && !canFinalize && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Run the callback test first to unlock Discord superuser creation.
                                        </Text>
                                    )}
                                    {canCreateSuperuser && !canFinalize && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Button
                                                variant="primary"
                                                disabled={flowLoading !== null}
                                                onClick={() => void beginDiscordFlow("bootstrap")}
                                            >
                                                {flowLoading === "bootstrap" ? "Redirecting..." : "Login with Discord"}
                                            </Button>
                                        </Row>
                                    )}
                                    {canFinalize && (
                                        <Column gap="8">
                                            <Badge background="success-alpha-weak" onBackground="neutral-strong">
                                                Superuser ready
                                            </Badge>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                Signed in
                                                as {normalizeString(authUser?.username).trim() || "Discord user"}.
                                            </Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                Provider: {normalizeString(authUser?.authProvider).trim() || "unknown"}{normalizeString(authUser?.discordUserId).trim() ? ` | Discord ID: ${authUser?.discordUserId}` : ""}
                                            </Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                The summary is now locked to review mode. Finalize setup to switch Moon
                                                into normal operation.
                                            </Text>
                                        </Column>
                                    )}
                                </Column>
                            </Card>

                            <Line background="neutral-alpha-weak"/>

                            <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Finalize setup after the Discord superuser is logged in and the stack summary looks
                                    correct.
                                </Text>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary" onClick={() => router.push("/setupwizard")}>
                                        Back to setup
                                    </Button>
                                    <Button
                                        variant="primary"
                                        disabled={!canFinalize || finalizing}
                                        onClick={() => void finalizeSetup()}
                                    >
                                        {finalizing ? "Finalizing..." : "Finalize setup"}
                                    </Button>
                                </Row>
                            </Row>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
