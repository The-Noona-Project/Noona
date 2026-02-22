"use client";

import {useEffect, useMemo, useState} from "react";
import {useSearchParams} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type TabId = "general" | "moon" | "raven" | "vault" | "sage" | "warden" | "portal";

type ServiceCatalogEntry = {
    name?: string | null;
    description?: string | null;
    image?: string | null;
    health?: string | null;
    installed?: boolean;
};

type EnvConfigField = {
    key: string;
    label?: string | null;
    defaultValue?: string | null;
    description?: string | null;
    warning?: string | null;
    required?: boolean;
    readOnly?: boolean;
};

type ServiceConfig = {
    name?: string | null;
    hostServiceUrl?: string | null;
    env?: Record<string, string> | null;
    envConfig?: EnvConfigField[] | null;
    runtimeConfig?: {
        hostPort?: number | null;
    } | null;
    error?: string;
};

type ServiceUpdateSnapshot = {
    service?: string | null;
    image?: string | null;
    checkedAt?: string | null;
    updateAvailable?: boolean;
    supported?: boolean;
    error?: string | null;
};

type DownloadNamingSettings = {
    titleTemplate?: string | null;
    chapterTemplate?: string | null;
    pageTemplate?: string | null;
    pagePad?: number | null;
    chapterPad?: number | null;
    error?: string;
};

type RavenDownloadProgress = {
    title?: string | null;
    totalChapters?: number | null;
    completedChapters?: number | null;
    status?: string | null;
    completedAt?: number | null;
    errorMessage?: string | null;
};

type RavenDownloadSummary = {
    activeDownloads?: number;
    maxThreads?: number;
    error?: string;
};

type AuthStatusResponse = {
    user?: {
        username?: string | null;
        role?: string | null;
    } | null;
    error?: string;
};

type ServiceEditorState = {
    loading: boolean;
    saving: boolean;
    restarting: boolean;
    advanced: boolean;
    error: string | null;
    message: string | null;
    config: ServiceConfig | null;
    envDraft: Record<string, string>;
    hostPortDraft: string;
};

const TAB_ORDER: TabId[] = ["general", "moon", "raven", "vault", "sage", "warden", "portal"];
const TAB_LABELS: Record<TabId, string> = {
    general: "General",
    moon: "Moon",
    raven: "Raven",
    vault: "Vault",
    sage: "Sage",
    warden: "Warden",
    portal: "Portal",
};
const TAB_SERVICE: Partial<Record<TabId, string>> = {
    moon: "noona-moon",
    raven: "noona-raven",
    vault: "noona-vault",
    sage: "noona-sage",
    warden: "noona-warden",
    portal: "noona-portal",
};

const TOKENS = [
    "{title}",
    "{type}",
    "{type_slug}",
    "{chapter}",
    "{chapter_padded}",
    "{pages}",
    "{domain}",
    "{page}",
    "{page_padded}",
    "{ext}",
];

const PORTAL_ROLE_KEYS = new Set([
    "DISCORD_GUILD_ROLE_ID",
    "DISCORD_DEFAULT_ROLE_ID",
    "REQUIRED_GUILD_ID",
    "REQUIRED_ROLE_DING",
    "REQUIRED_ROLE_JOIN",
    "REQUIRED_ROLE_SCAN",
    "REQUIRED_ROLE_SEARCH",
]);

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const normalizeTab = (value: string | null | undefined): TabId =>
    TAB_ORDER.includes(value as TabId) ? (value as TabId) : "general";
const parseError = (payload: unknown, fallback: string): string => {
    if (payload && typeof payload === "object" && "error" in payload) {
        const value = normalizeString((payload as { error?: unknown }).error).trim();
        if (value) return value;
    }
    return fallback;
};
const formatIso = (value: unknown): string => {
    const raw = normalizeString(value).trim();
    if (!raw) return "";
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : raw;
};
const formatEpochMs = (value: unknown): string => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    return new Date(value).toLocaleString();
};
const isSecretKey = (key: string) => /TOKEN|PASSWORD|API_KEY|SECRET/i.test(key);
const defaultEditor = (): ServiceEditorState => ({
    loading: false,
    saving: false,
    restarting: false,
    advanced: false,
    error: null,
    message: null,
    config: null,
    envDraft: {},
    hostPortDraft: "",
});
const parsePort = (raw: string): number | null | "invalid" => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return "invalid";
    const rounded = Math.floor(value);
    if (rounded < 1 || rounded > 65535) return "invalid";
    return rounded;
};

