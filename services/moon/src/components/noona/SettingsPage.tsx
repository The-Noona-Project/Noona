"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Row, Spinner, Switch, Text} from "@once-ui-system/core";
import {
    hasMoonPermission as hasPermission,
    MOON_PERMISSION_DESCRIPTIONS,
    MOON_PERMISSION_LABELS,
    MOON_PERMISSION_ORDER,
    type MoonPermission,
    normalizeMoonPermissions as normalizePermissions,
} from "@/utils/moonPermissions";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";
import {emitNoonaSiteNotification} from "./SiteNotifications";
import {
    buildRebootMonitorTargetKey,
    prioritizeRebootMonitorServices,
    writeRebootMonitorSession,
} from "./rebootMonitorSession";
import editorStyles from "./ConfigEditor.module.scss";
import {
    getSettingsHrefForPortalSubtab,
    KomfApplicationEditor,
    PORTAL_SETTINGS_SUBTABS,
    type PortalSettingsSubtabId,
    SETTINGS_LANDING_HREF,
    SETTINGS_USER_MANAGEMENT_HREF,
    type SettingsMainSectionId as MainSectionId,
    SettingsNavigation,
    type SettingsRouteSelection,
    type SettingsTabId as TabId,
    TAB_LABELS,
} from "./settings";

type ServiceCatalogEntry = {
    name?: string | null;
    description?: string | null;
    image?: string | null;
    health?: string | null;
    hostServiceUrl?: string | null;
    installed?: boolean;
};

