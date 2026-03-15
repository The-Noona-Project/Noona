"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, Spinner, Text} from "@once-ui-system/core";
import {deriveSetupProfileSelection, shouldShowSetupDebugDetails} from "./setupProfile.mjs";
import {consumeSetupSummarySession} from "./setupSummarySession.mjs";

type ServiceEntry = {
    name?: string | null;
    description?: string | null;
    hostServiceUrl?: string | null;
    installed?: boolean | null;
    required?: boolean | null;
};

type AuthUser = {
    username?: string | null;
    permissions?: string[] | null;
    authProvider?: string | null;
    discordUserId?: string | null;
};

type SetupStatus = {
    completed?: boolean;
    configured?: boolean;
    installing?: boolean;
    debugEnabled?: boolean;
};

const TITLES: Record<string, string> = {
    "noona-moon": "Moon",
    "noona-kavita": "Kavita",
    "noona-portal": "Portal",
    "noona-raven": "Raven",
    "noona-komf": "Komf",
    "noona-sage": "Sage",
    "noona-vault": "Vault",
    "noona-redis": "Redis",
    "noona-mongo": "Mongo",
};
const DESCRIPTIONS: Record<string, string> = {
    "noona-moon": "Main Noona web console.",
    "noona-kavita": "Reader and library server.",
    "noona-portal": "Discord bridge for onboarding and commands.",
    "noona-raven": "Downloader and organizer.",
    "noona-komf": "Metadata enrichment for Kavita.",
    "noona-sage": "Setup and auth helper APIs.",
    "noona-vault": "Shared settings and secret-backed storage.",
    "noona-redis": "Live cache and session state.",
    "noona-mongo": "Persistent app data.",
};
const ORDER = ["noona-moon", "noona-kavita", "noona-portal", "noona-raven", "noona-komf", "noona-sage", "noona-vault", "noona-redis", "noona-mongo"] as const;
const ORDER_INDEX = new Map<string, number>(ORDER.map((name, index) => [name, index]));

const normalizeString = (value: unknown) => typeof value === "string" ? value : "";
const normalizeCallbackPath = (value: unknown) => {
    const raw = normalizeString(value).trim();
    if (!raw) return "/discord/callback";
    return raw.startsWith("/") ? raw : `/${raw}`;
};
const parseSelectedServices = (value: string | null) => {
    const seen = new Set<string>();
    return normalizeString(value).split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry && !seen.has(entry) && (seen.add(entry), true));
};
const formatIso = (value: unknown) => {
    const raw = normalizeString(value).trim();
    if (!raw) return "";
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : raw;
};
const hasPermission = (permissions: string[] | null | undefined, permission: string) =>
    Array.isArray(permissions) && (permissions.includes("admin") || permissions.includes(permission));
const resolveMode = (value: unknown) => normalizeString(value).trim().toLowerCase() === "external" ? "external" : "managed";
const deriveSelectedFromSnapshot = (snapshot: Record<string, unknown> | null) => {
    if (!snapshot) return [];
    const kavita = snapshot.kavita && typeof snapshot.kavita === "object" ? snapshot.kavita as { mode?: unknown } : {};
    const komf = snapshot.komf && typeof snapshot.komf === "object" ? snapshot.komf as { mode?: unknown } : {};
    return deriveSetupProfileSelection({kavitaMode: resolveMode(kavita.mode), komfMode: resolveMode(komf.mode)});
};