export function SettingsPage() {
    const searchParams = useSearchParams();
    const [activeTab, setActiveTab] = useState<TabId>(normalizeTab(searchParams.get("tab")));

    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
    const [editors, setEditors] = useState<Record<string, ServiceEditorState>>({});

    const [globalMessage, setGlobalMessage] = useState<string | null>(null);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [ecosystemBusy, setEcosystemBusy] = useState(false);

    const [accountLoading, setAccountLoading] = useState(false);
    const [accountUser, setAccountUser] = useState<{ username: string; role: string } | null>(null);
    const [accountUsername, setAccountUsername] = useState("");
    const [accountPassword, setAccountPassword] = useState("");
    const [accountConfirm, setAccountConfirm] = useState("");
    const [accountSaving, setAccountSaving] = useState(false);
    const [accountError, setAccountError] = useState<string | null>(null);
    const [accountMessage, setAccountMessage] = useState<string | null>(null);

    const [updatesLoading, setUpdatesLoading] = useState(false);
    const [updatesChecking, setUpdatesChecking] = useState(false);
    const [updatesError, setUpdatesError] = useState<string | null>(null);
    const [updatesMessage, setUpdatesMessage] = useState<string | null>(null);
    const [updates, setUpdates] = useState<ServiceUpdateSnapshot[]>([]);
    const [updating, setUpdating] = useState<Record<string, boolean>>({});

    const [namingLoading, setNamingLoading] = useState(false);
    const [namingSaving, setNamingSaving] = useState(false);
    const [namingError, setNamingError] = useState<string | null>(null);
    const [namingMessage, setNamingMessage] = useState<string | null>(null);
    const [titleTemplate, setTitleTemplate] = useState("{title}");
    const [chapterTemplate, setChapterTemplate] = useState("Chapter {chapter} [Pages {pages} {domain} - Noona].cbz");
    const [pageTemplate, setPageTemplate] = useState("{page_padded}{ext}");
    const [pagePad, setPagePad] = useState("3");
    const [chapterPad, setChapterPad] = useState("4");

    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summary, setSummary] = useState<RavenDownloadSummary | null>(null);

    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [history, setHistory] = useState<RavenDownloadProgress[]>([]);

    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [collections, setCollections] = useState<string[]>([]);
    const [collection, setCollection] = useState("");
    const [limit, setLimit] = useState("50");
    const [documentsLoading, setDocumentsLoading] = useState(false);
    const [documentsError, setDocumentsError] = useState<string | null>(null);
    const [documents, setDocuments] = useState<unknown[]>([]);

    const catalogByName = useMemo(() => {
        const out = new Map<string, ServiceCatalogEntry>();
        for (const entry of catalog) {
            const key = normalizeString(entry?.name).trim();
            if (!key) continue;
            out.set(key, entry);
        }
        return out;
    }, [catalog]);

    const currentService = TAB_SERVICE[activeTab] ?? null;
    const currentEditor = currentService ? (editors[currentService] ?? defaultEditor()) : defaultEditor();
    const currentServiceMeta = currentService ? catalogByName.get(currentService) : null;

    const setTab = (tab: TabId) => {
        setActiveTab(tab);
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    };

    const patchEditor = (serviceName: string, patch: Partial<ServiceEditorState>) => {
        setEditors((prev) => {
            const current = prev[serviceName] ?? defaultEditor();
            return {...prev, [serviceName]: {...current, ...patch}};
        });
    };

    const loadCatalog = async () => {
        setCatalogLoading(true);
        setCatalogError(null);
        try {
            const res = await fetch("/api/noona/settings/services", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as {
                services?: ServiceCatalogEntry[];
                error?: string
            } | null;
            if (!res.ok) throw new Error(parseError(json, `Failed to load services (HTTP ${res.status}).`));
            setCatalog(Array.isArray(json?.services) ? json.services : []);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setCatalogError(msg);
        } finally {
            setCatalogLoading(false);
        }
    };

    const loadServiceConfig = async (serviceName: string) => {
        patchEditor(serviceName, {loading: true, error: null, message: null});
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/config`, {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as ServiceConfig | null;
            if (!res.ok) throw new Error(parseError(json, `Failed to load ${serviceName} config (HTTP ${res.status}).`));

            const envDraft: Record<string, string> = {};
            if (json?.env && typeof json.env === "object") {
                for (const [key, value] of Object.entries(json.env)) {
                    envDraft[key] = value == null ? "" : String(value);
                }
            }
            const hostPortDraft =
                typeof json?.runtimeConfig?.hostPort === "number" && Number.isFinite(json.runtimeConfig.hostPort)
                    ? String(Math.floor(json.runtimeConfig.hostPort))
                    : "";
            patchEditor(serviceName, {loading: false, config: json, envDraft, hostPortDraft});
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            patchEditor(serviceName, {loading: false, error: msg});
        }
    };

    const updateEnvDraft = (serviceName: string, key: string, value: string) => {
        setEditors((prev) => {
            const current = prev[serviceName] ?? defaultEditor();
            return {
                ...prev,
                [serviceName]: {
                    ...current,
                    envDraft: {...current.envDraft, [key]: value},
                },
            };
        });
    };

    const saveServiceConfig = async (serviceName: string) => {
        const editor = editors[serviceName] ?? defaultEditor();
        const parsedPort = parsePort(editor.hostPortDraft);
        if (parsedPort === "invalid") {
            patchEditor(serviceName, {error: "Host port must be 1-65535.", message: null});
            return;
        }

        patchEditor(serviceName, {saving: true, error: null, message: null});
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/config`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({env: editor.envDraft, hostPort: parsedPort, restart: true}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to save ${serviceName} (HTTP ${res.status}).`));
            patchEditor(serviceName, {message: "Saved and restarted service."});
            await loadServiceConfig(serviceName);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            patchEditor(serviceName, {error: msg});
        } finally {
            patchEditor(serviceName, {saving: false});
        }
    };

    const restartService = async (serviceName: string) => {
        patchEditor(serviceName, {restarting: true, error: null, message: null});
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/restart`, {method: "POST"});
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to restart ${serviceName} (HTTP ${res.status}).`));
            patchEditor(serviceName, {message: "Service restarted."});
            await loadServiceConfig(serviceName);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            patchEditor(serviceName, {error: msg});
        } finally {
            patchEditor(serviceName, {restarting: false});
        }
    };

    const loadAuthStatus = async () => {
        setAccountLoading(true);
        setAccountError(null);
        try {
            const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as AuthStatusResponse | null;
            if (!res.ok) throw new Error(parseError(json, `Failed to load account (HTTP ${res.status}).`));

            const username = normalizeString(json?.user?.username).trim();
            const role = normalizeString(json?.user?.role).trim() || "member";
            if (!username) {
                setAccountUser(null);
                setAccountUsername("");
                return;
            }
            setAccountUser({username, role});
            setAccountUsername(username);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setAccountError(msg);
        } finally {
            setAccountLoading(false);
        }
    };

    const saveAccount = async () => {
        if (!accountUser?.username) {
            setAccountError("No active user session.");
            return;
        }

        const nextUsername = accountUsername.trim();
        if (!/^[A-Za-z0-9._-]{3,64}$/.test(nextUsername)) {
            setAccountError("Username must be 3-64 characters (letters, numbers, ., _, -).");
            return;
        }

        const updatesPayload: Record<string, string> = {};
        if (nextUsername !== accountUser.username) {
            updatesPayload.username = nextUsername;
        }
        if (accountPassword) {
            if (accountPassword.length < 8) {
                setAccountError("Password must be at least 8 characters.");
                return;
            }
            if (accountPassword !== accountConfirm) {
                setAccountError("Passwords do not match.");
                return;
            }
            updatesPayload.password = accountPassword;
        }
        if (Object.keys(updatesPayload).length === 0) {
            setAccountMessage("No account changes to save.");
            setAccountError(null);
            return;
        }

        setAccountSaving(true);
        setAccountError(null);
        setAccountMessage(null);
        try {
            const res = await fetch(`/api/noona/auth/users/${encodeURIComponent(accountUser.username)}`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(updatesPayload),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to update account (HTTP ${res.status}).`));

            const updatedUsername = normalizeString(json?.user?.username).trim() || nextUsername;
            const updatedRole = normalizeString(json?.user?.role).trim() || accountUser.role;
            setAccountUser({username: updatedUsername, role: updatedRole});
            setAccountUsername(updatedUsername);
            setAccountPassword("");
            setAccountConfirm("");
            setAccountMessage("Account updated.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setAccountError(msg);
        } finally {
            setAccountSaving(false);
        }
    };

    const loadNaming = async () => {
        setNamingLoading(true);
        setNamingError(null);
        setNamingMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/naming", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as DownloadNamingSettings | null;
            if (!res.ok) throw new Error(parseError(json, `Failed to load naming settings (HTTP ${res.status}).`));

            setTitleTemplate(normalizeString(json?.titleTemplate).trim() || "{title}");
            setChapterTemplate(normalizeString(json?.chapterTemplate).trim() || "Chapter {chapter} [Pages {pages} {domain} - Noona].cbz");
            setPageTemplate(normalizeString(json?.pageTemplate).trim() || "{page_padded}{ext}");
            setPagePad(String(Number.isFinite(Number(json?.pagePad)) && Number(json?.pagePad) > 0 ? Math.floor(Number(json?.pagePad)) : 3));
            setChapterPad(String(Number.isFinite(Number(json?.chapterPad)) && Number(json?.chapterPad) > 0 ? Math.floor(Number(json?.chapterPad)) : 4));
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setNamingError(msg);
        } finally {
            setNamingLoading(false);
        }
    };

    const saveNaming = async () => {
        setNamingSaving(true);
        setNamingError(null);
        setNamingMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/naming", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    titleTemplate,
                    chapterTemplate,
                    pageTemplate,
                    pagePad: Number(pagePad),
                    chapterPad: Number(chapterPad),
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to save naming settings (HTTP ${res.status}).`));
            setNamingMessage("Naming schema saved.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setNamingError(msg);
        } finally {
            setNamingSaving(false);
        }
    };

    const loadSummary = async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/summary", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as RavenDownloadSummary | null;
            if (!res.ok) throw new Error(parseError(json, `Failed to load summary (HTTP ${res.status}).`));
            setSummary(json ?? {});
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setSummaryError(msg);
        } finally {
            setSummaryLoading(false);
        }
    };

    const loadHistory = async () => {
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/history", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to load history (HTTP ${res.status}).`));
            setHistory(Array.isArray(json) ? json : []);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setHistoryError(msg);
        } finally {
            setHistoryLoading(false);
        }
    };

    const loadCollections = async () => {
        setCollectionsLoading(true);
        setCollectionsError(null);
        try {
            const res = await fetch("/api/noona/settings/vault/collections", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to load collections (HTTP ${res.status}).`));

            const next = Array.isArray(json?.collections) ? json.collections.filter((entry: unknown) => typeof entry === "string") : [];
            setCollections(next);
            if (!next.includes(collection)) {
                setCollection(next[0] ?? "");
            }
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setCollectionsError(msg);
        } finally {
            setCollectionsLoading(false);
        }
    };

    const loadDocuments = async (collectionName: string, rawLimit = limit) => {
        const safeCollection = collectionName.trim();
        if (!safeCollection) {
            setDocuments([]);
            return;
        }
        const parsed = Number(rawLimit);
        const safeLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.floor(parsed))) : 50;

        setDocumentsLoading(true);
        setDocumentsError(null);
        try {
            const res = await fetch(
                `/api/noona/settings/vault/collections/${encodeURIComponent(safeCollection)}/documents?limit=${safeLimit}`,
                {cache: "no-store"},
            );
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to load documents (HTTP ${res.status}).`));
            setDocuments(Array.isArray(json?.documents) ? json.documents : []);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDocumentsError(msg);
        } finally {
            setDocumentsLoading(false);
        }
    };

    const loadUpdates = async () => {
        setUpdatesLoading(true);
        setUpdatesError(null);
        try {
            const res = await fetch("/api/noona/settings/services/updates", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to load updates (HTTP ${res.status}).`));
            setUpdates(Array.isArray(json?.updates) ? json.updates : []);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        } finally {
            setUpdatesLoading(false);
        }
    };

    const checkUpdates = async () => {
        setUpdatesChecking(true);
        setUpdatesError(null);
        setUpdatesMessage(null);
        try {
            const services = catalog.map((entry) => normalizeString(entry?.name).trim()).filter(Boolean);
            const res = await fetch("/api/noona/settings/services/updates", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({services}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to check updates (HTTP ${res.status}).`));
            setUpdates(Array.isArray(json?.updates) ? json.updates : []);
            setUpdatesMessage("Update check finished.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        } finally {
            setUpdatesChecking(false);
        }
    };

    const updateImage = async (serviceName: string) => {
        setUpdating((prev) => ({...prev, [serviceName]: true}));
        setUpdatesError(null);
        setUpdatesMessage(null);
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/update-image`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({restart: true}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to update ${serviceName} (HTTP ${res.status}).`));
            setUpdatesMessage(`Updated ${serviceName}.`);
            await loadUpdates();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        } finally {
            setUpdating((prev) => ({...prev, [serviceName]: false}));
        }
    };

    const ecosystemAction = async (action: "start" | "stop") => {
        setEcosystemBusy(true);
        setGlobalError(null);
        setGlobalMessage(null);
        try {
            const res = await fetch(`/api/noona/settings/ecosystem/${action}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({trackedOnly: false}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(parseError(json, `Failed to ${action} ecosystem (HTTP ${res.status}).`));
            setGlobalMessage(action === "start" ? "Start request sent." : "Stop request sent.");
            await loadCatalog();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setGlobalError(msg);
        } finally {
            setEcosystemBusy(false);
        }
    };

    useEffect(() => {
        setActiveTab(normalizeTab(searchParams.get("tab")));
    }, [searchParams]);

    useEffect(() => {
        void loadCatalog();
    }, []);

    useEffect(() => {
        const serviceName = TAB_SERVICE[activeTab];
        if (serviceName) {
            void loadServiceConfig(serviceName);
        }
        if (activeTab === "moon") {
            void loadAuthStatus();
        }
        if (activeTab === "raven") {
            void Promise.all([loadNaming(), loadSummary(), loadHistory()]);
        }
        if (activeTab === "vault") {
            void loadCollections();
        }
        if (activeTab === "warden") {
            void loadUpdates();
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== "vault") return;
        if (!collection.trim()) return;
        void loadDocuments(collection);
    }, [activeTab, collection]);

    const renderServiceConfig = () => {
        if (!currentService) return null;
        const envConfig = Array.isArray(currentEditor.config?.envConfig) ? currentEditor.config?.envConfig : [];
        const mainFields = envConfig.filter((entry) => {
            if (!entry?.key) return false;
            if (activeTab !== "portal") return true;
            return !PORTAL_ROLE_KEYS.has(entry.key);
        });
        const roleFields = envConfig.filter((entry) => entry?.key && PORTAL_ROLE_KEYS.has(entry.key));

        return (
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Row gap="8" vertical="center">
                            <Badge background="neutral-alpha-weak"
                                   onBackground="neutral-strong">{TAB_LABELS[activeTab]}</Badge>
                            <Heading as="h2" variant="heading-strong-l">{currentService}</Heading>
                        </Row>
                        <Button variant="secondary"
                                onClick={() => patchEditor(currentService, {advanced: !currentEditor.advanced})}>
                            {currentEditor.advanced ? "Hide advanced options" : "Advanced options"}
                        </Button>
                    </Row>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        {normalizeString(currentServiceMeta?.description).trim() || "No description available."}
                    </Text>
                    {currentEditor.error &&
                        <Text onBackground="danger-strong" variant="body-default-xs">{currentEditor.error}</Text>}
                    {currentEditor.message &&
                        <Text onBackground="neutral-weak" variant="body-default-xs">{currentEditor.message}</Text>}
                    {currentEditor.loading && <Row fillWidth horizontal="center" paddingY="24"><Spinner/></Row>}
                    {!currentEditor.loading && mainFields.map((field) => {
                        const key = normalizeString(field.key).trim();
                        if (!key) return null;
                        if (field.readOnly && !currentEditor.advanced) return null;
                        const value = Object.prototype.hasOwnProperty.call(currentEditor.envDraft, key)
                            ? currentEditor.envDraft[key]
                            : normalizeString(field.defaultValue);
                        return (
                            <Column key={`${currentService}:${key}`} gap="8">
                                <Input
                                    id={`${currentService}:${key}`}
                                    name={`${currentService}:${key}`}
                                    label={normalizeString(field.label).trim() || key}
                                    type={isSecretKey(key) ? "password" : "text"}
                                    value={value}
                                    disabled={field.readOnly === true}
                                    onChange={(event) => updateEnvDraft(currentService, key, event.target.value)}
                                />
                                {normalizeString(field.description).trim() && (
                                    <Text onBackground="neutral-weak"
                                          variant="body-default-xs">{normalizeString(field.description).trim()}</Text>
                                )}
                            </Column>
                        );
                    })}
                    {activeTab === "portal" && roleFields.length > 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                            <Column gap="8">
                                <Heading as="h3" variant="heading-strong-m">Command role IDs</Heading>
                                {roleFields.map((field) => {
                                    const key = normalizeString(field.key).trim();
                                    const value = Object.prototype.hasOwnProperty.call(currentEditor.envDraft, key)
                                        ? currentEditor.envDraft[key]
                                        : normalizeString(field.defaultValue);
                                    return (
                                        <Input
                                            key={`${currentService}:role:${key}`}
                                            id={`${currentService}:role:${key}`}
                                            name={`${currentService}:role:${key}`}
                                            label={normalizeString(field.label).trim() || key}
                                            value={value}
                                            onChange={(event) => updateEnvDraft(currentService, key, event.target.value)}
                                        />
                                    );
                                })}
                            </Column>
                        </Card>
                    )}
                    {currentEditor.advanced && (
                        <Input
                            id={`${currentService}:hostPort`}
                            name={`${currentService}:hostPort`}
                            type="number"
                            label="Host port override"
                            value={currentEditor.hostPortDraft}
                            onChange={(event) => patchEditor(currentService, {hostPortDraft: event.target.value})}
                        />
                    )}
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="primary" disabled={currentEditor.saving || currentEditor.restarting}
                                onClick={() => void saveServiceConfig(currentService)}>
                            {currentEditor.saving ? "Saving..." : "Save and restart service"}
                        </Button>
                        <Button variant="secondary" disabled={currentEditor.saving || currentEditor.restarting}
                                onClick={() => void restartService(currentService)}>
                            {currentEditor.restarting ? "Restarting..." : "Restart only"}
                        </Button>
                    </Row>
                </Column>
            </Card>
        );
    };

    return (
        <SetupModeGate>
            <AuthGate>
                <Column maxWidth="l" horizontal="center" gap="16" paddingY="24">
                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4">
                            <Heading variant="display-strong-s">Settings</Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Manage services, account credentials, updates, and tooling.
                            </Text>
                        </Column>
                        <Button variant="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>
                            Refresh services
                        </Button>
                    </Row>

                    {catalogError && <Text onBackground="danger-strong" variant="body-default-xs">{catalogError}</Text>}
                    {globalError && <Text onBackground="danger-strong" variant="body-default-xs">{globalError}</Text>}
                    {globalMessage &&
                        <Text onBackground="neutral-weak" variant="body-default-xs">{globalMessage}</Text>}

                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        {TAB_ORDER.map((tab) => (
                            <Button key={tab} variant={activeTab === tab ? "primary" : "secondary"}
                                    onClick={() => setTab(tab)}>
                                {TAB_LABELS[tab]}
                            </Button>
                        ))}
                    </Row>

                    {catalogLoading && (
                        <Row fillWidth horizontal="center" paddingY="24">
                            <Spinner/>
                        </Row>
                    )}

                    {activeTab === "general" && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h2" variant="heading-strong-l">Ecosystem</Heading>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Start or stop the full ecosystem from Warden.
                                </Text>
                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                    <Button variant="primary" disabled={ecosystemBusy}
                                            onClick={() => void ecosystemAction("start")}>
                                        {ecosystemBusy ? "Working..." : "Start ecosystem"}
                                    </Button>
                                    <Button variant="secondary" disabled={ecosystemBusy}
                                            onClick={() => void ecosystemAction("stop")}>
                                        {ecosystemBusy ? "Working..." : "Stop ecosystem"}
                                    </Button>
                                </Row>
                            </Column>
                        </Card>
                    )}

                    {activeTab !== "general" && renderServiceConfig()}

                    {activeTab === "moon" && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h3" variant="heading-strong-l">Username/password change</Heading>
                                {accountLoading && (
                                    <Row fillWidth horizontal="center" paddingY="16">
                                        <Spinner/>
                                    </Row>
                                )}
                                {!accountLoading && (
                                    <Column gap="12">
                                        <Input
                                            id="moon-username"
                                            name="moon-username"
                                            label="Username"
                                            value={accountUsername}
                                            onChange={(event) => setAccountUsername(event.target.value)}
                                        />
                                        <Input
                                            id="moon-password"
                                            name="moon-password"
                                            label="New password"
                                            type="password"
                                            value={accountPassword}
                                            onChange={(event) => setAccountPassword(event.target.value)}
                                        />
                                        <Input
                                            id="moon-confirm"
                                            name="moon-confirm"
                                            label="Confirm new password"
                                            type="password"
                                            value={accountConfirm}
                                            onChange={(event) => setAccountConfirm(event.target.value)}
                                        />
                                        {accountError && <Text onBackground="danger-strong"
                                                               variant="body-default-xs">{accountError}</Text>}
                                        {accountMessage && <Text onBackground="neutral-weak"
                                                                 variant="body-default-xs">{accountMessage}</Text>}
                                        <Button variant="primary" disabled={accountSaving}
                                                onClick={() => void saveAccount()}>
                                            {accountSaving ? "Saving..." : "Save account"}
                                        </Button>
                                    </Column>
                                )}
                            </Column>
                        </Card>
                    )}

                    {activeTab === "raven" && (
                        <>
                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Heading as="h3" variant="heading-strong-l">Naming schema</Heading>
                                        <Row gap="8">
                                            <Button variant="secondary" disabled={namingLoading}
                                                    onClick={() => void loadNaming()}>
                                                Reload
                                            </Button>
                                            <Button variant="primary" disabled={namingLoading || namingSaving}
                                                    onClick={() => void saveNaming()}>
                                                {namingSaving ? "Saving..." : "Save naming"}
                                            </Button>
                                        </Row>
                                    </Row>
                                    <Text onBackground="neutral-weak"
                                          variant="body-default-xs">Tokens: {TOKENS.join(" ")}</Text>
                                    {namingError && <Text onBackground="danger-strong"
                                                          variant="body-default-xs">{namingError}</Text>}
                                    {namingMessage && <Text onBackground="neutral-weak"
                                                            variant="body-default-xs">{namingMessage}</Text>}
                                    <Input id="titleTemplate" name="titleTemplate" label="Title template"
                                           value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)}/>
                                    <Input id="chapterTemplate" name="chapterTemplate" label="Chapter template"
                                           value={chapterTemplate}
                                           onChange={(e) => setChapterTemplate(e.target.value)}/>
                                    <Input id="pageTemplate" name="pageTemplate" label="Page template"
                                           value={pageTemplate} onChange={(e) => setPageTemplate(e.target.value)}/>
                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                        <Input id="pagePad" name="pagePad" label="Page padding" type="number"
                                               value={pagePad} onChange={(e) => setPagePad(e.target.value)}/>
                                        <Input id="chapterPad" name="chapterPad" label="Chapter padding" type="number"
                                               value={chapterPad} onChange={(e) => setChapterPad(e.target.value)}/>
                                    </Row>
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="8">
                                    <Row horizontal="between" vertical="center">
                                        <Heading as="h3" variant="heading-strong-l">Download workers</Heading>
                                        <Button variant="secondary" disabled={summaryLoading}
                                                onClick={() => void loadSummary()}>
                                            Refresh
                                        </Button>
                                    </Row>
                                    {summaryError && <Text onBackground="danger-strong"
                                                           variant="body-default-xs">{summaryError}</Text>}
                                    {summaryLoading && (
                                        <Row fillWidth horizontal="center" paddingY="12">
                                            <Spinner/>
                                        </Row>
                                    )}
                                    {!summaryLoading && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                active: {typeof summary?.activeDownloads === "number" ? summary.activeDownloads : 0}
                                            </Badge>
                                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                max
                                                threads: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                                            </Badge>
                                        </Row>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="8" id="raven-history">
                                    <Row horizontal="between" vertical="center">
                                        <Heading as="h3" variant="heading-strong-l">Download history</Heading>
                                        <Button variant="secondary" disabled={historyLoading}
                                                onClick={() => void loadHistory()}>
                                            Refresh
                                        </Button>
                                    </Row>
                                    {historyError && <Text onBackground="danger-strong"
                                                           variant="body-default-xs">{historyError}</Text>}
                                    {historyLoading && (
                                        <Row fillWidth horizontal="center" paddingY="12">
                                            <Spinner/>
                                        </Row>
                                    )}
                                    {!historyLoading && history.length === 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">No history
                                            yet.</Text>
                                    )}
                                    {!historyLoading && history.length > 0 && (
                                        <Column gap="8">
                                            {history.map((entry, index) => {
                                                const title = normalizeString(entry.title).trim() || "Untitled";
                                                const status = normalizeString(entry.status).trim() || "unknown";
                                                const total = typeof entry.totalChapters === "number" && Number.isFinite(entry.totalChapters) ? entry.totalChapters : 0;
                                                const done = typeof entry.completedChapters === "number" && Number.isFinite(entry.completedChapters) ? entry.completedChapters : 0;
                                                return (
                                                    <Card key={`${title}-${index}`} fillWidth background="surface"
                                                          border="neutral-alpha-weak" padding="m" radius="l">
                                                        <Column gap="8">
                                                            <Row horizontal="between" vertical="center" gap="12"
                                                                 style={{flexWrap: "wrap"}}>
                                                                <Text variant="heading-default-s"
                                                                      wrap="balance">{title}</Text>
                                                                <Badge background="neutral-alpha-weak"
                                                                       onBackground="neutral-strong">{status}</Badge>
                                                            </Row>
                                                            <Text onBackground="neutral-weak"
                                                                  variant="body-default-xs">Chapters: {done}/{total || "?"}</Text>
                                                            {formatEpochMs(entry.completedAt) && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">Completed: {formatEpochMs(entry.completedAt)}</Text>
                                                            )}
                                                            {normalizeString(entry.errorMessage).trim() && (
                                                                <Text onBackground="danger-strong"
                                                                      variant="body-default-xs">{normalizeString(entry.errorMessage).trim()}</Text>
                                                            )}
                                                        </Column>
                                                    </Card>
                                                );
                                            })}
                                        </Column>
                                    )}
                                </Column>
                            </Card>
                        </>
                    )}

                    {activeTab === "vault" && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Row horizontal="between" vertical="center">
                                    <Heading as="h3" variant="heading-strong-l">Collection viewer</Heading>
                                    <Button variant="secondary" disabled={collectionsLoading}
                                            onClick={() => void loadCollections()}>
                                        Refresh collections
                                    </Button>
                                </Row>
                                {collectionsError && <Text onBackground="danger-strong"
                                                           variant="body-default-xs">{collectionsError}</Text>}
                                {collectionsLoading && (
                                    <Row fillWidth horizontal="center" paddingY="12">
                                        <Spinner/>
                                    </Row>
                                )}
                                {!collectionsLoading && (
                                    <Column gap="12">
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {collections.map((name) => (
                                                <Button key={name}
                                                        variant={collection === name ? "primary" : "secondary"}
                                                        onClick={() => setCollection(name)}>
                                                    {name}
                                                </Button>
                                            ))}
                                        </Row>
                                        {collection && (
                                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                                <Input id="vault-limit" name="vault-limit" type="number"
                                                       label="Document limit" value={limit}
                                                       onChange={(e) => setLimit(e.target.value)}/>
                                                <Button variant="secondary" disabled={documentsLoading}
                                                        onClick={() => void loadDocuments(collection, limit)}>
                                                    {documentsLoading ? "Loading..." : "Load documents"}
                                                </Button>
                                            </Row>
                                        )}
                                        {documentsError && <Text onBackground="danger-strong"
                                                                 variant="body-default-xs">{documentsError}</Text>}
                                        {documents.length > 0 && (
                                            <Column gap="8">
                                                {documents.map((entry, index) => (
                                                    <Card key={`${collection}-${index}`} fillWidth background="surface"
                                                          border="neutral-alpha-weak" padding="m" radius="l">
                                                        <Text variant="body-default-xs" style={{
                                                            whiteSpace: "pre-wrap",
                                                            fontFamily: "var(--font-code)"
                                                        }}>
                                                            {JSON.stringify(entry, null, 2)}
                                                        </Text>
                                                    </Card>
                                                ))}
                                            </Column>
                                        )}
                                    </Column>
                                )}
                            </Column>
                        </Card>
                    )}

                    {activeTab === "warden" && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12">
                                    <Heading as="h3" variant="heading-strong-l">Image updates</Heading>
                                    <Row gap="8">
                                        <Button variant="secondary" disabled={updatesLoading}
                                                onClick={() => void loadUpdates()}>Reload</Button>
                                        <Button variant="primary" disabled={updatesChecking}
                                                onClick={() => void checkUpdates()}>
                                            {updatesChecking ? "Checking..." : "Check now"}
                                        </Button>
                                    </Row>
                                </Row>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Warden also checks update digests automatically every hour.
                                </Text>
                                {updatesError &&
                                    <Text onBackground="danger-strong" variant="body-default-xs">{updatesError}</Text>}
                                {updatesMessage &&
                                    <Text onBackground="neutral-weak" variant="body-default-xs">{updatesMessage}</Text>}
                                {updatesLoading && (
                                    <Row fillWidth horizontal="center" paddingY="12">
                                        <Spinner/>
                                    </Row>
                                )}
                                {!updatesLoading && updates.length === 0 && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">No update snapshots
                                        available.</Text>
                                )}
                                {!updatesLoading && updates.length > 0 && (
                                    <Column gap="8">
                                        {updates.map((entry, index) => {
                                            const service = normalizeString(entry.service).trim();
                                            const updateAvailable = entry.updateAvailable === true;
                                            const unsupported = entry.supported === false;
                                            return (
                                                <Card key={`${service || "unknown"}-${index}`} fillWidth
                                                      background="surface" border="neutral-alpha-weak" padding="m"
                                                      radius="l">
                                                    <Column gap="8">
                                                        <Row horizontal="between" vertical="center" gap="12"
                                                             style={{flexWrap: "wrap"}}>
                                                            <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                                <Text
                                                                    variant="heading-default-s">{service || "unknown"}</Text>
                                                                <Badge
                                                                    background={unsupported ? "danger-alpha-weak" : updateAvailable ? "warning-alpha-weak" : "success-alpha-weak"}
                                                                    onBackground="neutral-strong"
                                                                >
                                                                    {unsupported ? "unsupported" : updateAvailable ? "update available" : "up to date"}
                                                                </Badge>
                                                            </Row>
                                                            <Button
                                                                variant="secondary"
                                                                disabled={!service || unsupported || updating[service] === true}
                                                                onClick={() => void updateImage(service)}
                                                            >
                                                                {updating[service] ? "Updating..." : "Update service"}
                                                            </Button>
                                                        </Row>
                                                        {normalizeString(entry.image).trim() && (
                                                            <Text onBackground="neutral-weak"
                                                                  variant="body-default-xs">image: {normalizeString(entry.image).trim()}</Text>
                                                        )}
                                                        {formatIso(entry.checkedAt) && (
                                                            <Text onBackground="neutral-weak"
                                                                  variant="body-default-xs">checked: {formatIso(entry.checkedAt)}</Text>
                                                        )}
                                                        {normalizeString(entry.error).trim() && (
                                                            <Text onBackground="danger-strong"
                                                                  variant="body-default-xs">{normalizeString(entry.error).trim()}</Text>
                                                        )}
                                                    </Column>
                                                </Card>
                                            );
                                        })}
                                    </Column>
                                )}
                            </Column>
                        </Card>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