type ServiceCatalogResponse = {
    services?: ServiceCatalogEntry[] | null;
    error?: string;
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

type PortalJoinLibraryOption = {
    id?: number | null;
    name?: string | null;
};

type PortalJoinRoleDetail = {
    name?: string | null;
    description?: string | null;
};

type PortalJoinOptionsResponse = {
    roles?: string[] | null;
    roleDetails?: PortalJoinRoleDetail[] | null;
    libraries?: PortalJoinLibraryOption[] | null;
    error?: string;
};

type ServiceUpdateSnapshot = {
    service?: string | null;
    image?: string | null;
    checkedAt?: string | null;
    updateAvailable?: boolean;
    installed?: boolean;
    supported?: boolean;
    error?: string | null;
};

type DownloadNamingSettings = {
    titleTemplate?: string | null;
    chapterTemplate?: string | null;
    pageTemplate?: string | null;
    pagePad?: number | null;
    chapterPad?: number | null;
    updatedAt?: string | null;
    error?: string;
};

type DownloadWorkerSettings = {
    key?: string | null;
    threadRateLimitsKbps?: number[] | null;
    updatedAt?: string | null;
    error?: string;
};

type DefaultUserPermissionsResponse = {
    key?: string | null;
    defaultPermissions?: string[] | null;
    permissions?: string[] | null;
    updatedAt?: string | null;
    error?: string;
};

type DebugSettings = {
    key?: string | null;
    enabled?: boolean | null;
    updatedAt?: string | null;
    error?: string;
};

type AuthStatusResponse = {
    user?: {
        username?: string | null;
        usernameNormalized?: string | null;
        lookupKey?: string | null;
        role?: string | null;
        permissions?: string[] | null;
        isBootstrapUser?: boolean | null;
        authProvider?: string | null;
        discordUserId?: string | null;
        discordUsername?: string | null;
        discordGlobalName?: string | null;
        avatarUrl?: string | null;
        email?: string | null;
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
    lookupKey?: string | null;
    authProvider?: string | null;
    discordUserId?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
};

type UsersListResponse = {
    users?: ManagedUser[] | null;
    permissions?: string[] | null;
    defaultPermissions?: string[] | null;
    error?: string;
};

type UserMutationResponse = {
    ok?: boolean;
    user?: ManagedUser | null;
    deleted?: boolean;
    error?: string;
};

type UserResetPasswordResponse = {
    ok?: boolean;
    user?: ManagedUser | null;
    password?: string | null;
    error?: string;
};

type FactoryResetProgressPhase = "queued" | "waiting" | "recovering";

type FactoryResetProgressState = {
    phase: FactoryResetProgressPhase;
    percent: number;
    detail: string;
    startedAt: number;
    sawDisconnect: boolean;
    stableSuccessCount: number;
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
const TAB_SERVICE: Partial<Record<TabId, string>> = {
    moon: "noona-moon",
    raven: "noona-raven",
    vault: "noona-vault",
    sage: "noona-sage",
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

const PORTAL_JOIN_DEFAULT_KEYS = new Set([
    "PORTAL_JOIN_DEFAULT_ROLES",
    "PORTAL_JOIN_DEFAULT_LIBRARIES",
]);
const PORTAL_DISCORD_KEYS = new Set([
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "DISCORD_GUILD_ROLE_ID",
    "DISCORD_DEFAULT_ROLE_ID",
]);
const PORTAL_COMMAND_ACCESS_KEYS = new Set([
    "REQUIRED_GUILD_ID",
    "REQUIRED_ROLE_DING",
    "REQUIRED_ROLE_JOIN",
    "REQUIRED_ROLE_SCAN",
    "REQUIRED_ROLE_SEARCH",
]);
const PORTAL_SETTINGS_SERVICES: Record<PortalSettingsSubtabId, string> = {
    discord: "noona-portal",
    kavita: "noona-portal",
    komf: "noona-komf",
};
const KOMF_APPLICATION_YML_KEY = "KOMF_APPLICATION_YML";

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const parseBooleanEnvFlag = (value: unknown): boolean => {
    const normalized = normalizeString(value).trim().toLowerCase();
    if (!normalized) return false;
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};
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
const parseCsvSelections = (value: unknown): string[] => {
    const raw = normalizeString(value).trim();
    if (!raw) return [];

    const seen = new Set<string>();
    const out: string[] = [];

    for (const entry of raw.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
    }

    return out;
};
const serializeCsvSelections = (values: string[]): string => values.join(", ");
const isSecretKey = (key: string) => /TOKEN|PASSWORD|API_KEY|SECRET/i.test(key);
const THREAD_RATE_LIMIT_UNLIMITED = "-1";
const THREAD_RATE_LIMIT_MB_MULTIPLIER = 1024;
const THREAD_RATE_LIMIT_GB_MULTIPLIER = 1024 * THREAD_RATE_LIMIT_MB_MULTIPLIER;
const formatThreadRateLimitDraft = (value: unknown): string => {
    if (typeof value === "string") {
        const raw = value.trim().toLowerCase();
        if (!raw || raw === "0" || raw === "-1") {
            return THREAD_RATE_LIMIT_UNLIMITED;
        }

        const normalizedUnitMatch = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb)(?:\/s)?$/i);
        if (normalizedUnitMatch) {
            return `${normalizedUnitMatch[1]}${normalizedUnitMatch[2].toLowerCase()}`;
        }

        const parsedRaw = Number(raw);
        if (!Number.isFinite(parsedRaw) || parsedRaw <= 0) {
            return raw;
        }
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return THREAD_RATE_LIMIT_UNLIMITED;
    }

    const normalized = Math.floor(parsed);
    if (normalized % THREAD_RATE_LIMIT_GB_MULTIPLIER === 0) {
        return `${normalized / THREAD_RATE_LIMIT_GB_MULTIPLIER}gb`;
    }
    if (normalized % THREAD_RATE_LIMIT_MB_MULTIPLIER === 0) {
        return `${normalized / THREAD_RATE_LIMIT_MB_MULTIPLIER}mb`;
    }
    return String(normalized);
};
const normalizeThreadRateLimitDrafts = (value: unknown, threadCount: number): string[] => {
    const normalizedThreadCount = Math.max(1, Math.floor(threadCount || 1));
    const source = Array.isArray(value) ? value : [];
    return Array.from({length: normalizedThreadCount}, (_, index) => {
        return formatThreadRateLimitDraft(source[index]);
    });
};
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
const clampPercent = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};
const shouldTrackFactoryResetRecovery = (message: string): boolean => {
    const normalized = normalizeString(message).toLowerCase();
    if (!normalized) return false;
    if (
        normalized.includes("failed to fetch")
        || normalized.includes("networkerror")
        || normalized.includes("load failed")
    ) return true;
    if (!normalized.includes("/api/settings/factory-reset")) return false;
    return (
        normalized.includes("operation was aborted")
        || normalized.includes("fetch failed")
        || normalized.includes("all backends failed")
    );
};
const FACTORY_RESET_PROGRESS_POLL_MS = 2500;
const FACTORY_RESET_PROGRESS_TIMEOUT_MS = 8 * 60 * 1000;
const FACTORY_RESET_REQUIRED_SERVICES = ["noona-warden", "noona-sage", "noona-moon"] as const;
const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;
const BG_WARNING_ALPHA_WEAK = "warning-alpha-weak" as const;

type SettingsPageProps = {
    selection: SettingsRouteSelection;
};

export function SettingsPage({selection}: SettingsPageProps) {
    const router = useRouter();
    const activeTab = selection.tab;
    const portalSubtab = selection.portalSubtab;
    const activeSection: MainSectionId = selection.section;
    const [currentPermissions, setCurrentPermissions] = useState<MoonPermission[]>([]);
    const [authStateLoading, setAuthStateLoading] = useState(true);

    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
    const [editors, setEditors] = useState<Record<string, ServiceEditorState>>({});
    const [portalJoinOptionsLoading, setPortalJoinOptionsLoading] = useState(false);
    const [portalJoinOptionsError, setPortalJoinOptionsError] = useState<string | null>(null);
    const [portalJoinRoles, setPortalJoinRoles] = useState<string[]>([]);
    const [portalJoinRoleDetails, setPortalJoinRoleDetails] = useState<Array<{
        name: string;
        description: string
    }>>([]);
    const [portalJoinLibraries, setPortalJoinLibraries] = useState<Array<{ id: number; name: string }>>([]);

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
    const [accountUser, setAccountUser] = useState<AuthStatusResponse["user"]>(null);
    const [accountError, setAccountError] = useState<string | null>(null);

    const [updatesLoading, setUpdatesLoading] = useState(false);
    const [updatesChecking, setUpdatesChecking] = useState(false);
    const [updatesError, setUpdatesError] = useState<string | null>(null);
    const [updatesMessage, setUpdatesMessage] = useState<string | null>(null);
    const [updates, setUpdates] = useState<ServiceUpdateSnapshot[]>([]);
    const [updating, setUpdating] = useState<Record<string, boolean>>({});
    const [updatesApplyingAll, setUpdatesApplyingAll] = useState(false);

    const [namingLoading, setNamingLoading] = useState(false);
    const [namingSaving, setNamingSaving] = useState(false);
    const [namingError, setNamingError] = useState<string | null>(null);
    const [namingMessage, setNamingMessage] = useState<string | null>(null);
    const [titleTemplate, setTitleTemplate] = useState("{title}");
    const [chapterTemplate, setChapterTemplate] = useState("Chapter {chapter} [Pages {pages} {domain} - Noona].cbz");
    const [pageTemplate, setPageTemplate] = useState("{page_padded}{ext}");
    const [pagePad, setPagePad] = useState("3");
    const [chapterPad, setChapterPad] = useState("4");
    const [downloadWorkerSettingsLoading, setDownloadWorkerSettingsLoading] = useState(false);
    const [downloadWorkerSettingsSaving, setDownloadWorkerSettingsSaving] = useState(false);
    const [downloadWorkerSettingsError, setDownloadWorkerSettingsError] = useState<string | null>(null);
    const [downloadWorkerSettingsMessage, setDownloadWorkerSettingsMessage] = useState<string | null>(null);
    const [downloadWorkerSettingsUpdatedAt, setDownloadWorkerSettingsUpdatedAt] = useState<string | null>(null);
    const [downloadWorkerRateLimits, setDownloadWorkerRateLimits] = useState<string[]>([THREAD_RATE_LIMIT_UNLIMITED]);

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
    const [factoryResetProgress, setFactoryResetProgress] = useState<FactoryResetProgressState | null>(null);

    const [usersLoading, setUsersLoading] = useState(false);
    const [usersSaving, setUsersSaving] = useState(false);
    const [usersError, setUsersError] = useState<string | null>(null);
    const [usersMessage, setUsersMessage] = useState<string | null>(null);
    const [defaultUserPermissions, setDefaultUserPermissions] = useState<MoonPermission[]>([
        "moon_login",
        "myRecommendations",
    ]);
    const [defaultUserPermissionsSaving, setDefaultUserPermissionsSaving] = useState(false);
    const [defaultUserPermissionsMessage, setDefaultUserPermissionsMessage] = useState<string | null>(null);
    const [defaultUserPermissionsUpdatedAt, setDefaultUserPermissionsUpdatedAt] = useState<string | null>(null);
    const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
    const [newUserDiscordId, setNewUserDiscordId] = useState("");
    const [newUserDisplayName, setNewUserDisplayName] = useState("");
    const [newUserPermissions, setNewUserPermissions] = useState<MoonPermission[]>([
        "moon_login",
        "myRecommendations",
    ]);
    const [editingUser, setEditingUser] = useState<Record<string, {
        username: string;
        permissions: MoonPermission[]
    }>>({});

    const catalogByName = useMemo(() => {
        const out = new Map<string, ServiceCatalogEntry>();
        for (const entry of catalog) {
            const key = normalizeString(entry?.name).trim();
            if (!key) continue;
            out.set(key, entry);
        }
        return out;
    }, [catalog]);

    const installedUpdateSnapshots = useMemo(() => {
        const visible: ServiceUpdateSnapshot[] = [];
        for (const entry of updates) {
            const service = normalizeString(entry?.service).trim();
            if (!service) continue;

            const installed = entry?.installed === true || catalogByName.get(service)?.installed === true;
            if (!installed) {
                continue;
            }

            visible.push({
                ...entry,
                installed,
            });
        }

        return visible;
    }, [catalogByName, updates]);
    const updatesBusy = updatesApplyingAll || Object.values(updating).some(Boolean);

    const currentService = activeTab === "portal"
        ? PORTAL_SETTINGS_SERVICES[portalSubtab]
        : (TAB_SERVICE[activeTab] ?? null);
    const currentEditor = currentService ? (editors[currentService] ?? defaultEditor()) : defaultEditor();
    const currentServiceMeta = currentService ? catalogByName.get(currentService) : null;
    const wardenEditor = editors["noona-warden"] ?? defaultEditor();
    const wardenEnvConfig = Array.isArray(wardenEditor.config?.envConfig) ? wardenEditor.config.envConfig : [];
    const wardenServerIpField = wardenEnvConfig.find((entry) => normalizeString(entry?.key).trim() === "SERVER_IP");
    const wardenAutoUpdatesField = wardenEnvConfig.find((entry) => normalizeString(entry?.key).trim() === "AUTO_UPDATES");
    const wardenHostBaseUrl = normalizeString(wardenEditor.config?.hostServiceUrl).trim();
    const wardenAutoUpdatesEnabled = parseBooleanEnvFlag(wardenEditor.envDraft.AUTO_UPDATES);
    const redisServiceMeta = catalogByName.get("noona-redis") ?? null;
    const redisStackUrl = normalizeString(redisServiceMeta?.hostServiceUrl).trim();
    const ravenThreadCount = useMemo(() => {
        const configured = editors["noona-raven"]?.config?.env?.RAVEN_DOWNLOAD_THREADS;
        const parsed = Number(configured);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.max(1, Math.floor(parsed));
        }
        return 3;
    }, [editors]);
    const canAccessEcosystem = hasPermission(currentPermissions, "admin");
    const canManageUsers = hasPermission(currentPermissions, "user_management");
    const canManageRecommendations = hasPermission(currentPermissions, "manageRecommendations");
    const canShowNav = canAccessEcosystem || canManageUsers;

    const navigateToSettings = (href: string) => {
        router.push(href);
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

    const loadPortalJoinOptions = async () => {
        setPortalJoinOptionsLoading(true);
        setPortalJoinOptionsError(null);
        try {
            const res = await fetch("/api/noona/settings/portal/join-options", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as PortalJoinOptionsResponse | null;
            if (!res.ok) {
                setPortalJoinOptionsError(parseError(json, `Failed to load Portal join options (HTTP ${res.status}).`));
                return;
            }

            const roles = Array.isArray(json?.roles)
                ? json.roles.map((role) => normalizeString(role).trim()).filter(Boolean)
                : [];
            const roleDetails = Array.isArray(json?.roleDetails)
                ? json.roleDetails
                    .map((detail) => ({
                        name: normalizeString(detail?.name).trim(),
                        description: normalizeString(detail?.description).trim(),
                    }))
                    .filter((detail) => detail.name)
                : roles.map((role) => ({name: role, description: ""}));
            const libraries = Array.isArray(json?.libraries)
                ? json.libraries
                    .map((library) => ({
                        id: typeof library?.id === "number" ? library.id : Number.NaN,
                        name: normalizeString(library?.name).trim(),
                    }))
                    .filter((library) => Number.isFinite(library.id) && library.name)
                : [];

            setPortalJoinRoles(roles);
            setPortalJoinRoleDetails(roleDetails);
            setPortalJoinLibraries(libraries);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setPortalJoinOptionsError(msg);
        } finally {
            setPortalJoinOptionsLoading(false);
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

    const saveServiceConfig = async (
        serviceName: string,
        options: { restart?: boolean; successMessage?: string; onSuccess?: () => Promise<void> | void } = {},
    ) => {
        const editor = editors[serviceName] ?? defaultEditor();
        const parsedPort = parsePort(editor.hostPortDraft);
        const shouldRestart = options.restart !== false;
        if (parsedPort === "invalid") {
            patchEditor(serviceName, {error: "Host port must be 1-65535.", message: null});
            return;
        }

        patchEditor(serviceName, {saving: true, error: null, message: null});
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/config`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({env: editor.envDraft, hostPort: parsedPort, restart: shouldRestart}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                patchEditor(serviceName, {error: parseError(json, `Failed to save ${serviceName} (HTTP ${res.status}).`)});
                return;
            }

            if (serviceName === "noona-portal") {
                const clientId = normalizeString(editor.envDraft.DISCORD_CLIENT_ID).trim();
                const clientSecret = normalizeString(editor.envDraft.DISCORD_CLIENT_SECRET).trim();
                if (clientId && clientSecret) {
                    const authConfigRes = await fetch("/api/noona/auth/discord/config", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({clientId, clientSecret}),
                    });
                    const authConfigJson = await authConfigRes.json().catch(() => null);
                    if (!authConfigRes.ok) {
                        patchEditor(serviceName, {
                            error: parseError(authConfigJson, `Saved ${serviceName}, but Discord auth sync failed (HTTP ${authConfigRes.status}).`),
                        });
                        return;
                    }
                }
            }

            patchEditor(serviceName, {
                message: options.successMessage ?? (shouldRestart ? "Saved and restarted service." : "Saved changes."),
            });
            await loadServiceConfig(serviceName);
            if (typeof options.onSuccess === "function") {
                await options.onSuccess();
            }
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
            const permissions = normalizePermissions(json?.user?.permissions);
            if (!username) {
                setAccountUser(null);
                setCurrentPermissions([]);
                return;
            }
            setAccountUser(json?.user ?? null);
            setCurrentPermissions(permissions);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setAccountError(msg);
        } finally {
            setAccountLoading(false);
            setAuthStateLoading(false);
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

    const loadDownloadWorkerSettings = async () => {
        setDownloadWorkerSettingsLoading(true);
        setDownloadWorkerSettingsError(null);
        setDownloadWorkerSettingsMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/workers", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as DownloadWorkerSettings | null;
            if (!res.ok) {
                setDownloadWorkerSettingsError(parseError(json, `Failed to load worker settings (HTTP ${res.status}).`));
                return;
            }

            setDownloadWorkerRateLimits(normalizeThreadRateLimitDrafts(json?.threadRateLimitsKbps, ravenThreadCount));
            setDownloadWorkerSettingsUpdatedAt(normalizeString(json?.updatedAt).trim() || null);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDownloadWorkerSettingsError(msg);
        } finally {
            setDownloadWorkerSettingsLoading(false);
        }
    };

    const saveDownloadWorkerSettings = async () => {
        setDownloadWorkerSettingsSaving(true);
        setDownloadWorkerSettingsError(null);
        setDownloadWorkerSettingsMessage(null);
        try {
            const normalizedRateLimits = normalizeThreadRateLimitDrafts(downloadWorkerRateLimits, ravenThreadCount);
            const res = await fetch("/api/noona/settings/downloads/workers", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    threadRateLimitsKbps: normalizedRateLimits,
                }),
            });
            const json = (await res.json().catch(() => null)) as DownloadWorkerSettings | null;
            if (!res.ok) {
                setDownloadWorkerSettingsError(parseError(json, `Failed to save worker settings (HTTP ${res.status}).`));
                return;
            }

            setDownloadWorkerRateLimits(normalizeThreadRateLimitDrafts(json?.threadRateLimitsKbps, ravenThreadCount));
            setDownloadWorkerSettingsUpdatedAt(normalizeString(json?.updatedAt).trim() || null);
            setDownloadWorkerSettingsMessage("Thread speed limits saved.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDownloadWorkerSettingsError(msg);
        } finally {
            setDownloadWorkerSettingsSaving(false);
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

    const beginFactoryResetRecovery = (detail: string) => {
        setFactoryResetPassword("");
        setFactoryResetMessage("Factory reset queued. Monitoring restart progress...");
        setFactoryResetProgress({
            phase: "queued",
            percent: 8,
            detail,
            startedAt: Date.now(),
            sawDisconnect: false,
            stableSuccessCount: 0,
        });
    };

    const runFactoryReset = async () => {
        setFactoryResetError(null);
        setFactoryResetMessage(null);
        setFactoryResetProgress(null);

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
            const resetJson = (await resetRes.json().catch(() => null)) as { error?: string } | null;
            if (!resetRes.ok) {
                const message = parseError(resetJson, `Failed to run factory reset (HTTP ${resetRes.status}).`);
                const shouldTrack = resetRes.status >= 500 && shouldTrackFactoryResetRecovery(message);
                if (shouldTrack) {
                    beginFactoryResetRecovery("Connection dropped while restart was starting. Waiting for services...");
                    return;
                }
                setFactoryResetError(message);
                setFactoryResetBusy(false);
                return;
            }

            beginFactoryResetRecovery("Factory reset accepted. Waiting for services to restart...");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            if (shouldTrackFactoryResetRecovery(msg)) {
                beginFactoryResetRecovery("Lost connection while reset was running. Waiting for services...");
                return;
            }
            setFactoryResetError(msg);
            setFactoryResetBusy(false);
        }
    };

    const userLookupKey = (user?: {
        lookupKey?: string | null;
        usernameNormalized?: string | null;
        username?: string | null;
        authProvider?: string | null;
        discordUserId?: string | null;
    } | null): string => {
        const authProvider = normalizeString(user?.authProvider).trim().toLowerCase();
        const discordUserId = normalizeString(user?.discordUserId).trim();
        if (authProvider === "discord" && discordUserId) {
            return `discord.${discordUserId.toLowerCase()}`;
        }
        return normalizeString(user?.lookupKey).trim().toLowerCase() ||
            normalizeString(user?.usernameNormalized).trim().toLowerCase() ||
            normalizeString(user?.username).trim().toLowerCase();
    };

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
            const loadedDefaultPermissions = normalizePermissions(json?.defaultPermissions);
            setManagedUsers(list);
            setDefaultUserPermissions(
                loadedDefaultPermissions.length ? loadedDefaultPermissions : ["moon_login", "myRecommendations"],
            );
            if (!newUserDiscordId.trim() && !newUserDisplayName.trim()) {
                setNewUserPermissions(
                    loadedDefaultPermissions.length ? loadedDefaultPermissions : ["moon_login", "myRecommendations"],
                );
            }
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

    const syncManagedUser = (user: ManagedUser, previousLookup = "") => {
        const nextLookup = userLookupKey(user);
        const targetLookup = previousLookup || nextLookup;

        setManagedUsers((prev) => {
            let replaced = false;
            const nextUsers = prev.map((entry) => {
                if (userLookupKey(entry) !== targetLookup) return entry;
                replaced = true;
                return user;
            });
            return replaced ? nextUsers : [user, ...nextUsers];
        });

        setEditingUser((prev) => {
            const next = {...prev};
            if (previousLookup && previousLookup !== nextLookup) {
                delete next[previousLookup];
            }
            if (nextLookup) {
                next[nextLookup] = {
                    username: normalizeString(user.username).trim(),
                    permissions: normalizePermissions(user.permissions),
                };
            }
            return next;
        });
    };

    const toggleDefaultUserPermission = (permission: MoonPermission) => {
        if (permission === "moon_login") return;
        setDefaultUserPermissions((prev) => {
            const has = prev.includes(permission);
            const next = has
                ? prev.filter((entry) => entry !== permission)
                : MOON_PERMISSION_ORDER.filter((entry) => entry === permission || prev.includes(entry));
            if (!next.includes("moon_login")) {
                return normalizePermissions(
                    MOON_PERMISSION_ORDER.filter((entry) => entry === "moon_login" || next.includes(entry)),
                );
            }
            return normalizePermissions(next);
        });
    };

    const toggleNewUserPermission = (permission: MoonPermission) => {
        setNewUserPermissions((prev) => {
            const has = prev.includes(permission);
            if (has) {
                return normalizePermissions(prev.filter((entry) => entry !== permission));
            }
            return normalizePermissions(
                MOON_PERMISSION_ORDER.filter((entry) => entry === permission || prev.includes(entry)),
            );
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
                    permissions: normalizePermissions(permissions),
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

    const saveDefaultUserPermissions = async () => {
        setDefaultUserPermissionsSaving(true);
        setDefaultUserPermissionsMessage(null);
        setUsersError(null);
        try {
            const res = await fetch("/api/noona/auth/users/default-permissions", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    permissions: defaultUserPermissions,
                }),
            });
            const json = (await res.json().catch(() => null)) as DefaultUserPermissionsResponse | null;
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to save default permissions (HTTP ${res.status}).`));
                return;
            }

            const nextDefaults = normalizePermissions(json?.defaultPermissions);
            const safeDefaults: MoonPermission[] = nextDefaults.length ? nextDefaults : ["moon_login"];
            setDefaultUserPermissions(safeDefaults);
            setDefaultUserPermissionsUpdatedAt(normalizeString(json?.updatedAt).trim() || null);
            setDefaultUserPermissionsMessage("Default permissions for new Discord users saved.");
            setNewUserPermissions((prev) =>
                newUserDiscordId.trim() || newUserDisplayName.trim() ? prev : safeDefaults,
            );
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setDefaultUserPermissionsSaving(false);
        }
    };

    const createManagedUser = async () => {
        const discordUserId = newUserDiscordId.trim();
        const displayName = newUserDisplayName.trim();
        if (!/^\d{5,32}$/.test(discordUserId)) {
            setUsersError("Discord user ID must be numeric.");
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
                    username: displayName || `Discord ${discordUserId}`,
                    discordUserId,
                    permissions: newUserPermissions,
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to create user (HTTP ${res.status}).`));
                return;
            }

            setNewUserDiscordId("");
            setNewUserDisplayName("");
            setNewUserPermissions(defaultUserPermissions.length ? defaultUserPermissions : ["moon_login"]);
            setUsersMessage(`Created Discord user ${discordUserId}.`);
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
        const lookup = normalizeString(entry.lookupKey).trim() || key;
        const draft = editingUser[key];
        if (!lookup || !draft) return;

        const nextUsername = draft.username.trim();
        if (!nextUsername) {
            setUsersError("Display name is required.");
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
            const json = (await res.json().catch(() => null)) as UserMutationResponse | null;
            if (!res.ok) {
                setUsersError(parseError(json, `Failed to update user (HTTP ${res.status}).`));
                return;
            }

            const updatedUser = json?.user ?? null;
            if (updatedUser) {
                syncManagedUser(updatedUser, key);
            }
            setUsersMessage(`Updated ${lookup}.`);
            await loadAuthStatus();
            const resultingPermissions = normalizePermissions(updatedUser?.permissions ?? nextPermissions);
            const updatedCurrentUser = userLookupKey(accountUser) === lookup;
            if (updatedCurrentUser && !hasPermission(resultingPermissions, "user_management")) {
                return;
            }
            await loadManagedUsers();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUsersError(msg);
        } finally {
            setUsersSaving(false);
        }
    };

    const deleteManagedUser = async (entry: ManagedUser) => {
        if (entry.isBootstrapUser === true) return;
        const lookup = normalizeString(entry.lookupKey).trim() || userLookupKey(entry);
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

    const listInstalledServiceNames = (): string[] =>
        catalog
            .filter((entry) => entry?.installed === true)
            .map((entry) => normalizeString(entry?.name).trim())
            .filter(Boolean);

    const applyCheckedUpdates = (
        nextUpdates: ServiceUpdateSnapshot[],
        options: { notify?: boolean } = {},
    ): ServiceUpdateSnapshot[] => {
        setUpdates(nextUpdates);

        if (options.notify === false) {
            return nextUpdates;
        }

        const availableUpdates = nextUpdates
            .filter((entry) => entry?.supported !== false && entry?.updateAvailable === true)
            .map((entry) => ({
                service: normalizeString(entry?.service).trim(),
                checkedAt: normalizeString(entry?.checkedAt).trim(),
            }))
            .filter((entry) => entry.service.length > 0);

        if (availableUpdates.length === 0) {
            return nextUpdates;
        }

        const services = availableUpdates
            .map((entry) => entry.service)
            .sort((left, right) => left.localeCompare(right));
        const signature = availableUpdates
            .map((entry) => `${entry.service}:${entry.checkedAt}`)
            .sort((left, right) => left.localeCompare(right))
            .join("|");

        emitNoonaSiteNotification({
            variant: "warning",
            title: "Update available",
            message:
                services.length === 1
                    ? `${services[0]} has a new image update available.`
                    : `${services.length} services have new image updates available.`,
            durationMs: 9000,
            dedupeKey: `update-found:${signature || services.join(",")}`,
        });

        return nextUpdates;
    };

    const requestUpdateCheck = async (
        services: string[],
        options: { notify?: boolean } = {},
    ): Promise<ServiceUpdateSnapshot[]> => {
        const res = await fetch("/api/noona/settings/services/updates", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({services}),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(parseError(json, `Failed to check updates (HTTP ${res.status}).`));
        }

        const nextUpdates = Array.isArray(json?.updates) ? (json.updates as ServiceUpdateSnapshot[]) : [];
        return applyCheckedUpdates(nextUpdates, options);
    };

    const checkUpdates = async () => {
        setUpdatesChecking(true);
        setUpdatesError(null);
        setUpdatesMessage(null);
        try {
            const services = listInstalledServiceNames();
            if (services.length === 0) {
                setUpdatesMessage("No installed services available for update checks.");
                return;
            }
            await requestUpdateCheck(services, {notify: true});
            setUpdatesMessage("Update check finished.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        } finally {
            setUpdatesChecking(false);
        }
    };

    const applyServiceUpdateSnapshot = (snapshot: ServiceUpdateSnapshot | null | undefined, fallbackServiceName: string) => {
        const service = normalizeString(snapshot?.service ?? fallbackServiceName).trim();
        if (!service) return;

        setUpdates((prev) => {
            const nextSnapshot: ServiceUpdateSnapshot = {
                ...snapshot,
                service,
            };
            const index = prev.findIndex((entry) => normalizeString(entry?.service).trim() === service);
            if (index < 0) {
                return [...prev, nextSnapshot];
            }

            const next = [...prev];
            next[index] = {
                ...next[index],
                ...nextSnapshot,
            };
            return next;
        });
    };

    const runServiceImageUpdate = async (serviceName: string, options: { refreshAfter?: boolean } = {}) => {
        const refreshAfter = options.refreshAfter !== false;
        setUpdating((prev) => ({...prev, [serviceName]: true}));
        try {
            const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/update-image`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({restart: true}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(parseError(json, `Failed to update ${serviceName} (HTTP ${res.status}).`));
            }

            const payload = (json ?? {}) as {
                updated?: boolean;
                restarted?: boolean;
                snapshot?: ServiceUpdateSnapshot | null;
            };
            const didUpdate = payload.updated === true;
            const restarted = payload.restarted === true;
            if (payload.snapshot && typeof payload.snapshot === "object") {
                applyServiceUpdateSnapshot(payload.snapshot, serviceName);
            } else {
                applyServiceUpdateSnapshot({
                    service: serviceName,
                    checkedAt: new Date().toISOString(),
                    updateAvailable: false,
                    installed: catalogByName.get(serviceName)?.installed === true,
                }, serviceName);
            }

            if (refreshAfter) {
                await loadUpdates();
            }

            return {
                didUpdate,
                restarted,
            };
        } finally {
            setUpdating((prev) => ({...prev, [serviceName]: false}));
        }
    };

    const updateImage = async (serviceName: string) => {
        setUpdatesError(null);
        setUpdatesMessage(null);
        try {
            const {didUpdate, restarted} = await runServiceImageUpdate(serviceName);
            setUpdatesMessage(didUpdate ? `Updated ${serviceName}.` : `${serviceName} is already on the latest image.`);

            emitNoonaSiteNotification({
                variant: didUpdate ? "success" : "info",
                title: "Update download complete",
                message: didUpdate
                    ? `${serviceName} image download completed${restarted ? " and service restarted." : "."}`
                    : `${serviceName} is already on the latest image.`,
                dedupeKey: `update-download:${serviceName}:${didUpdate ? "updated" : "current"}:${restarted ? "restarted" : "not-restarted"}`,
            });
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        }
    };

    const updateAllImages = async () => {
        setUpdatesApplyingAll(true);
        setUpdatesError(null);
        setUpdatesMessage("Checking installed services for image updates...");

        try {
            const installedServices = listInstalledServiceNames();
            if (installedServices.length === 0) {
                setUpdatesMessage("No installed services available for update checks.");
                return;
            }
            const installedServiceSet = new Set(installedServices);

            const nextUpdates = await requestUpdateCheck(installedServices, {notify: false});
            const services = prioritizeRebootMonitorServices(
                nextUpdates
                    .filter((entry) => entry?.supported !== false && entry?.updateAvailable === true)
                    .map((entry) => normalizeString(entry?.service).trim())
                    .filter((service) => service.length > 0 && installedServiceSet.has(service)),
            );

            if (services.length === 0) {
                setUpdatesMessage("No installed services currently need image updates.");
                return;
            }

            setUpdatesMessage("Opening reboot monitor...");

            if (typeof window !== "undefined") {
                const returnToCandidate = normalizeString(selection.href).trim();
                const returnTo = returnToCandidate.startsWith("/") ? returnToCandidate : "/settings/warden";
                writeRebootMonitorSession({
                    targetServices: services,
                    returnTo,
                    targetKey: buildRebootMonitorTargetKey(services, returnTo),
                    phase: "preparing",
                    phaseDetail: "Preparing reboot monitor...",
                    currentIndex: 0,
                    stableSuccessCount: 0,
                    serviceStates: {},
                    monitorStartedAt: Date.now(),
                    updatedAt: Date.now(),
                });
                const params = new URLSearchParams({
                    services: services.join(","),
                    returnTo,
                });
                window.location.assign(`/rebooting?${params.toString()}`);
                return;
            }
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setUpdatesError(msg);
        } finally {
            setUpdatesApplyingAll(false);
        }
    };

    const restartEcosystem = async () => {
        setEcosystemBusy(true);
        setGlobalError(null);
        setGlobalMessage(null);
        try {
            const res = await fetch("/api/noona/settings/ecosystem/restart", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({trackedOnly: false}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setGlobalError(parseError(json, `Failed to restart ecosystem (HTTP ${res.status}).`));
                return;
            }
            setGlobalMessage("Restart request sent.");
            await loadCatalog();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setGlobalError(msg);
        } finally {
            setEcosystemBusy(false);
        }
    };

    useEffect(() => {
        void loadAuthStatus();
    }, []);

    useEffect(() => {
        if (authStateLoading || !canAccessEcosystem || activeSection !== "ecosystem") return;
        void loadCatalog();
    }, [activeSection, authStateLoading, canAccessEcosystem]);

    useEffect(() => {
        if (!canAccessEcosystem || activeSection !== "ecosystem") return;
        const serviceName = activeTab === "portal"
            ? PORTAL_SETTINGS_SERVICES[portalSubtab]
            : TAB_SERVICE[activeTab];
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
            void loadNaming();
            void loadDownloadWorkerSettings();
        }
        if (activeTab === "vault") {
            void loadCollections();
        }
        if (activeTab === "portal" && portalSubtab === "kavita") {
            void loadPortalJoinOptions();
        }
        if (activeTab === "warden") {
            void loadServiceConfig("noona-warden");
            void loadUpdates();
        }
    }, [activeSection, activeTab, canAccessEcosystem, portalSubtab]);

    useEffect(() => {
        if (activeSection !== "ecosystem" || activeTab !== "vault") return;
        if (!collection.trim()) return;
        void loadDocuments(collection);
    }, [activeSection, activeTab, collection]);

    useEffect(() => {
        if (authStateLoading) return;
        if (activeSection === "ecosystem" && !canAccessEcosystem && canManageUsers) {
            router.replace(SETTINGS_USER_MANAGEMENT_HREF);
            return;
        }
        if (activeSection === "users" && !canManageUsers && canAccessEcosystem) {
            router.replace(SETTINGS_LANDING_HREF);
        }
    }, [activeSection, authStateLoading, canAccessEcosystem, canManageUsers, router]);

    useEffect(() => {
        setDownloadWorkerRateLimits((prev) => normalizeThreadRateLimitDrafts(prev, ravenThreadCount));
    }, [ravenThreadCount]);

    useEffect(() => {
        if (activeSection !== "users" || !canManageUsers) return;
        void loadManagedUsers();
    }, [activeSection, canManageUsers]);

    useEffect(() => {
        if (!factoryResetProgress) return;

        let cancelled = false;
        let timer: number | null = null;

        const pollRecovery = async () => {
            if (cancelled) return;

            const elapsed = Date.now() - factoryResetProgress.startedAt;
            if (elapsed >= FACTORY_RESET_PROGRESS_TIMEOUT_MS) {
                setFactoryResetBusy(false);
                setFactoryResetProgress(null);
                setFactoryResetMessage(null);
                setFactoryResetError("Timed out waiting for ecosystem restart. Check services and try again.");
                return;
            }

            try {
                const res = await fetch("/api/noona/services", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as ServiceCatalogResponse | null;
                if (!res.ok) {
                    throw new Error(parseError(json, `Failed to probe restart status (HTTP ${res.status}).`));
                }

                const services = Array.isArray(json?.services) ? json.services : [];
                const byName = new Map<string, ServiceCatalogEntry>();
                for (const entry of services) {
                    const key = normalizeString(entry?.name).trim();
                    if (!key) continue;
                    byName.set(key, entry);
                }

                const requiredCount = FACTORY_RESET_REQUIRED_SERVICES.length;
                const installedCount = FACTORY_RESET_REQUIRED_SERVICES
                    .filter((serviceName) => byName.get(serviceName)?.installed === true)
                    .length;

                let shouldRefresh = false;
                setFactoryResetProgress((prev) => {
                    if (!prev) return prev;
                    if (!prev.sawDisconnect) {
                        return {
                            ...prev,
                            phase: "queued",
                            percent: Math.max(prev.percent, 14),
                            detail: "Factory reset queued. Waiting for restart to begin...",
                        };
                    }

                    if (installedCount < requiredCount) {
                        return {
                            ...prev,
                            phase: "recovering",
                            percent: clampPercent(45 + Math.round((installedCount / requiredCount) * 45)),
                            detail: `Restarting services (${installedCount}/${requiredCount})...`,
                            stableSuccessCount: 0,
                        };
                    }

                    const stableSuccessCount = prev.stableSuccessCount + 1;
                    shouldRefresh = stableSuccessCount >= 2;

                    return {
                        ...prev,
                        phase: "recovering",
                        percent: 100,
                        detail: shouldRefresh
                            ? "Restart complete. Reloading Noona..."
                            : "Services are back. Verifying stability...",
                        stableSuccessCount,
                    };
                });

                if (shouldRefresh) {
                    setFactoryResetMessage("Restart complete. Reloading Noona...");
                    window.location.assign("/");
                    return;
                }
            } catch {
                const elapsedSeconds = Math.max(1, Math.floor((Date.now() - factoryResetProgress.startedAt) / 1000));
                setFactoryResetProgress((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        phase: "waiting",
                        percent: Math.max(prev.percent, 25),
                        detail: `Waiting for services to restart (${elapsedSeconds}s)...`,
                        sawDisconnect: true,
                        stableSuccessCount: 0,
                    };
                });
            }

            timer = window.setTimeout(() => {
                void pollRecovery();
            }, FACTORY_RESET_PROGRESS_POLL_MS);
        };

        timer = window.setTimeout(() => {
            void pollRecovery();
        }, FACTORY_RESET_PROGRESS_POLL_MS);

        return () => {
            cancelled = true;
            if (timer != null) {
                window.clearTimeout(timer);
            }
        };
    }, [factoryResetProgress?.startedAt]);

    const renderServiceConfig = () => {
        if (!currentService) return null;
        const envConfig = Array.isArray(currentEditor.config?.envConfig) ? currentEditor.config?.envConfig : [];
        const isPortalTab = activeTab === "portal";
        const isPortalService = currentService === "noona-portal";
        const genericFields = envConfig.filter((entry) => {
            const key = normalizeString(entry?.key).trim();
            if (!key) return false;
            if (!isPortalService) return true;
            return !PORTAL_DISCORD_KEYS.has(key)
                && !PORTAL_JOIN_DEFAULT_KEYS.has(key)
                && !PORTAL_COMMAND_ACCESS_KEYS.has(key);
        });
        const portalDiscordFields = envConfig.filter((entry) => PORTAL_DISCORD_KEYS.has(normalizeString(entry?.key).trim()));
        const portalJoinFields = envConfig.filter((entry) => PORTAL_JOIN_DEFAULT_KEYS.has(normalizeString(entry?.key).trim()));
        const portalAccessFields = envConfig.filter((entry) => PORTAL_COMMAND_ACCESS_KEYS.has(normalizeString(entry?.key).trim()));
        const komfConfigFields = genericFields.filter((entry) => normalizeString(entry?.key).trim() === KOMF_APPLICATION_YML_KEY);
        const komfRuntimeFields = genericFields.filter((entry) => normalizeString(entry?.key).trim() !== KOMF_APPLICATION_YML_KEY);

        const getFieldValue = (field: EnvConfigField | undefined) => {
            const key = normalizeString(field?.key).trim();
            if (!key) return "";
            return Object.prototype.hasOwnProperty.call(currentEditor.envDraft, key)
                ? currentEditor.envDraft[key]
                : normalizeString(field?.defaultValue);
        };

        const renderFieldNotes = (field: EnvConfigField) => (
            <>
                {normalizeString(field.description).trim() && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        {normalizeString(field.description).trim()}
                    </Text>
                )}
                {normalizeString(field.warning).trim() && (
                    <Text onBackground="warning-strong" variant="body-default-xs">
                        {normalizeString(field.warning).trim()}
                    </Text>
                )}
            </>
        );

        const renderEditableField = (field: EnvConfigField, keyPrefix = "field") => {
            const key = normalizeString(field.key).trim();
            if (!key) return null;
            if (field.readOnly && !currentEditor.advanced) return null;

            if (key === KOMF_APPLICATION_YML_KEY) {
                return (
                    <Column key={`${currentService}:${keyPrefix}:${key}`} gap="8">
                        <Text variant="label-default-s">{normalizeString(field.label).trim() || key}</Text>
                        <textarea
                            id={`${currentService}:${keyPrefix}:${key}`}
                            name={`${currentService}:${keyPrefix}:${key}`}
                            className={editorStyles.configTextarea}
                            value={getFieldValue(field)}
                            disabled={field.readOnly === true}
                            aria-label={normalizeString(field.label).trim() || key}
                            spellCheck={false}
                            onChange={(event) => updateEnvDraft(currentService, key, event.target.value)}
                        />
                        {renderFieldNotes(field)}
                    </Column>
                );
            }

            return (
                <Column key={`${currentService}:${keyPrefix}:${key}`} gap="8">
                    <Input
                        id={`${currentService}:${keyPrefix}:${key}`}
                        name={`${currentService}:${keyPrefix}:${key}`}
                        label={normalizeString(field.label).trim() || key}
                        type={isSecretKey(key) ? "password" : "text"}
                        value={getFieldValue(field)}
                        disabled={field.readOnly === true}
                        onChange={(event) => updateEnvDraft(currentService, key, event.target.value)}
                    />
                    {renderFieldNotes(field)}
                </Column>
            );
        };

        const renderFieldBlock = (title: string, fields: EnvConfigField[], description?: string, keyPrefix?: string) => {
            const renderedFields = fields
                .map((field) => renderEditableField(field, keyPrefix ?? title.toLowerCase().replace(/\s+/g, "-")))
                .filter(Boolean);
            if (renderedFields.length === 0) return null;

            return (
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="m" radius="l">
                    <Column gap="8">
                        <Heading as="h3" variant="heading-strong-m">{title}</Heading>
                        {description && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">{description}</Text>
                        )}
                        {renderedFields}
                    </Column>
                </Card>
            );
        };

        const renderServiceActions = () => (
            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Heading as="h3" variant="heading-strong-l">Save changes</Heading>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Apply the changes from this settings tab to {currentService}. Saving restarts the service.
                    </Text>
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button
                            variant="primary"
                            disabled={currentEditor.loading || currentEditor.saving || currentEditor.restarting}
                            onClick={() => void saveServiceConfig(currentService)}
                        >
                            {currentEditor.saving ? "Saving..." : "Save changes and restart"}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={currentEditor.loading || currentEditor.saving || currentEditor.restarting}
                            onClick={() => void restartService(currentService)}
                        >
                            {currentEditor.restarting ? "Restarting..." : "Restart service only"}
                        </Button>
                    </Row>
                </Column>
            </Card>
        );

        const portalJoinRoleField = portalJoinFields.find((field) => normalizeString(field.key).trim() === "PORTAL_JOIN_DEFAULT_ROLES");
        const portalJoinLibraryField = portalJoinFields.find((field) => normalizeString(field.key).trim() === "PORTAL_JOIN_DEFAULT_LIBRARIES");
        const selectedJoinRoles = parseCsvSelections(getFieldValue(portalJoinRoleField));
        const selectedJoinLibraries = parseCsvSelections(getFieldValue(portalJoinLibraryField));

        const togglePortalJoinSelection = (fieldKey: string, value: string) => {
            const currentSelections = parseCsvSelections(currentEditor.envDraft[fieldKey]);
            const nextSelections = currentSelections.some((entry) => entry.toLowerCase() === value.toLowerCase())
                ? currentSelections.filter((entry) => entry.toLowerCase() !== value.toLowerCase())
                : [...currentSelections, value];
            updateEnvDraft(currentService, fieldKey, serializeCsvSelections(nextSelections));
        };

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Row gap="8" vertical="center">
                                <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                       onBackground="neutral-strong">{TAB_LABELS[activeTab]}</Badge>
                                {isPortalTab && (
                                    <Badge background={BG_SURFACE} onBackground="neutral-strong">
                                        {PORTAL_SETTINGS_SUBTABS.find((entry) => entry.id === portalSubtab)?.label ?? "Discord"}
                                    </Badge>
                                )}
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
                        {isPortalTab && (
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {PORTAL_SETTINGS_SUBTABS.map((entry) => (
                                    <Button
                                        key={entry.id}
                                        variant={portalSubtab === entry.id ? "primary" : "secondary"}
                                        onClick={() => navigateToSettings(getSettingsHrefForPortalSubtab(entry.id))}
                                    >
                                        {entry.label}
                                    </Button>
                                ))}
                            </Row>
                        )}
                        {currentEditor.error &&
                            <Text onBackground="danger-strong" variant="body-default-xs">{currentEditor.error}</Text>}
                        {currentEditor.message &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{currentEditor.message}</Text>}
                        {currentEditor.loading && <Row fillWidth horizontal="center" paddingY="24"><Spinner/></Row>}
                        {!currentEditor.loading && !isPortalTab && genericFields.map((field) => renderEditableField(field))}
                        {!currentEditor.loading && isPortalTab && isPortalService && portalSubtab === "discord" && (
                            <Column gap="12">
                                {renderFieldBlock(
                                    "Discord bot",
                                    portalDiscordFields,
                                    "These values control which Discord application Portal logs into and which Discord role is assigned after /join.",
                                    "discord",
                                )}
                            </Column>
                        )}
                        {!currentEditor.loading && isPortalTab && isPortalService && portalSubtab === "kavita" && (
                            <Column gap="12">
                                {renderFieldBlock(
                                    "Service connections",
                                    genericFields,
                                    "Portal uses these upstream settings to talk to Kavita, Vault, and Redis-backed onboarding storage.",
                                    "service",
                                )}
                                {renderFieldBlock(
                                    "Command access",
                                    portalAccessFields,
                                    "These settings control which Discord guild and roles are allowed to use Portal commands.",
                                    "access",
                                )}
                            </Column>
                        )}
                        {!currentEditor.loading && isPortalTab && currentService === "noona-komf" && (
                            <Column gap="12">
                                {komfConfigFields[0] && (
                                    <KomfApplicationEditor
                                        label={normalizeString(komfConfigFields[0].label).trim() || "Managed application.yml"}
                                        description={komfConfigFields[0].description}
                                        warning={komfConfigFields[0].warning}
                                        value={getFieldValue(komfConfigFields[0])}
                                        defaultValue={normalizeString(komfConfigFields[0].defaultValue)}
                                        disabled={komfConfigFields[0].readOnly === true}
                                        showRawEditor={currentEditor.advanced}
                                        onChange={(nextValue) =>
                                            updateEnvDraft(currentService, KOMF_APPLICATION_YML_KEY, nextValue)
                                        }
                                    />
                                )}
                                {renderFieldBlock(
                                    "Komf runtime",
                                    komfRuntimeFields,
                                    "These values control the managed Komf container, logging, and its Kavita connection.",
                                    "komf-runtime",
                                )}
                            </Column>
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
                    </Column>
                </Card>

                {isPortalService && portalSubtab === "kavita" && !currentEditor.loading && (portalJoinRoleField || portalJoinLibraryField) && (
                    <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Heading as="h3" variant="heading-strong-l">Join defaults</Heading>
                                <Button variant="secondary" disabled={portalJoinOptionsLoading}
                                        onClick={() => void loadPortalJoinOptions()}>
                                    {portalJoinOptionsLoading ? "Loading..." : "Reload choices"}
                                </Button>
                            </Row>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                These defaults are applied when `/join` creates a Kavita account from Discord.
                            </Text>
                            {portalJoinOptionsError && (
                                <Text onBackground="danger-strong"
                                      variant="body-default-xs">{portalJoinOptionsError}</Text>
                            )}
                            {portalJoinRoleDetails.length > 0 && (
                                <Column gap="8">
                                    <Text onBackground="neutral-weak" variant="label-default-s">Kavita role
                                        reference</Text>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        These are the Kavita roles Portal can assign through `/join`, with a short
                                        summary of what each one unlocks.
                                    </Text>
                                    <Column gap="8">
                                        {portalJoinRoleDetails.map((detail) => (
                                            <Card
                                                key={`portal-join-role-detail-${detail.name}`}
                                                fillWidth
                                                background={BG_NEUTRAL_ALPHA_WEAK}
                                                border="neutral-alpha-weak"
                                                padding="m"
                                                radius="l"
                                            >
                                                <Column gap="8">
                                                    <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                        <Badge
                                                            background={BG_SURFACE}
                                                            onBackground="neutral-strong"
                                                        >
                                                            {detail.name}
                                                        </Badge>
                                                    </Row>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        {detail.description || "No description is available for this Kavita role yet."}
                                                    </Text>
                                                </Column>
                                            </Card>
                                        ))}
                                    </Column>
                                </Column>
                            )}
                            {portalJoinRoleField && (
                                <Column gap="8">
                                    <Input
                                        id={`${currentService}:join:${normalizeString(portalJoinRoleField.key).trim()}`}
                                        name={`${currentService}:join:${normalizeString(portalJoinRoleField.key).trim()}`}
                                        label={normalizeString(portalJoinRoleField.label).trim() || "Default /join Roles"}
                                        value={getFieldValue(portalJoinRoleField)}
                                        onChange={(event) =>
                                            updateEnvDraft(
                                                currentService,
                                                normalizeString(portalJoinRoleField.key).trim(),
                                                event.target.value,
                                            )
                                        }
                                    />
                                    {portalJoinRoles.length > 0 && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {portalJoinRoles.map((role) => {
                                                const selected = selectedJoinRoles.some((entry) => entry.toLowerCase() === role.toLowerCase());
                                                return (
                                                    <Button
                                                        key={`portal-join-role-${role}`}
                                                        variant={selected ? "primary" : "secondary"}
                                                        onClick={() =>
                                                            togglePortalJoinSelection(
                                                                normalizeString(portalJoinRoleField.key).trim(),
                                                                role,
                                                            )
                                                        }
                                                    >
                                                        {role}
                                                    </Button>
                                                );
                                            })}
                                        </Row>
                                    )}
                                    {renderFieldNotes(portalJoinRoleField)}
                                </Column>
                            )}
                            {portalJoinLibraryField && (
                                <Column gap="8">
                                    <Input
                                        id={`${currentService}:join:${normalizeString(portalJoinLibraryField.key).trim()}`}
                                        name={`${currentService}:join:${normalizeString(portalJoinLibraryField.key).trim()}`}
                                        label={normalizeString(portalJoinLibraryField.label).trim() || "Default /join Libraries"}
                                        value={getFieldValue(portalJoinLibraryField)}
                                        onChange={(event) =>
                                            updateEnvDraft(
                                                currentService,
                                                normalizeString(portalJoinLibraryField.key).trim(),
                                                event.target.value,
                                            )
                                        }
                                    />
                                    {portalJoinLibraries.length > 0 && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {portalJoinLibraries.map((library) => {
                                                const selected = selectedJoinLibraries.some((entry) =>
                                                    entry.toLowerCase() === library.name.toLowerCase(),
                                                );
                                                return (
                                                    <Button
                                                        key={`portal-join-library-${library.id}`}
                                                        variant={selected ? "primary" : "secondary"}
                                                        onClick={() =>
                                                            togglePortalJoinSelection(
                                                                normalizeString(portalJoinLibraryField.key).trim(),
                                                                library.name,
                                                            )
                                                        }
                                                    >
                                                        {library.name}
                                                    </Button>
                                                );
                                            })}
                                        </Row>
                                    )}
                                    {renderFieldNotes(portalJoinLibraryField)}
                                </Column>
                            )}
                        </Column>
                    </Card>
                )}

                {isPortalTab && !currentEditor.loading && portalAccessFields.length > 0 && (
                    <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="8">
                            <Heading as="h3" variant="heading-strong-l">Command access</Heading>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Restrict Portal slash commands to the configured Discord guild and role IDs.
                            </Text>
                            {portalAccessFields.map((field) => renderEditableField(field, "command-access"))}
                        </Column>
                    </Card>
                )}

                {!currentEditor.loading && renderServiceActions()}
            </Column>
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
                        <Heading as="h2" variant="heading-strong-l">Default permissions for new Discord users</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            First-time Discord sign-in now creates the user automatically. These permissions become the
                            starting access profile for that new account.
                        </Text>
                        {defaultUserPermissionsUpdatedAt && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Updated {formatIso(defaultUserPermissionsUpdatedAt)}
                            </Text>
                        )}
                        {defaultUserPermissionsMessage && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                {defaultUserPermissionsMessage}
                            </Text>
                        )}
                        <Column gap="8">
                            <Text onBackground="neutral-weak" variant="body-default-xs">Permissions</Text>
                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                {MOON_PERMISSION_ORDER.map((permission) => (
                                    <label key={`default-user-permission-${permission}`}
                                           style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={defaultUserPermissions.includes(permission)}
                                            disabled={permission === "moon_login" || defaultUserPermissionsSaving}
                                            onChange={() => toggleDefaultUserPermission(permission)}
                                        />
                                        <Text variant="body-default-xs">{MOON_PERMISSION_LABELS[permission]}</Text>
                                    </label>
                                ))}
                            </Row>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Moon login stays enabled so the newly created account can complete sign-in.
                            </Text>
                        </Column>
                        <Button
                            variant="primary"
                            disabled={defaultUserPermissionsSaving}
                            onClick={() => void saveDefaultUserPermissions()}
                        >
                            {defaultUserPermissionsSaving ? "Saving..." : "Save default permissions"}
                        </Button>
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Heading as="h2" variant="heading-strong-l">Create Discord user</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Moon access is assigned to Discord-linked accounts. Add the user&apos;s Discord ID, then
                            choose which actions that account can perform after Discord sign-in.
                        </Text>
                        <Input
                            id="new-user-discord-id"
                            name="new-user-discord-id"
                            label="Discord user ID"
                            value={newUserDiscordId}
                            onChange={(event) => setNewUserDiscordId(event.target.value)}
                        />
                        <Input
                            id="new-user-display-name"
                            name="new-user-display-name"
                            label="Display name (optional)"
                            value={newUserDisplayName}
                            onChange={(event) => setNewUserDisplayName(event.target.value)}
                        />
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Users sign in through Discord OAuth. The ID entered here must match their Discord account.
                        </Text>
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
                            <Column gap="8">
                                {MOON_PERMISSION_ORDER.map((permission) => (
                                    <Text key={`new-user-permission-help-${permission}`} onBackground="neutral-weak"
                                          variant="body-default-xs">
                                        {MOON_PERMISSION_LABELS[permission]}: {MOON_PERMISSION_DESCRIPTIONS[permission]}
                                    </Text>
                                ))}
                            </Column>
                        </Column>
                        <Button variant="primary" disabled={usersSaving} onClick={() => void createManagedUser()}>
                            {usersSaving ? "Saving..." : "Create Discord user"}
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
                                    const authProvider = normalizeString(entry.authProvider).trim() || "local";
                                    const discordUserId = normalizeString(entry.discordUserId).trim();

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
                                                        <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                               onBackground="neutral-strong">
                                                            {authProvider}
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
                                                {discordUserId && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Discord ID: {discordUserId}
                                                    </Text>
                                                )}
                                                {normalizeString(entry.discordUsername).trim() && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Discord handle: {normalizeString(entry.discordUsername).trim()}
                                                        {normalizeString(entry.discordGlobalName).trim()
                                                            ? ` (${normalizeString(entry.discordGlobalName).trim()})`
                                                            : ""}
                                                    </Text>
                                                )}
                                                <Input
                                                    id={`user-username-${key}`}
                                                    name={`user-username-${key}`}
                                                    label="Display name"
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
                                                    <Column gap="8">
                                                        {MOON_PERMISSION_ORDER.map((permission) => (
                                                            <Text key={`${key}-permission-help-${permission}`}
                                                                  onBackground="neutral-weak" variant="body-default-xs">
                                                                {MOON_PERMISSION_LABELS[permission]}: {MOON_PERMISSION_DESCRIPTIONS[permission]}
                                                            </Text>
                                                        ))}
                                                    </Column>
                                                </Column>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Button variant="primary" disabled={isProtected || usersSaving}
                                                            onClick={() => void saveManagedUser(entry)}>
                                                        Save user
                                                    </Button>
                                                    <Button variant="secondary" disabled={isProtected || usersSaving}
                                                            onClick={() => void deleteManagedUser(entry)}>
                                                        Delete user
                                                    </Button>
                                                </Row>
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
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    style={{maxWidth: "var(--moon-page-max-width-wide, 124rem)"}}
                >
                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4">
                            <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                <Heading variant="display-strong-s">Settings</Heading>
                                <Badge background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                    {selection.title}
                                </Badge>
                            </Row>
                            <Text onBackground="neutral-weak" wrap="balance">
                                {selection.description}
                            </Text>
                        </Column>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            {canAccessEcosystem && activeSection === "ecosystem" && (
                                <Button variant="secondary" disabled={catalogLoading}
                                        onClick={() => void loadCatalog()}>
                                    Refresh services
                                </Button>
                            )}
                        </Row>
                    </Row>

                    <Row fillWidth gap="16" vertical="start" style={{minWidth: 0}} s={{direction: "column"}}>
                        {canShowNav && (
                            <SettingsNavigation
                                activeSection={activeSection}
                                activeTab={activeTab}
                                portalSubtab={portalSubtab}
                                canAccessEcosystem={canAccessEcosystem}
                                canManageUsers={canManageUsers}
                                onNavigate={navigateToSettings}
                            />
                        )}

                        <Column fillWidth gap="16" style={{flex: "1 1 40rem", minWidth: 0}}>
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
                                                        Restart the full ecosystem from Warden.
                                                    </Text>
                                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                                        <Button variant="primary" disabled={ecosystemBusy}
                                                                onClick={() => void restartEcosystem()}>
                                                            {ecosystemBusy ? "Working..." : "Restart ecosystem"}
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
                                <Heading as="h3" variant="heading-strong-l">Moon account</Heading>
                                {accountLoading && (
                                    <Row fillWidth horizontal="center" paddingY="16">
                                        <Spinner/>
                                    </Row>
                                )}
                                {!accountLoading && (
                                    <Column gap="12">
                                        {accountError && (
                                            <Text onBackground="danger-strong"
                                                  variant="body-default-xs">{accountError}</Text>
                                        )}
                                        {accountUser && (
                                            <>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Signed in
                                                    as {normalizeString(accountUser.username).trim() || "Unknown user"}.
                                                </Text>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Provider: {normalizeString(accountUser.authProvider).trim() || "unknown"}
                                                </Text>
                                                {normalizeString(accountUser.discordUserId).trim() && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Discord ID: {normalizeString(accountUser.discordUserId).trim()}
                                                    </Text>
                                                )}
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Web login is managed by Discord OAuth. Username/password changes are
                                                    no longer part of Moon.
                                                </Text>
                                            </>
                                        )}
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
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4">
                                            <Heading as="h3" variant="heading-strong-l">Thread speed limits</Heading>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                Set a per-thread download cap in KB/s, or type values like 10mb or 1gb.
                                                Use -1 for unlimited speed.
                                            </Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                Raven is currently configured
                                                for {ravenThreadCount} thread{ravenThreadCount === 1 ? "" : "s"}.
                                            </Text>
                                            {downloadWorkerSettingsUpdatedAt && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Updated {formatIso(downloadWorkerSettingsUpdatedAt)}
                                                </Text>
                                            )}
                                        </Column>
                                        <Row gap="8">
                                            <Button
                                                variant="secondary"
                                                disabled={downloadWorkerSettingsLoading}
                                                onClick={() => void loadDownloadWorkerSettings()}
                                            >
                                                Reload
                                            </Button>
                                            <Button
                                                variant="primary"
                                                disabled={downloadWorkerSettingsLoading || downloadWorkerSettingsSaving}
                                                onClick={() => void saveDownloadWorkerSettings()}
                                            >
                                                {downloadWorkerSettingsSaving ? "Saving..." : "Save speed limits"}
                                            </Button>
                                        </Row>
                                    </Row>
                                    {downloadWorkerSettingsError && (
                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                            {downloadWorkerSettingsError}
                                        </Text>
                                    )}
                                    {downloadWorkerSettingsMessage && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            {downloadWorkerSettingsMessage}
                                        </Text>
                                    )}
                                    <Column gap="12">
                                        {normalizeThreadRateLimitDrafts(downloadWorkerRateLimits, ravenThreadCount).map((value, index) => (
                                            <Input
                                                key={`raven-thread-rate-limit-${index + 1}`}
                                                id={`raven-thread-rate-limit-${index + 1}`}
                                                name={`raven-thread-rate-limit-${index + 1}`}
                                                label={`Thread ${index + 1} speed limit`}
                                                type="text"
                                                placeholder="512, 10mb, 1gb, or -1"
                                                value={value}
                                                onChange={(event) => setDownloadWorkerRateLimits((prev) => {
                                                    const next = normalizeThreadRateLimitDrafts(prev, ravenThreadCount);
                                                    next[index] = event.target.value;
                                                    return next;
                                                })}
                                            />
                                        ))}
                                    </Column>
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Heading as="h3" variant="heading-strong-l">Downloads moved</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        Queue controls, worker status, and Raven download history now live in the
                                        Downloads tab.
                                    </Text>
                                    <Row>
                                        <Button variant="secondary" href="/downloads">
                                            Open downloads
                                        </Button>
                                    </Row>
                                </Column>
                            </Card>
                        </>
                    )}

                    {activeTab === "vault" && (
                        <>
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4">
                                            <Heading as="h3" variant="heading-strong-l">Redis Stack viewer</Heading>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                Open the Redis Stack Web UI for the live Noona Redis database.
                                            </Text>
                                            {redisStackUrl && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    {redisStackUrl}
                                                </Text>
                                            )}
                                        </Column>
                                        <Button
                                            variant="secondary"
                                            disabled={!redisStackUrl}
                                            onClick={() => window.open(redisStackUrl, "_blank", "noopener,noreferrer")}
                                        >
                                            View Redis database
                                        </Button>
                                    </Row>
                                    {!redisStackUrl && (
                                        <Text onBackground="warning-strong" variant="body-default-xs">
                                            Redis Stack Web UI is unavailable until `noona-redis` reports a host URL.
                                        </Text>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4">
                                            <Heading as="h3" variant="heading-strong-l">Recommendations
                                                manager</Heading>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                Open the admin recommendation queue for approvals, denials, and timeline
                                                comments.
                                            </Text>
                                        </Column>
                                        <Button
                                            variant="secondary"
                                            href={canManageRecommendations ? "/recommendations" : undefined}
                                            disabled={!canManageRecommendations}
                                        >
                                            Open manage recommendations
                                        </Button>
                                    </Row>
                                    {!canManageRecommendations && (
                                        <Text onBackground="warning-strong" variant="body-default-xs">
                                            You need the `manageRecommendations` permission to access this page.
                                        </Text>
                                    )}
                                </Column>
                            </Card>

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
                                        disabled={factoryResetBusy}
                                        onChange={(event) => setFactoryResetPassword(event.target.value)}
                                    />
                                    <label style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={factoryResetDeleteRavenDownloads}
                                            disabled={factoryResetBusy}
                                            onChange={(event) => setFactoryResetDeleteRavenDownloads(event.target.checked)}
                                        />
                                        <Text variant="body-default-xs">Delete Raven&apos;s downloads</Text>
                                    </label>
                                    <label style={{display: "flex", alignItems: "center", gap: "0.5rem"}}>
                                        <input
                                            type="checkbox"
                                            checked={factoryResetDeleteDockers}
                                            disabled={factoryResetBusy}
                                            onChange={(event) => setFactoryResetDeleteDockers(event.target.checked)}
                                        />
                                        <Text variant="body-default-xs">Delete dockers</Text>
                                    </label>
                                    {factoryResetProgress && (
                                        <Card fillWidth background={BG_SURFACE} border={BG_WARNING_ALPHA_WEAK}
                                              padding="m"
                                              radius="l">
                                            <Column gap="8">
                                                <Row horizontal="between" vertical="center">
                                                    <Text variant="label-default-s">Restart progress</Text>
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-xs">{clampPercent(factoryResetProgress.percent)}%</Text>
                                                </Row>
                                                <Row fillWidth background={BG_NEUTRAL_ALPHA_WEAK} style={{
                                                    height: 8,
                                                    borderRadius: 999,
                                                    overflow: "hidden",
                                                }}>
                                                    <Row background={BG_WARNING_ALPHA_WEAK} style={{
                                                        height: "100%",
                                                        width: `${clampPercent(factoryResetProgress.percent)}%`,
                                                    }}/>
                                                </Row>
                                                <Text onBackground="neutral-weak"
                                                      variant="body-default-xs">{factoryResetProgress.detail}</Text>
                                            </Column>
                                        </Card>
                                    )}
                                    {factoryResetError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{factoryResetError}</Text>}
                                    {factoryResetMessage &&
                                        <Text onBackground="neutral-weak"
                                              variant="body-default-xs">{factoryResetMessage}</Text>}
                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                        <Button variant="secondary" disabled={factoryResetBusy}
                                                onClick={() => void runFactoryReset()}>
                                            {factoryResetProgress ? "Restarting..." : factoryResetBusy ? "Resetting..." : "Factory Reset"}
                                        </Button>
                                    </Row>
                                </Column>
                            </Card>
                        </>
                    )}

                    {activeTab === "warden" && (
                        <Column fillWidth gap="16">
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="8">
                                    <Heading as="h3" variant="heading-strong-l">Warden controls</Heading>
                                    <Text onBackground="neutral-weak" variant="body-default-s">
                                        Warden is the orchestrator for the stack and is not managed through Moon&apos;s
                                        generic save/restart service editor.
                                    </Text>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Use the General tab for ecosystem actions. If Warden itself needs a restart, do
                                        that from your container host or deployment environment.
                                    </Text>
                                </Column>
                            </Card>
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Heading as="h3" variant="heading-strong-l">Warden runtime settings</Heading>
                                        <Row gap="8">
                                            <Button
                                                variant="secondary"
                                                disabled={wardenEditor.loading || wardenEditor.saving}
                                                onClick={() => void loadServiceConfig("noona-warden")}
                                            >
                                                {wardenEditor.loading ? "Loading..." : "Reload"}
                                            </Button>
                                            <Button
                                                variant="primary"
                                                disabled={wardenEditor.loading || wardenEditor.saving}
                                                onClick={() =>
                                                    void saveServiceConfig("noona-warden", {
                                                        restart: false,
                                                        successMessage: "Saved Warden runtime settings.",
                                                        onSuccess: async () => {
                                                            await loadCatalog();
                                                        },
                                                    })
                                                }
                                            >
                                                {wardenEditor.saving ? "Saving..." : "Save Warden settings"}
                                            </Button>
                                        </Row>
                                    </Row>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Warden uses `SERVER_IP` to publish host-facing Noona links, and `AUTO_UPDATES`
                                        controls whether managed Docker images are pulled and applied during startup.
                                    </Text>
                                    {wardenHostBaseUrl && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Current host URL base: {wardenHostBaseUrl}
                                        </Text>
                                    )}
                                    {wardenEditor.error && (
                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                            {wardenEditor.error}
                                        </Text>
                                    )}
                                    {wardenEditor.message && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            {wardenEditor.message}
                                        </Text>
                                    )}
                                    {wardenEditor.loading && (
                                        <Row fillWidth horizontal="center" paddingY="12">
                                            <Spinner/>
                                        </Row>
                                    )}
                                    {!wardenEditor.loading && (wardenServerIpField || wardenAutoUpdatesField) && (
                                        <Column gap="12">
                                            {wardenServerIpField && (
                                                <Column gap="8">
                                                    <Input
                                                        id="warden-server-ip"
                                                        name="warden-server-ip"
                                                        label={normalizeString(wardenServerIpField.label).trim() || "Server IP / Hostname"}
                                                        value={normalizeString(wardenEditor.envDraft.SERVER_IP)}
                                                        onChange={(event) =>
                                                            updateEnvDraft("noona-warden", "SERVER_IP", event.target.value)
                                                        }
                                                    />
                                                    {normalizeString(wardenServerIpField.description).trim() && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {normalizeString(wardenServerIpField.description).trim()}
                                                        </Text>
                                                    )}
                                                    {normalizeString(wardenServerIpField.warning).trim() && (
                                                        <Text onBackground="warning-strong" variant="body-default-xs">
                                                            {normalizeString(wardenServerIpField.warning).trim()}
                                                        </Text>
                                                    )}
                                                </Column>
                                            )}
                                            {wardenAutoUpdatesField && (
                                                <Row
                                                    fillWidth
                                                    horizontal="between"
                                                    vertical="center"
                                                    gap="16"
                                                    background={BG_NEUTRAL_ALPHA_WEAK}
                                                    style={{padding: 12, borderRadius: 16, flexWrap: "wrap"}}
                                                >
                                                    <Column gap="4" style={{flex: "1 1 280px", minWidth: 0}}>
                                                        <Text variant="label-default-s">
                                                            {normalizeString(wardenAutoUpdatesField.label).trim() || "Auto updates"}
                                                        </Text>
                                                        {normalizeString(wardenAutoUpdatesField.description).trim() && (
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                {normalizeString(wardenAutoUpdatesField.description).trim()}
                                                            </Text>
                                                        )}
                                                        {normalizeString(wardenAutoUpdatesField.warning).trim() && (
                                                            <Text onBackground="warning-strong"
                                                                  variant="body-default-xs">
                                                                {normalizeString(wardenAutoUpdatesField.warning).trim()}
                                                            </Text>
                                                        )}
                                                    </Column>
                                                    <Column gap="4" style={{alignItems: "flex-end"}}>
                                                        <Switch
                                                            isChecked={wardenAutoUpdatesEnabled}
                                                            disabled={wardenEditor.saving}
                                                            ariaLabel="Toggle Warden auto updates"
                                                            onToggle={() =>
                                                                updateEnvDraft(
                                                                    "noona-warden",
                                                                    "AUTO_UPDATES",
                                                                    wardenAutoUpdatesEnabled ? "false" : "true",
                                                                )
                                                            }
                                                        />
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {wardenAutoUpdatesEnabled ? "Enabled" : "Disabled"}
                                                        </Text>
                                                    </Column>
                                                </Row>
                                            )}
                                        </Column>
                                    )}
                                </Column>
                            </Card>
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12">
                                        <Heading as="h3" variant="heading-strong-l">Image updates</Heading>
                                        <Row gap="8">
                                            <Button variant="secondary" disabled={updatesLoading || updatesBusy}
                                                    onClick={() => void loadUpdates()}>Reload</Button>
                                            <Button variant="secondary"
                                                    disabled={updatesLoading || updatesChecking || updatesBusy}
                                                    onClick={() => void updateAllImages()}>
                                                {updatesApplyingAll ? "Updating all..." : "Update all"}
                                            </Button>
                                            <Button variant="primary" disabled={updatesChecking || updatesBusy}
                                                    onClick={() => void checkUpdates()}>
                                                {updatesChecking ? "Checking..." : "Check now"}
                                            </Button>
                                        </Row>
                                    </Row>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Warden also checks update digests automatically every hour.
                                    </Text>
                                    {updatesError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{updatesError}</Text>}
                                    {updatesMessage &&
                                        <Text onBackground="neutral-weak"
                                              variant="body-default-xs">{updatesMessage}</Text>}
                                    {updatesLoading && (
                                        <Row fillWidth horizontal="center" paddingY="12">
                                            <Spinner/>
                                        </Row>
                                    )}
                                    {!updatesLoading && installedUpdateSnapshots.length === 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">No update snapshots
                                            available for installed services.</Text>
                                    )}
                                    {!updatesLoading && installedUpdateSnapshots.length > 0 && (
                                        <Column gap="8">
                                            {installedUpdateSnapshots.map((entry, index) => {
                                                const service = normalizeString(entry.service).trim();
                                                const updateAvailable = entry.updateAvailable === true;
                                                const unsupported = entry.supported === false;
                                                const checkedAt = formatIso(entry.checkedAt);
                                                const badgeBackground = unsupported
                                                    ? "danger-alpha-weak"
                                                    : updateAvailable
                                                        ? "warning-alpha-weak"
                                                        : checkedAt
                                                            ? "success-alpha-weak"
                                                            : "neutral-alpha-weak";
                                                const badgeLabel = unsupported
                                                    ? "unsupported"
                                                    : updateAvailable
                                                        ? "update available"
                                                        : checkedAt
                                                            ? "up to date"
                                                            : "not checked";
                                                return (
                                                    <Card key={`${service || "unknown"}-${index}`} fillWidth
                                                          background={BG_SURFACE} border="neutral-alpha-weak"
                                                          padding="m"
                                                          radius="l">
                                                        <Column gap="8">
                                                            <Row horizontal="between" vertical="center" gap="12"
                                                                 style={{flexWrap: "wrap"}}>
                                                                <Row gap="8" vertical="center"
                                                                     style={{flexWrap: "wrap"}}>
                                                                    <Text
                                                                        variant="heading-default-s">{service || "unknown"}</Text>
                                                                    <Badge
                                                                        background={badgeBackground}
                                                                        onBackground="neutral-strong"
                                                                    >
                                                                        {badgeLabel}
                                                                    </Badge>
                                                                </Row>
                                                                <Button
                                                                    variant="secondary"
                                                                    disabled={!service || unsupported || !updateAvailable || updatesApplyingAll || updating[service]}
                                                                    onClick={() => void updateImage(service)}
                                                                >
                                                                    {updating[service] ? "Updating..." : "Update service"}
                                                                </Button>
                                                            </Row>
                                                            {normalizeString(entry.image).trim() && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">image: {normalizeString(entry.image).trim()}</Text>
                                                            )}
                                                            {checkedAt && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">checked: {checkedAt}</Text>
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
                        </Column>
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
