"use client";

import {useEffect, useMemo, useState} from "react";
import {useSearchParams} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type TabId = "general" | "moon" | "raven" | "vault" | "sage" | "warden" | "portal";
type MainSectionId = "ecosystem" | "users";
type MoonPermission =
    | "moon_login"
    | "lookup_new_title"
    | "download_new_title"
    | "check_download_missing_titles"
    | "user_management"
    | "admin";

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

type DebugSettings = {
    key?: string | null;
    enabled?: boolean | null;
    updatedAt?: string | null;
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
        permissions?: string[] | null;
        isBootstrapUser?: boolean | null;
    } | null;
    error?: string;
};

type ManagedUser = {
    username?: string | null;
    usernameNormalized?: string | null;
    role?: string | null;
    permissions?: string[] | null;
    isBootstrapUser?: boolean | null;
    createdAt?: string | null;
    updatedAt?: string | null;
};

type UsersListResponse = {
    users?: ManagedUser[] | null;
    permissions?: string[] | null;
    error?: string;
};

type UserResetPasswordResponse = {
    ok?: boolean;
    user?: ManagedUser | null;
    password?: string | null;
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

const MOON_PERMISSION_LABELS: Record<MoonPermission, string> = {
    moon_login: "Moon login",
    lookup_new_title: "Lookup new title",
    download_new_title: "Download new title",
    check_download_missing_titles: "Check/download for missing titles",
    user_management: "User management",
    admin: "Admin",
};
const MOON_PERMISSION_ORDER: MoonPermission[] = [
    "moon_login",
    "lookup_new_title",
    "download_new_title",
    "check_download_missing_titles",
    "user_management",
    "admin",
];
const isMoonPermission = (value: unknown): value is MoonPermission =>
    typeof value === "string" && MOON_PERMISSION_ORDER.includes(value as MoonPermission);
const normalizePermissions = (value: unknown): MoonPermission[] => {
    if (!Array.isArray(value)) return [];
    const unique = new Set<MoonPermission>();
    for (const entry of value) {
        if (isMoonPermission(entry)) unique.add(entry);
    }
    return MOON_PERMISSION_ORDER.filter((entry) => unique.has(entry));
};
const hasPermission = (permissions: MoonPermission[], permission: MoonPermission): boolean =>
    permissions.includes("admin") || permissions.includes(permission);

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
const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;
const BG_WARNING_ALPHA_WEAK = "warning-alpha-weak" as const;

export function SettingsPage() {
    const searchParams = useSearchParams();
    const [activeTab, setActiveTab] = useState<TabId>(normalizeTab(searchParams.get("tab")));
    const [activeSection, setActiveSection] = useState<MainSectionId>("ecosystem");
    const [currentPermissions, setCurrentPermissions] = useState<MoonPermission[]>([]);
    const [authStateLoading, setAuthStateLoading] = useState(true);

    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
    const [editors, setEditors] = useState<Record<string, ServiceEditorState>>({});

    const [globalMessage, setGlobalMessage] = useState<string | null>(null);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [ecosystemBusy, setEcosystemBusy] = useState(false);
    const [debugLoading, setDebugLoading] = useState(false);
    const [debugSaving, setDebugSaving] = useState(false);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugUpdatedAt, setDebugUpdatedAt] = useState<string | null>(null);
    const [debugError, setDebugError] = useState<string | null>(null);
    const [debugMessage, setDebugMessage] = useState<string | null>(null);

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
    const [factoryResetPassword, setFactoryResetPassword] = useState("");
    const [factoryResetBusy, setFactoryResetBusy] = useState(false);
    const [factoryResetDeleteRavenDownloads, setFactoryResetDeleteRavenDownloads] = useState(false);
    const [factoryResetDeleteDockers, setFactoryResetDeleteDockers] = useState(false);
    const [factoryResetError, setFactoryResetError] = useState<string | null>(null);
    const [factoryResetMessage, setFactoryResetMessage] = useState<string | null>(null);

    const [usersLoading, setUsersLoading] = useState(false);
    const [usersSaving, setUsersSaving] = useState(false);
    const [usersError, setUsersError] = useState<string | null>(null);
    const [usersMessage, setUsersMessage] = useState<string | null>(null);
    const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
    const [newUserUsername, setNewUserUsername] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserPermissions, setNewUserPermissions] = useState<MoonPermission[]>(["moon_login"]);
    const [editingUser, setEditingUser] = useState<Record<string, {
        username: string;
        permissions: MoonPermission[]
    }>>({});
    const [generatedPasswords, setGeneratedPasswords] = useState<Record<string, string>>({});

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
    const canAccessEcosystem = hasPermission(currentPermissions, "admin");
    const canManageUsers = hasPermission(currentPermissions, "user_management");

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
            if (!res.ok) {
                setCatalogError(parseError(json, `Failed to load services (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                patchEditor(serviceName, {
                    loading: false,
                    error: parseError(json, `Failed to load ${serviceName} config (HTTP ${res.status}).`),
                });
                return;
            }

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
            if (!res.ok) {
                patchEditor(serviceName, {error: parseError(json, `Failed to save ${serviceName} (HTTP ${res.status}).`)});
                return;
            }
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
            if (!res.ok) {
                patchEditor(serviceName, {error: parseError(json, `Failed to restart ${serviceName} (HTTP ${res.status}).`)});
                return;
            }
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
        setAuthStateLoading(true);
        setAccountError(null);
        try {
            const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as AuthStatusResponse | null;
            if (!res.ok) {
                setAccountError(parseError(json, `Failed to load account (HTTP ${res.status}).`));
                return;
            }

            const username = normalizeString(json?.user?.username).trim();
            const role = normalizeString(json?.user?.role).trim() || "member";
            const permissions = normalizePermissions(json?.user?.permissions);
            if (!username) {
                setAccountUser(null);
                setAccountUsername("");
                setCurrentPermissions([]);
                return;
            }
            setAccountUser({username, role});
            setAccountUsername(username);
            setCurrentPermissions(permissions);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setAccountError(msg);
        } finally {
            setAccountLoading(false);
            setAuthStateLoading(false);
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
            if (!res.ok) {
                setAccountError(parseError(json, `Failed to update account (HTTP ${res.status}).`));
                return;
            }

            const updatedUsername = normalizeString(json?.user?.username).trim() || nextUsername;
            const updatedRole = normalizeString(json?.user?.role).trim() || accountUser.role;
            const updatedPermissions = normalizePermissions(json?.user?.permissions);
            setAccountUser({username: updatedUsername, role: updatedRole});
            setAccountUsername(updatedUsername);
            setAccountPassword("");
            setAccountConfirm("");
            setAccountMessage("Account updated.");
            setCurrentPermissions(updatedPermissions);
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
            if (!res.ok) {
                setNamingError(parseError(json, `Failed to load naming settings (HTTP ${res.status}).`));
                return;
            }

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
            if (!res.ok) {
                setNamingError(parseError(json, `Failed to save naming settings (HTTP ${res.status}).`));
                return;
            }
            setNamingMessage("Naming schema saved.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setNamingError(msg);
        } finally {
            setNamingSaving(false);
        }
    };

    const loadDebugSetting = async () => {
        setDebugLoading(true);
        setDebugError(null);
        setDebugMessage(null);
        try {
            const res = await fetch("/api/noona/settings/debug", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as DebugSettings | null;
            if (!res.ok) {
                setDebugError(parseError(json, `Failed to load debug mode (HTTP ${res.status}).`));
                return;
            }

            setDebugEnabled(json?.enabled === true);
            setDebugUpdatedAt(normalizeString(json?.updatedAt).trim() || null);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDebugError(msg);
        } finally {
            setDebugLoading(false);
        }
    };

    const setDebugMode = async (enabled: boolean) => {
        setDebugSaving(true);
        setDebugError(null);
        setDebugMessage(null);
        try {
            const res = await fetch("/api/noona/settings/debug", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({enabled}),
            });
            const json = (await res.json().catch(() => null)) as DebugSettings | null;
            if (!res.ok) {
                setDebugError(parseError(json, `Failed to update debug mode (HTTP ${res.status}).`));
                return;
            }

            setDebugEnabled(json?.enabled === true);
            setDebugUpdatedAt(normalizeString(json?.updatedAt).trim() || new Date().toISOString());
            setDebugMessage(enabled ? "Debug mode enabled live." : "Debug mode disabled live.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDebugError(msg);
        } finally {
            setDebugSaving(false);
        }
    };

    const loadSummary = async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/summary", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as RavenDownloadSummary | null;
            if (!res.ok) {
                setSummaryError(parseError(json, `Failed to load summary (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                setHistoryError(parseError(json, `Failed to load history (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                setCollectionsError(parseError(json, `Failed to load collections (HTTP ${res.status}).`));
                return;
            }

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
            if (!res.ok) {
                setDocumentsError(parseError(json, `Failed to load documents (HTTP ${res.status}).`));
                return;
            }
            setDocuments(Array.isArray(json?.documents) ? json.documents : []);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDocumentsError(msg);
        } finally {
            setDocumentsLoading(false);
        }
    };

    const runFactoryReset = async () => {
        setFactoryResetError(null);
        setFactoryResetMessage(null);

        const password = factoryResetPassword.trim();
        if (!password) {
            setFactoryResetError("Password is required.");
            return;
        }

        const confirmationParts = [
            "Factory reset will wipe Mongo and Redis, then restart Noona as a clean build.",
            factoryResetDeleteRavenDownloads ? "Raven downloads will be deleted." : null,
            factoryResetDeleteDockers ? "Noona Docker containers/images (excluding Warden) will be deleted." : null,
            "Continue?",
        ].filter(Boolean);
        const confirmed = window.confirm(confirmationParts.join(" "));
        if (!confirmed) {
            return;
        }

        setFactoryResetBusy(true);
        try {
            const resetRes = await fetch("/api/noona/settings/factory-reset", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    password,
                    deleteRavenDownloads: factoryResetDeleteRavenDownloads,
                    deleteDockers: factoryResetDeleteDockers,
                }),
            });
            const resetJson = (await resetRes.json().catch(() => null)) as {
                redirectTo?: string;
                error?: string
            } | null;
            if (!resetRes.ok) {
                setFactoryResetError(parseError(resetJson, `Failed to run factory reset (HTTP ${resetRes.status}).`));
                return;
            }

            const redirectTo = normalizeString(resetJson?.redirectTo).trim() || window.location.origin || "/";
            setFactoryResetPassword("");
            setFactoryResetMessage("Factory reset complete. Restarting ecosystem...");
            window.location.assign(redirectTo);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setFactoryResetError(msg);
        } finally {
            setFactoryResetBusy(false);
        }
    };

    const userLookupKey = (user: ManagedUser): string =>
        normalizeString(user.usernameNormalized).trim().toLowerCase() ||
        normalizeString(user.username).trim().toLowerCase();

    const loadManagedUsers = async () => {
        setUsersLoading(true);
        setUsersError(null);
        try {
            const res = await fetch("/api/noona/auth/users", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as UsersListResponse | null;
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to load users (HTTP ${res.status}).`));
                return;
            }

            const list = Array.isArray(json?.users) ? json.users : [];
            setManagedUsers(list);
            setEditingUser(() => {
                const next: Record<string, { username: string; permissions: MoonPermission[] }> = {};
                for (const entry of list) {
                    const key = userLookupKey(entry);
                    if (!key) continue;
                    next[key] = {
                        username: normalizeString(entry.username).trim(),
                        permissions: normalizePermissions(entry.permissions),
                    };
                }
                return next;
            });
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersLoading(false);
        }
    };

    const toggleNewUserPermission = (permission: MoonPermission) => {
        setNewUserPermissions((prev) => {
            const has = prev.includes(permission);
            if (has) {
                return prev.filter((entry) => entry !== permission);
            }
            return MOON_PERMISSION_ORDER.filter((entry) => entry === permission || prev.includes(entry));
        });
    };

    const toggleEditingPermission = (key: string, permission: MoonPermission) => {
        setEditingUser((prev) => {
            const current = prev[key];
            if (!current) return prev;
            const has = current.permissions.includes(permission);
            const permissions = has
                ? current.permissions.filter((entry) => entry !== permission)
                : MOON_PERMISSION_ORDER.filter((entry) => entry === permission || current.permissions.includes(entry));
            return {
                ...prev,
                [key]: {
                    ...current,
                    permissions,
                },
            };
        });
    };

    const setEditingUsername = (key: string, username: string) => {
        setEditingUser((prev) => ({
            ...prev,
            [key]: {
                ...(prev[key] ?? {username: "", permissions: []}),
                username,
            },
        }));
    };

    const createManagedUser = async () => {
        const username = newUserUsername.trim();
        if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
            setUsersError("Username must be 3-64 characters (letters, numbers, ., _, -).");
            return;
        }
        if (newUserPassword.length < 8) {
            setUsersError("Password must be at least 8 characters.");
            return;
        }

        setUsersSaving(true);
        setUsersError(null);
        setUsersMessage(null);
        try {
            const res = await fetch("/api/noona/auth/users", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    username,
                    password: newUserPassword,
                    permissions: newUserPermissions,
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to create user (HTTP ${res.status}).`));
                return;
            }

            setNewUserUsername("");
            setNewUserPassword("");
            setNewUserPermissions(["moon_login"]);
            setUsersMessage(`Created ${username}.`);
            await loadManagedUsers();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersSaving(false);
        }
    };

    const saveManagedUser = async (entry: ManagedUser) => {
        if (entry.isBootstrapUser === true) return;
        const key = userLookupKey(entry);
        const lookup = normalizeString(entry.username).trim();
        const draft = editingUser[key];
        if (!lookup || !draft) return;

        const nextUsername = draft.username.trim();
        if (!/^[A-Za-z0-9._-]{3,64}$/.test(nextUsername)) {
            setUsersError("Username must be 3-64 characters (letters, numbers, ., _, -).");
            return;
        }

        const currentPermissions = normalizePermissions(entry.permissions);
        const nextPermissions = normalizePermissions(draft.permissions);
        const payload: { username?: string; permissions?: MoonPermission[] } = {};
        if (nextUsername !== normalizeString(entry.username).trim()) {
            payload.username = nextUsername;
        }
        if (JSON.stringify(currentPermissions) !== JSON.stringify(nextPermissions)) {
            payload.permissions = nextPermissions;
        }

        if (!payload.username && !payload.permissions) {
            setUsersMessage(`No changes for ${lookup}.`);
            setUsersError(null);
            return;
        }

        setUsersSaving(true);
        setUsersError(null);
        setUsersMessage(null);
        try {
            const res = await fetch(`/api/noona/auth/users/${encodeURIComponent(lookup)}`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to update user (HTTP ${res.status}).`));
                return;
            }

            setUsersMessage(`Updated ${lookup}.`);
            await loadManagedUsers();
            await loadAuthStatus();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersSaving(false);
        }
    };

    const resetManagedUserPassword = async (entry: ManagedUser) => {
        if (entry.isBootstrapUser === true) return;
        const lookup = normalizeString(entry.username).trim();
        const key = userLookupKey(entry);
        if (!lookup || !key) return;

        const confirmed = window.confirm(`Reset password for ${lookup}?`);
        if (!confirmed) return;

        setUsersSaving(true);
        setUsersError(null);
        setUsersMessage(null);
        try {
            const res = await fetch(`/api/noona/auth/users/${encodeURIComponent(lookup)}/reset-password`, {
                method: "POST",
            });
            const json = (await res.json().catch(() => null)) as UserResetPasswordResponse | null;
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to reset password (HTTP ${res.status}).`));
                return;
            }

            const password = normalizeString(json?.password).trim();
            if (password) {
                setGeneratedPasswords((prev) => ({...prev, [key]: password}));
            }
            setUsersMessage(`Password reset for ${lookup}.`);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersSaving(false);
        }
    };

    const deleteManagedUser = async (entry: ManagedUser) => {
        if (entry.isBootstrapUser === true) return;
        const lookup = normalizeString(entry.username).trim();
        const key = userLookupKey(entry);
        if (!lookup || !key) return;

        const confirmed = window.confirm(`Delete user ${lookup}?`);
        if (!confirmed) return;

        setUsersSaving(true);
        setUsersError(null);
        setUsersMessage(null);
        try {
            const res = await fetch(`/api/noona/auth/users/${encodeURIComponent(lookup)}`, {
                method: "DELETE",
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to delete user (HTTP ${res.status}).`));
                return;
            }

            setGeneratedPasswords((prev) => {
                const next = {...prev};
                delete next[key];
                return next;
            });
            setUsersMessage(`Deleted ${lookup}.`);
            await loadManagedUsers();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersSaving(false);
        }
    };

    const loadUpdates = async () => {
        setUpdatesLoading(true);
        setUpdatesError(null);
        try {
            const res = await fetch("/api/noona/settings/services/updates", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setUpdatesError(parseError(json, `Failed to load updates (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                setUpdatesError(parseError(json, `Failed to check updates (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                setUpdatesError(parseError(json, `Failed to update ${serviceName} (HTTP ${res.status}).`));
                return;
            }
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
            if (!res.ok) {
                setGlobalError(parseError(json, `Failed to ${action} ecosystem (HTTP ${res.status}).`));
                return;
            }
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
        void loadAuthStatus();
    }, []);

    useEffect(() => {
        if (authStateLoading || !canAccessEcosystem) return;
        void loadCatalog();
    }, [authStateLoading, canAccessEcosystem]);

    useEffect(() => {
        if (!canAccessEcosystem) return;
        const serviceName = TAB_SERVICE[activeTab];
        if (serviceName) {
            void loadServiceConfig(serviceName);
        }
        if (activeTab === "general") {
            void loadDebugSetting();
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
    }, [activeTab, canAccessEcosystem]);

    useEffect(() => {
        if (activeTab !== "vault") return;
        if (!collection.trim()) return;
        void loadDocuments(collection);
    }, [activeTab, collection]);

    useEffect(() => {
        if (authStateLoading) return;
        if (activeSection === "ecosystem" && !canAccessEcosystem && canManageUsers) {
            setActiveSection("users");
            return;
        }
        if (activeSection === "users" && !canManageUsers && canAccessEcosystem) {
            setActiveSection("ecosystem");
        }
    }, [activeSection, authStateLoading, canAccessEcosystem, canManageUsers]);

    useEffect(() => {
        if (activeSection !== "users" || !canManageUsers) return;
        void loadManagedUsers();
    }, [activeSection, canManageUsers]);

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
            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Row gap="8" vertical="center">
                            <Badge background={BG_NEUTRAL_ALPHA_WEAK}
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
                        <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="m" radius="l">
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

    const renderUserManagement = () => {
        if (!canManageUsers) {
            return (
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        You do not have permission to manage users.
                    </Text>
                </Card>
            );
        }

        const sortedUsers = [...managedUsers].sort((left, right) =>
            normalizeString(left.username).localeCompare(normalizeString(right.username)),
        );

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Heading as="h2" variant="heading-strong-l">Create user</Heading>
                        <Input
                            id="new-user-username"
                            name="new-user-username"
                            label="Username"
                            value={newUserUsername}
                            onChange={(event) => setNewUserUsername(event.target.value)}
                        />
                        <Input
                            id="new-user-password"
                            name="new-user-password"
                            label="Password"
                            type="password"
                            value={newUserPassword}
                            onChange={(event) => setNewUserPassword(event.target.value)}
                        />
                        <Column gap="8">
                            <Text onBackground="neutral-weak" variant="body-default-xs">Permissions</Text>
                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                {MOON_PERMISSION_ORDER.map((permission) => (
                                    <label key={`new-user-permission-${permission}`}
                                           style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={newUserPermissions.includes(permission)}
                                            onChange={() => toggleNewUserPermission(permission)}
                                        />
                                        <Text variant="body-default-xs">{MOON_PERMISSION_LABELS[permission]}</Text>
                                    </label>
                                ))}
                            </Row>
                        </Column>
                        <Button variant="primary" disabled={usersSaving} onClick={() => void createManagedUser()}>
                            {usersSaving ? "Saving..." : "Create user"}
                        </Button>
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center">
                            <Heading as="h2" variant="heading-strong-l">Users</Heading>
                            <Button variant="secondary" disabled={usersLoading || usersSaving}
                                    onClick={() => void loadManagedUsers()}>
                                {usersLoading ? "Loading..." : "Refresh users"}
                            </Button>
                        </Row>
                        {usersError && <Text onBackground="danger-strong" variant="body-default-xs">{usersError}</Text>}
                        {usersMessage &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{usersMessage}</Text>}
                        {usersLoading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!usersLoading && sortedUsers.length === 0 && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">No users found.</Text>
                        )}
                        {!usersLoading && sortedUsers.length > 0 && (
                            <Column gap="12">
                                {sortedUsers.map((entry) => {
                                    const key = userLookupKey(entry);
                                    const fallbackUsername = normalizeString(entry.username).trim();
                                    const draft = editingUser[key] ?? {
                                        username: fallbackUsername,
                                        permissions: normalizePermissions(entry.permissions),
                                    };
                                    const isProtected = entry.isBootstrapUser === true;
                                    const generatedPassword = generatedPasswords[key];

                                    return (
                                        <Card key={key || fallbackUsername} fillWidth background={BG_SURFACE}
                                              border={isProtected ? "warning-alpha-weak" : "neutral-alpha-weak"}
                                              padding="m" radius="l">
                                            <Column gap="8">
                                                <Row horizontal="between" vertical="center" gap="12"
                                                     style={{flexWrap: "wrap"}}>
                                                    <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                        <Heading as="h3"
                                                                 variant="heading-strong-m">{fallbackUsername}</Heading>
                                                        <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                               onBackground="neutral-strong">
                                                            {normalizeString(entry.role).trim() || "member"}
                                                        </Badge>
                                                        {isProtected && (
                                                            <Badge background={BG_WARNING_ALPHA_WEAK}
                                                                   onBackground="neutral-strong">
                                                                Setup user (protected)
                                                            </Badge>
                                                        )}
                                                    </Row>
                                                    {(formatIso(entry.updatedAt) || formatIso(entry.createdAt)) && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {formatIso(entry.updatedAt) ? `updated ${formatIso(entry.updatedAt)}` : `created ${formatIso(entry.createdAt)}`}
                                                        </Text>
                                                    )}
                                                </Row>
                                                <Input
                                                    id={`user-username-${key}`}
                                                    name={`user-username-${key}`}
                                                    label="Username"
                                                    value={draft.username}
                                                    disabled={isProtected || usersSaving}
                                                    onChange={(event) => setEditingUsername(key, event.target.value)}
                                                />
                                                <Column gap="8">
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-xs">Permissions</Text>
                                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                                        {MOON_PERMISSION_ORDER.map((permission) => (
                                                            <label key={`${key}-permission-${permission}`}
                                                                   style={{
                                                                       display: "flex",
                                                                       alignItems: "center",
                                                                       gap: "0.5rem",
                                                                       opacity: isProtected ? 0.7 : 1,
                                                                   }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={draft.permissions.includes(permission)}
                                                                    disabled={isProtected || usersSaving}
                                                                    onChange={() => toggleEditingPermission(key, permission)}
                                                                />
                                                                <Text
                                                                    variant="body-default-xs">{MOON_PERMISSION_LABELS[permission]}</Text>
                                                            </label>
                                                        ))}
                                                    </Row>
                                                </Column>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Button variant="primary" disabled={isProtected || usersSaving}
                                                            onClick={() => void saveManagedUser(entry)}>
                                                        Save user
                                                    </Button>
                                                    <Button variant="secondary" disabled={isProtected || usersSaving}
                                                            onClick={() => void resetManagedUserPassword(entry)}>
                                                        Reset password
                                                    </Button>
                                                    <Button variant="secondary" disabled={isProtected || usersSaving}
                                                            onClick={() => void deleteManagedUser(entry)}>
                                                        Delete user
                                                    </Button>
                                                </Row>
                                                {generatedPassword && (
                                                    <Text onBackground="warning-strong" variant="body-default-xs">
                                                        New password: {generatedPassword}
                                                    </Text>
                                                )}
                                            </Column>
                                        </Card>
                                    );
                                })}
                            </Column>
                        )}
                    </Column>
                </Card>
            </Column>
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
                        {canAccessEcosystem && (
                            <Button variant="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>
                                Refresh services
                            </Button>
                        )}
                    </Row>

                    <Row fillWidth gap="16" vertical="start" s={{style: {flexDirection: "column"}}}>
                        <Card
                            background={BG_SURFACE}
                            border="neutral-alpha-weak"
                            padding="m"
                            radius="l"
                            style={{width: "18rem", maxWidth: "100%", position: "sticky", top: "1rem"}}
                            s={{style: {width: "100%", position: "static", top: "auto"}}}
                        >
                            <Column gap="8">
                                {canAccessEcosystem && (
                                    <Button
                                        fillWidth
                                        variant={activeSection === "ecosystem" ? "primary" : "secondary"}
                                        onClick={() => setActiveSection("ecosystem")}
                                    >
                                        Ecosystem Settings
                                    </Button>
                                )}
                                <Button
                                    fillWidth
                                    variant={activeSection === "users" ? "primary" : "secondary"}
                                    disabled={!canManageUsers}
                                    onClick={() => setActiveSection("users")}
                                >
                                    User Management
                                </Button>
                            </Column>
                        </Card>

                        <Column fillWidth gap="16">
                            {activeSection === "ecosystem" && canAccessEcosystem && (
                                <>
                                    {catalogError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{catalogError}</Text>}
                                    {globalError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{globalError}</Text>}
                                    {globalMessage &&
                                        <Text onBackground="neutral-weak"
                                              variant="body-default-xs">{globalMessage}</Text>}

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
                                        <>
                                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak"
                                                  padding="l"
                                                  radius="l">
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

                                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak"
                                                  padding="l"
                                                  radius="l">
                                                <Column gap="12">
                                                    <Row horizontal="between" vertical="center" gap="12"
                                                         style={{flexWrap: "wrap"}}>
                                                        <Heading as="h2" variant="heading-strong-l">Debug mode</Heading>
                                                        <Badge
                                                            background={debugEnabled ? "warning-alpha-weak" : "neutral-alpha-weak"}
                                                            onBackground="neutral-strong"
                                                        >
                                                            {debugEnabled ? "enabled" : "disabled"}
                                                        </Badge>
                                                    </Row>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Toggle live debug logging across Sage, Warden, Raven, and Vault.
                                                    </Text>
                                                    {formatIso(debugUpdatedAt) && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            last updated: {formatIso(debugUpdatedAt)}
                                                        </Text>
                                                    )}
                                                    {debugError && <Text onBackground="danger-strong"
                                                                         variant="body-default-xs">{debugError}</Text>}
                                                    {debugMessage && <Text onBackground="neutral-weak"
                                                                           variant="body-default-xs">{debugMessage}</Text>}
                                                    {debugLoading && (
                                                        <Row fillWidth horizontal="center" paddingY="12">
                                                            <Spinner/>
                                                        </Row>
                                                    )}
                                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                                        <Button variant="primary" disabled={debugLoading || debugSaving}
                                                                onClick={() => void setDebugMode(!debugEnabled)}>
                                                            {debugSaving ? "Updating..." : debugEnabled ? "Disable debug mode" : "Enable debug mode"}
                                                        </Button>
                                                        <Button variant="secondary"
                                                                disabled={debugLoading || debugSaving}
                                                                onClick={() => void loadDebugSetting()}>
                                                            Refresh
                                                        </Button>
                                                    </Row>
                                                </Column>
                                            </Card>
                                        </>
                    )}

                    {activeTab !== "general" && renderServiceConfig()}

                    {activeTab === "moon" && (
                        <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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
                                            <Badge background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                                active: {typeof summary?.activeDownloads === "number" ? summary.activeDownloads : 0}
                                            </Badge>
                                            <Badge background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                                max
                                                threads: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                                            </Badge>
                                        </Row>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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
                                                    <Card key={`${title}-${index}`} fillWidth background={BG_SURFACE}
                                                          border="neutral-alpha-weak" padding="m" radius="l">
                                                        <Column gap="8">
                                                            <Row horizontal="between" vertical="center" gap="12"
                                                                 style={{flexWrap: "wrap"}}>
                                                                <Text variant="heading-default-s"
                                                                      wrap="balance">{title}</Text>
                                                                <Badge background={BG_NEUTRAL_ALPHA_WEAK}
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
                        <>
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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
                                                        <Card key={`${collection}-${index}`} fillWidth
                                                              background={BG_SURFACE}
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

                            <Card fillWidth background={BG_SURFACE} border="danger-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Heading as="h3" variant="heading-strong-l">Danger zone</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Factory reset wipes Vault storage and restarts Noona as a clean build.
                                    </Text>
                                    <Input
                                        id="vault-factory-reset-password"
                                        name="vault-factory-reset-password"
                                        type="password"
                                        label="Confirm with password"
                                        value={factoryResetPassword}
                                        onChange={(event) => setFactoryResetPassword(event.target.value)}
                                    />
                                    <label style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={factoryResetDeleteRavenDownloads}
                                            onChange={(event) => setFactoryResetDeleteRavenDownloads(event.target.checked)}
                                        />
                                        <Text variant="body-default-xs">Delete Raven&apos;s downloads</Text>
                                    </label>
                                    <label style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={factoryResetDeleteDockers}
                                            onChange={(event) => setFactoryResetDeleteDockers(event.target.checked)}
                                        />
                                        <Text variant="body-default-xs">Delete dockers</Text>
                                    </label>
                                    {factoryResetError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{factoryResetError}</Text>}
                                    {factoryResetMessage &&
                                        <Text onBackground="neutral-weak"
                                              variant="body-default-xs">{factoryResetMessage}</Text>}
                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                        <Button variant="secondary" disabled={factoryResetBusy}
                                                onClick={() => void runFactoryReset()}>
                                            {factoryResetBusy ? "Resetting..." : "Factory Reset"}
                                        </Button>
                                    </Row>
                                </Column>
                            </Card>
                        </>
                    )}

                    {activeTab === "warden" && (
                        <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
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
                                                      background={BG_SURFACE} border="neutral-alpha-weak" padding="m"
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
                                                                disabled={!service || unsupported || updating[service]}
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
                                </>
                            )}

                            {activeSection === "users" && renderUserManagement()}

                            {!authStateLoading && !canAccessEcosystem && !canManageUsers && (
                                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l"
                                      radius="l">
                                    <Column gap="8">
                                        <Heading as="h2" variant="heading-strong-l">No settings access</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Your account does not currently have access to ecosystem settings or user
                                            management.
                                        </Text>
                                    </Column>
                                </Card>
                            )}
                        </Column>
                    </Row>
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