export function SetupSummaryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const querySelected = useMemo(() => parseSelectedServices(searchParams.get("selected")), [searchParams]);

    const [loading, setLoading] = useState(true);
    const [services, setServices] = useState<ServiceEntry[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [setupConfigured, setSetupConfigured] = useState(false);
    const [setupInstalling, setSetupInstalling] = useState(false);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [callbackUrl, setCallbackUrl] = useState("");
    const [returnTo, setReturnTo] = useState("/setupwizard/summary");
    const [copyState, setCopyState] = useState<string | null>(null);
    const [urlCopyState, setUrlCopyState] = useState<string | null>(null);
    const [flowLoading, setFlowLoading] = useState<"test" | "bootstrap" | null>(null);
    const [finalizing, setFinalizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [summaryWarnings, setSummaryWarnings] = useState<string[]>([]);

    const showDebug = shouldShowSetupDebugDetails(debugEnabled);
    const authoritativeSelected = selected.length > 0 ? selected : querySelected;
    const selectedSet = useMemo(() => new Set(authoritativeSelected), [authoritativeSelected]);
    const visibleServices = useMemo(() => [...services]
        .filter((entry) => {
            const name = normalizeString(entry?.name).trim();
            return Boolean(name) && (entry?.installed === true || selectedSet.has(name));
        })
        .sort((left, right) => {
            const leftName = normalizeString(left?.name).trim();
            const rightName = normalizeString(right?.name).trim();
            const leftIndex = ORDER_INDEX.get(leftName);
            const rightIndex = ORDER_INDEX.get(rightName);
            if (typeof leftIndex === "number" && typeof rightIndex === "number") return leftIndex - rightIndex;
            return leftName.localeCompare(rightName);
        }), [selectedSet, services]);
    const openableServices = useMemo(
        () => visibleServices.filter((entry) => entry?.installed === true && normalizeString(entry?.hostServiceUrl).trim()),
        [visibleServices],
    );
    const installedCount = visibleServices.filter((entry) => entry?.installed === true).length;
    const callbackTestedAt = normalizeString(config.lastTestedAt).trim();
    const canCreateSuperuser = Boolean(callbackTestedAt);
    const canFinalize = !setupInstalling && Boolean(normalizeString(authUser?.username).trim()) && hasPermission(authUser?.permissions, "admin");

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            setReturnTo(`${window.location.pathname}${window.location.search}`);
            setSummaryWarnings(consumeSetupSummarySession()?.warnings ?? []);

            try {
                const [servicesRes, configRes, authRes, setupConfigRes, statusRes] = await Promise.all([
                    fetch("/api/noona/services", {cache: "no-store"}),
                    fetch("/api/noona/auth/discord/config", {cache: "no-store"}),
                    fetch("/api/noona/auth/status", {cache: "no-store"}),
                    fetch("/api/noona/setup/config", {cache: "no-store"}),
                    fetch("/api/noona/setup/status", {cache: "no-store"}),
                ]);

                const servicesJson = await servicesRes.json().catch(() => ({}));
                const configJson = await configRes.json().catch(() => ({}));
                const authJson = await authRes.json().catch(() => ({}));
                const setupConfigJson = await setupConfigRes.json().catch(() => ({}));
                const statusJson = (await statusRes.json().catch(() => ({}))) as SetupStatus;
                if (cancelled) return;

                if (!servicesRes.ok) {
                    throw new Error(normalizeString((servicesJson as {
                        error?: unknown
                    }).error).trim() || `Failed to load services (HTTP ${servicesRes.status}).`);
                }

                const snapshot =
                    setupConfigJson && typeof setupConfigJson === "object" && setupConfigJson.snapshot && typeof setupConfigJson.snapshot === "object" && !Array.isArray(setupConfigJson.snapshot)
                        ? setupConfigJson.snapshot as Record<string, unknown>
                        : null;

                setServices(Array.isArray((servicesJson as { services?: unknown }).services) ? (servicesJson as {
                    services: ServiceEntry[]
                }).services : []);
                setSelected(deriveSelectedFromSnapshot(snapshot));
                setConfig(configJson && typeof configJson === "object" ? configJson as Record<string, unknown> : {});
                setAuthUser(authRes.ok && authJson && typeof authJson === "object" ? ((authJson as {
                    user?: AuthUser | null
                }).user ?? null) : null);
                setDebugEnabled(statusJson.debugEnabled === true);
                setSetupConfigured(statusJson.configured === true);
                setSetupInstalling(statusJson.installing === true);
                setCallbackUrl(`${window.location.origin}${normalizeCallbackPath((configJson as {
                    callbackPath?: unknown
                }).callbackPath)}`);

                const authNotice = normalizeString(searchParams.get("discordAuth")).trim();
                const testNotice = normalizeString(searchParams.get("discordTest")).trim();
                if (authNotice === "success") setMessage("Discord login completed. Review the stack, then finalize setup.");
                else if (testNotice === "success") setMessage("Discord callback test completed. You can now create the first Moon superuser.");
                else if (!snapshot && querySelected.length > 0) setMessage("No persisted setup profile was found. Using the legacy selected-services query as a fallback.");
                else setMessage(null);
            } catch (error_) {
                if (cancelled) return;
                setError(error_ instanceof Error ? error_.message : String(error_));
                setCallbackUrl(`${window.location.origin}${normalizeCallbackPath(null)}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [querySelected, searchParams]);

    const beginDiscordFlow = async (mode: "test" | "bootstrap") => {
        setFlowLoading(mode);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch("/api/noona/auth/discord/start", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({mode, returnTo}),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(normalizeString((payload as {
                    error?: unknown
                }).error).trim() || `Discord OAuth start failed (HTTP ${response.status}).`);
            }
            const authorizeUrl = normalizeString((payload as { authorizeUrl?: unknown }).authorizeUrl).trim();
            if (!authorizeUrl) throw new Error("Discord OAuth start succeeded, but no authorize URL was returned.");
            window.location.assign(authorizeUrl);
        } catch (error_) {
            setError(error_ instanceof Error ? error_.message : String(error_));
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
                body: JSON.stringify({}),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(normalizeString((payload as {
                    error?: unknown
                }).error).trim() || `Failed to finalize setup (HTTP ${response.status}).`);
            }
            window.location.assign("/");
        } catch (error_) {
            setError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setFinalizing(false);
        }
    };

    const copyText = async (value: string, success: (message: string) => void, fallback: string) => {
        if (!value || !navigator?.clipboard?.writeText) {
            success(fallback);
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            success("Copied.");
        } catch (error_) {
            success(error_ instanceof Error ? error_.message : String(error_));
        }
    };

    return (
        <Column fillWidth horizontal="center" gap="16" paddingY="24"
                style={{maxWidth: "var(--moon-page-max-width, 116rem)"}}>
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Badge background="brand-alpha-weak" onBackground="neutral-strong">Finish Setup</Badge>
                        <Heading as="h1" variant="display-strong-s">Review the stack and finish Discord setup</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            This page reads the persisted setup profile and live service status. Confirm what is
                            running, open the apps you need, then complete the Discord login flow and finalize setup.
                        </Text>
                    </Column>

                    {!loading && (
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Badge background="neutral-alpha-weak"
                                   onBackground="neutral-strong">{installedCount} running</Badge>
                            <Badge background={setupConfigured ? "success-alpha-weak" : "neutral-alpha-weak"}
                                   onBackground="neutral-strong">
                                {setupConfigured ? "Profile saved" : "Profile missing"}
                            </Badge>
                            {setupInstalling &&
                                <Badge background="brand-alpha-weak" onBackground="neutral-strong">Install in
                                    progress</Badge>}
                            {canFinalize &&
                                <Badge background="success-alpha-weak" onBackground="neutral-strong">Ready to
                                    finalize</Badge>}
                        </Row>
                    )}

                    {loading && <Row fillWidth horizontal="center" paddingY="16"><Spinner/></Row>}

                    {!loading && (
                        <Column gap="16">
                            {error && <Text onBackground="danger-strong">{error}</Text>}
                            {message && <Text onBackground="neutral-weak">{message}</Text>}
                            {summaryWarnings.length > 0 && (
                                <Card fillWidth background="surface" border="warning-alpha-weak" padding="m" radius="l">
                                    <Column gap="8">
                                        <Badge background="warning-alpha-weak" onBackground="warning-strong">
                                            Setup warnings
                                        </Badge>
                                        {summaryWarnings.map((warning) => (
                                            <Text
                                                key={warning}
                                                onBackground="warning-strong"
                                                variant="body-default-xs"
                                            >
                                                {warning}
                                            </Text>
                                        ))}
                                    </Column>
                                </Card>
                            )}

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">What is running</Heading>
                                    {visibleServices.length === 0 &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">No setup services
                                            are visible yet.</Text>}
                                    {visibleServices.map((entry) => {
                                        const name = normalizeString(entry?.name).trim();
                                        const title = TITLES[name] || name || "Service";
                                        const description = normalizeString(entry?.description).trim() || DESCRIPTIONS[name] || "No description available.";
                                        return (
                                            <Card key={name || title} fillWidth background="surface"
                                                  border="neutral-alpha-weak" padding="m" radius="l">
                                                <Column gap="8">
                                                    <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                        <Heading as="h3" variant="heading-strong-m">{title}</Heading>
                                                        <Badge
                                                            background={entry?.installed ? "success-alpha-weak" : "neutral-alpha-weak"}
                                                            onBackground="neutral-strong">
                                                            {entry?.installed ? "Running" : "Pending"}
                                                        </Badge>
                                                        {selectedSet.has(name) && <Badge background="brand-alpha-weak"
                                                                                         onBackground="neutral-strong">In
                                                            setup profile</Badge>}
                                                    </Row>
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-s">{description}</Text>
                                                    {showDebug && name && name !== title &&
                                                        <Text onBackground="neutral-weak"
                                                              variant="body-default-xs">Service: {name}</Text>}
                                                </Column>
                                            </Card>
                                        );
                                    })}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">Where to open it</Heading>
                                    {openableServices.length === 0 &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">No public service
                                            URLs are available yet.</Text>}
                                    {openableServices.map((entry) => {
                                        const name = normalizeString(entry?.name).trim();
                                        const title = TITLES[name] || name || "Service";
                                        const serviceUrl = normalizeString(entry?.hostServiceUrl).trim();
                                        return (
                                            <Row key={`${name}:${serviceUrl}`} fillWidth horizontal="between"
                                                 vertical="center" gap="12" background="surface" padding="12" radius="m"
                                                 style={{flexWrap: "wrap"}}>
                                                <Column gap="4" style={{minWidth: 0}}>
                                                    <Text variant="label-default-s">{title}</Text>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">{serviceUrl}</Text>
                                                </Column>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Button variant="secondary" size="s"
                                                            onClick={() => void copyText(serviceUrl, setUrlCopyState, "Copy the service URL manually.")}>Copy
                                                        URL</Button>
                                                    <Button variant="secondary" size="s"
                                                            onClick={() => window.open(serviceUrl, "_blank", "noopener,noreferrer")}>Open</Button>
                                                </Row>
                                            </Row>
                                        );
                                    })}
                                    {urlCopyState && <Text onBackground="neutral-weak"
                                                           variant="body-default-xs">{urlCopyState}</Text>}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                <Column gap="12">
                                    <Heading as="h2" variant="heading-strong-l">Finish Discord setup</Heading>
                                    {setupInstalling &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Warden is still
                                            installing services. Wait for the install to finish before finalizing
                                            setup.</Text>}
                                    <Input id="discord-callback-url" name="discord-callback-url" label="Callback URL"
                                           value={callbackUrl} readOnly/>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button variant="secondary"
                                                onClick={() => void copyText(callbackUrl, setCopyState, "Copy the callback URL manually.")}>Copy
                                            callback URL</Button>
                                        <Button variant="primary"
                                                disabled={normalizeString(config.clientId).trim() === "" || flowLoading !== null}
                                                onClick={() => void beginDiscordFlow("test")}>
                                            {flowLoading === "test" ? "Testing..." : callbackTestedAt ? "Re-test callback loop" : "Test callback loop"}
                                        </Button>
                                    </Row>
                                    {copyState &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">{copyState}</Text>}
                                    {!normalizeString(config.clientId).trim() &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Discord OAuth client
                                            credentials are not saved yet. Go back to setup if you still need to enter
                                            them.</Text>}
                                    {callbackTestedAt &&
                                        <Text onBackground="success-strong" variant="body-default-xs">Last successful
                                            callback test: {formatIso(callbackTestedAt)}</Text>}
                                    {showDebug && normalizeString(config.clientId).trim() &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Client
                                            ID: {normalizeString(config.clientId).trim()}</Text>}

                                    <Line background="neutral-alpha-weak"/>

                                    {!canCreateSuperuser && !canFinalize &&
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Run the callback
                                            test first to unlock Discord superuser creation.</Text>}
                                    {canCreateSuperuser && !canFinalize && (
                                        <Button variant="primary" disabled={flowLoading !== null}
                                                onClick={() => void beginDiscordFlow("bootstrap")}>
                                            {flowLoading === "bootstrap" ? "Redirecting..." : "Login with Discord"}
                                        </Button>
                                    )}
                                    {canFinalize && (
                                        <Column gap="8">
                                            <Badge background="success-alpha-weak" onBackground="neutral-strong">Superuser
                                                ready</Badge>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">Signed in
                                                as {normalizeString(authUser?.username).trim() || "Discord user"}.</Text>
                                            {showDebug && <Text onBackground="neutral-weak"
                                                                variant="body-default-xs">Provider: {normalizeString(authUser?.authProvider).trim() || "unknown"}{normalizeString(authUser?.discordUserId).trim() ? ` | Discord ID: ${authUser?.discordUserId}` : ""}</Text>}
                                        </Column>
                                    )}

                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Finalize setup after
                                            the running stack looks correct and the Discord superuser is signed
                                            in.</Text>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Button variant="secondary" onClick={() => router.push("/setupwizard")}>Back
                                                to setup</Button>
                                            <Button variant="primary" disabled={!canFinalize || finalizing}
                                                    onClick={() => void finalizeSetup()}>
                                                {finalizing ? "Finalizing..." : "Finalize setup"}
                                            </Button>
                                        </Row>
                                    </Row>
                                </Column>
                            </Card>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
