"use client";

import {type ChangeEvent, useEffect, useMemo, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {
    Badge,
    Button,
    Card,
    Column,
    Heading,
    InfiniteScroll,
    Input,
    Row,
    Spinner,
    Switch,
    Text
} from "@once-ui-system/core";
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
import settingsStyles from "./SettingsPage.module.scss";
import {
    getSettingsHrefForPortalSubtab,
    getSettingsHrefForView,
    KomfApplicationEditor,
    PORTAL_SETTINGS_SUBTABS,
    type PortalSettingsSubtabId,
    SETTINGS_LANDING_HREF,
    SETTINGS_USER_MANAGEMENT_HREF,
    type SettingsMainSectionId as MainSectionId,
    SettingsNavigation,
    type SettingsNavSectionId as NavSectionId,
    type SettingsRouteSelection,
    type SettingsTabId as TabId,
    type SettingsViewId as ViewId,
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

type StorageLayoutFolder = {
    key?: string | null;
    hostPath?: string | null;
    containerPath?: string | null;
};

type StorageLayoutService = {
    service?: string | null;
    label?: string | null;
    folders?: StorageLayoutFolder[] | null;
};

type StorageLayoutResponse = {
    root?: string | null;
    services?: StorageLayoutService[] | null;
    error?: string;
};

type DocumentLoadResult = {
    documents: unknown[];
    hasMore: boolean;
    limit: number;
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

type KavitaUserSummary = {
    id?: number | null;
    username?: string | null;
    email?: string | null;
    roles?: string[] | null;
    libraries?: Array<string | number> | null;
    pending?: boolean | null;
};

type KavitaUsersResponse = {
    users?: KavitaUserSummary[] | null;
    roles?: string[] | null;
    roleDetails?: PortalJoinRoleDetail[] | null;
    error?: string;
};

type KavitaUserRoleUpdateResponse = {
    ok?: boolean;
    user?: KavitaUserSummary | null;
    roles?: string[] | null;
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

type VpnRegionOption = {
    id?: string | null;
    label?: string | null;
    endpoint?: string | null;
};

type VpnRuntimeStatus = {
    enabled?: boolean;
    autoRotate?: boolean;
    rotating?: boolean;
    connected?: boolean;
    provider?: string | null;
    region?: string | null;
    rotateEveryMinutes?: number | null;
    publicIp?: string | null;
    lastRotationAt?: string | null;
    nextRotationAt?: string | null;
    lastError?: string | null;
    connectionState?: string | null;
};

type DownloadVpnSettings = {
    key?: string | null;
    provider?: string | null;
    enabled?: boolean;
    autoRotate?: boolean;
    rotateEveryMinutes?: number | null;
    region?: string | null;
    piaUsername?: string | null;
    piaPassword?: string | null;
    passwordConfigured?: boolean;
    updatedAt?: string | null;
    status?: VpnRuntimeStatus | null;
    regions?: VpnRegionOption[] | null;
    error?: string;
};

type VpnLoginTestResult = {
    ok?: boolean;
    message?: string | null;
    region?: string | null;
    endpoint?: string | null;
    reportedIp?: string | null;
    testedAt?: string | null;
    error?: string | null;
};

type SetupConfigSnapshotResponse = {
    exists?: boolean;
    path?: string | null;
    snapshot?: Record<string, unknown> | null;
    selected?: string[] | null;
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

type DiscordSetupGuild = {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    icon?: string | null;
};

type DiscordSetupApplication = {
    id?: string | null;
    name?: string | null;
    verified?: boolean;
    providedClientId?: string | null;
    clientIdMatches?: boolean;
};

type DiscordSetupBotUser = {
    id?: string | null;
    username?: string | null;
    tag?: string | null;
};

type DiscordSetupResponse = {
    application?: DiscordSetupApplication | null;
    botUser?: DiscordSetupBotUser | null;
    guilds?: DiscordSetupGuild[] | null;
    guild?: DiscordSetupGuild | null;
    suggested?: {
        clientId?: string | null;
        guildId?: string | null;
    } | null;
    roles?: Array<{ id?: string | null; name?: string | null }> | null;
    channels?: Array<{ id?: string | null; name?: string | null }> | null;
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
    "REQUIRED_ROLE_RECOMMEND",
    "REQUIRED_ROLE_SUBSCRIBE",
]);
const PORTAL_SETTINGS_SERVICES: Record<PortalSettingsSubtabId, string> = {
    discord: "noona-portal",
    kavita: "noona-portal",
    komf: "noona-komf",
};
const KOMF_APPLICATION_YML_KEY = "KOMF_APPLICATION_YML";
const GENERAL_LINK_SERVICES = ["noona-moon", "noona-sage", "noona-portal", "noona-raven", "noona-kavita", "noona-komf", "noona-warden"] as const;
const FILESYSTEM_SERVICES = ["noona-raven", "noona-vault", "noona-kavita", "noona-komf"] as const;
const DATABASE_DOCUMENT_PAGE_SIZE = 25;
const DATABASE_DOCUMENT_VIEWER_HEIGHT = "40rem";
const LINK_FIELD_PATTERN = /(?:SERVER_IP|(?:BASE|EXTERNAL)?_?URL|HOST)$/i;
const PATH_FIELD_PATTERN = /(PATH|FOLDER|ROOT|DIR|MOUNT)/i;
const SERVICE_LINK_FALLBACK_FIELDS: Record<string, EnvConfigField[]> = {
    "noona-moon": [
        {
            key: "MOON_EXTERNAL_URL",
            label: "Moon External URL",
            defaultValue: "",
            description:
                "Optional public Moon URL used in external links instead of the detected local host address.",
            warning:
                "Set a full URL such as https://moon.example.com when users cannot reach the detected local Moon address.",
            required: false,
            readOnly: false,
        },
    ],
};
const STORAGE_LABELS: Record<string, string> = {
    "noona-moon": "Moon",
    "noona-portal": "Portal",
    "noona-raven": "Raven",
    "noona-sage": "Sage",
    "noona-vault": "Vault",
    "noona-kavita": "Kavita",
    "noona-komf": "Komf",
    "noona-warden": "Noona Updater",
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const normalizeSetupSelection = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of value) {
        const normalized = normalizeString(entry).trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }

    return out;
};
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
const normalizeDistinctStringList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const entry of value) {
            const normalized = normalizeString(entry).trim();
            if (!normalized) continue;
            const key = normalized.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(normalized);
        }
        return out;
    }

    return parseCsvSelections(value);
};
const pushIdentityKey = (
    out: string[],
    seen: Set<string>,
    type: "email" | "username",
    value: unknown,
) => {
    const normalized = normalizeString(value).trim().toLowerCase();
    if (!normalized) return;
    const key = `${type}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
};
const getManagedUserIdentityKeys = (user: ManagedUser): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    pushIdentityKey(out, seen, "email", user?.email);
    pushIdentityKey(out, seen, "username", user?.discordUsername);
    pushIdentityKey(out, seen, "username", user?.discordGlobalName);
    pushIdentityKey(out, seen, "username", user?.usernameNormalized);
    pushIdentityKey(out, seen, "username", user?.username);
    return out;
};
const getKavitaUserIdentityKeys = (user: KavitaUserSummary): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    pushIdentityKey(out, seen, "email", user?.email);
    pushIdentityKey(out, seen, "username", user?.username);
    return out;
};
const getUserLookupKey = (user?: {
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
    return normalizeString(user?.lookupKey).trim().toLowerCase()
        || normalizeString(user?.usernameNormalized).trim().toLowerCase()
        || normalizeString(user?.username).trim().toLowerCase();
};
const serializeCsvSelections = (values: string[]): string => values.join(", ");
const isSecretKey = (key: string) => /TOKEN|PASSWORD|API_KEY|SECRET/i.test(key);
const isUrlLikeField = (key: string) => LINK_FIELD_PATTERN.test(key);
const isPathLikeField = (key: string) => PATH_FIELD_PATTERN.test(key);
const THREAD_RATE_LIMIT_UNLIMITED = "-1";
const THREAD_RATE_LIMIT_MB_MULTIPLIER = 1024;
const THREAD_RATE_LIMIT_GB_MULTIPLIER = 1024 * THREAD_RATE_LIMIT_MB_MULTIPLIER;
const DEFAULT_VPN_REGION = "us_california";
const DEFAULT_VPN_ROTATE_MINUTES = "30";
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
const detectPathSeparator = (root: string) => (root.includes("\\") ? "\\" : "/");
const joinHostPath = (root: string, ...segments: string[]) => {
    const separator = detectPathSeparator(root);
    const normalizedRoot = root.replace(/[\\/]+$/, "");
    const safeSegments = segments.map((segment) =>
        segment.replace(/[\\/]+/g, separator).replace(new RegExp(`^${separator}+|${separator}+$`, "g"), ""),
    );
    return [normalizedRoot, ...safeSegments.filter(Boolean)].join(separator);
};
const normalizeVaultFolderName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "vault";
    if (trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) return "vault";
    const cleaned = trimmed.replace(/[:*?"<>|]/g, "").trim();
    return cleaned || "vault";
};
const getStoragePreview = (root: string, vaultFolderName: string) => {
    const safeRoot = root.trim();
    const vaultFolder = normalizeVaultFolderName(vaultFolderName);

    return [
        {
            service: "noona-moon",
            label: "Moon",
            folders: [{
                key: "logs",
                label: "Logs",
                hostPath: joinHostPath(safeRoot, "moon", "logs"),
                containerPath: "/var/log/noona",
            }],
        },
        {
            service: "noona-portal",
            label: "Portal",
            folders: [{
                key: "logs",
                label: "Logs",
                hostPath: joinHostPath(safeRoot, "portal", "logs"),
                containerPath: "/var/log/noona",
            }],
        },
        {
            service: "noona-raven",
            label: "Raven",
            folders: [
                {
                    key: "downloads",
                    label: "Downloads",
                    hostPath: joinHostPath(safeRoot, "raven", "downloads"),
                    containerPath: "/downloads",
                },
                {
                    key: "logs",
                    label: "Logs",
                    hostPath: joinHostPath(safeRoot, "raven", "logs"),
                    containerPath: "/app/logs",
                },
            ],
        },
        {
            service: "noona-sage",
            label: "Sage",
            folders: [{
                key: "logs",
                label: "Logs",
                hostPath: joinHostPath(safeRoot, "sage", "logs"),
                containerPath: "/var/log/noona",
            }],
        },
        {
            service: "noona-vault",
            label: "Vault",
            folders: [
                {
                    key: "logs",
                    label: "Logs",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "logs"),
                    containerPath: "/var/log/noona",
                },
                {
                    key: "mongo",
                    label: "Mongo data",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "mongo"),
                    containerPath: "/data/db",
                },
                {
                    key: "redis",
                    label: "Redis data",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "redis"),
                    containerPath: "/data",
                },
            ],
        },
        {
            service: "noona-kavita",
            label: "Kavita",
            folders: [
                {
                    key: "config",
                    label: "Config",
                    hostPath: joinHostPath(safeRoot, "kavita", "config"),
                    containerPath: "/kavita/config",
                },
                {
                    key: "manga",
                    label: "Library share",
                    hostPath: joinHostPath(safeRoot, "raven", "downloads"),
                    containerPath: "/manga",
                },
            ],
        },
        {
            service: "noona-komf",
            label: "Komf",
            folders: [{
                key: "config",
                label: "Config",
                hostPath: joinHostPath(safeRoot, "komf", "config"),
                containerPath: "/config",
            }],
        },
    ];
};
const sortCollections = (entries: string[]) => [...entries].sort((left, right) => left.localeCompare(right));
const documentSortValue = (entry: unknown): number => {
    if (!entry || typeof entry !== "object") {
        return 0;
    }

    const record = entry as Record<string, unknown>;
    const candidateKeys = ["updatedAt", "createdAt", "requestedAt", "approvedAt", "completedAt"];
    for (const key of candidateKeys) {
        const value = normalizeString(record[key]).trim();
        if (!value) {
            continue;
        }
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
};
const sortDocumentsForDisplay = (entries: unknown[]) =>
    [...entries].sort((left, right) => {
        const rightValue = documentSortValue(right);
        const leftValue = documentSortValue(left);
        if (rightValue !== leftValue) {
            return rightValue - leftValue;
        }

        return JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
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
    const setupConfigInputRef = useRef<HTMLInputElement | null>(null);
    const activeTab = selection.tab;
    const activeView: ViewId = selection.view;
    const activeNavSection: NavSectionId = selection.navSection;
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
    const [setupConfigBusy, setSetupConfigBusy] = useState(false);
    const [setupConfigMessage, setSetupConfigMessage] = useState<string | null>(null);
    const [setupConfigError, setSetupConfigError] = useState<string | null>(null);
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
    const [vpnLoading, setVpnLoading] = useState(false);
    const [vpnSaving, setVpnSaving] = useState(false);
    const [vpnRotating, setVpnRotating] = useState(false);
    const [vpnTesting, setVpnTesting] = useState(false);
    const [vpnError, setVpnError] = useState<string | null>(null);
    const [vpnMessage, setVpnMessage] = useState<string | null>(null);
    const [vpnEnabled, setVpnEnabled] = useState(false);
    const [vpnAutoRotate, setVpnAutoRotate] = useState(true);
    const [vpnRotateEveryMinutes, setVpnRotateEveryMinutes] = useState(DEFAULT_VPN_ROTATE_MINUTES);
    const [vpnRegion, setVpnRegion] = useState(DEFAULT_VPN_REGION);
    const [vpnUsername, setVpnUsername] = useState("");
    const [vpnPassword, setVpnPassword] = useState("");
    const [vpnPasswordConfigured, setVpnPasswordConfigured] = useState(false);
    const [vpnUpdatedAt, setVpnUpdatedAt] = useState<string | null>(null);
    const [vpnRegions, setVpnRegions] = useState<VpnRegionOption[]>([]);
    const [vpnStatus, setVpnStatus] = useState<VpnRuntimeStatus | null>(null);

    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [collections, setCollections] = useState<string[]>([]);
    const [collection, setCollection] = useState("");
    const [limit, setLimit] = useState("50");
    const [loadedDocumentLimit, setLoadedDocumentLimit] = useState(50);
    const [documentsHasMore, setDocumentsHasMore] = useState(false);
    const [documentsLoading, setDocumentsLoading] = useState(false);
    const [documentsError, setDocumentsError] = useState<string | null>(null);
    const [documents, setDocuments] = useState<unknown[]>([]);
    const [storageLayoutLoading, setStorageLayoutLoading] = useState(false);
    const [storageLayoutError, setStorageLayoutError] = useState<string | null>(null);
    const [storageLayoutRoot, setStorageLayoutRoot] = useState("");
    const [storageLayoutServices, setStorageLayoutServices] = useState<StorageLayoutService[]>([]);
    const [showMongoUri, setShowMongoUri] = useState(false);
    const [discordValidating, setDiscordValidating] = useState(false);
    const [discordValidation, setDiscordValidation] = useState<DiscordSetupResponse | null>(null);
    const [discordValidationError, setDiscordValidationError] = useState<string | null>(null);
    const [factoryResetConfirmation, setFactoryResetConfirmation] = useState("");
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
        "mySubscriptions",
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
        "mySubscriptions",
        "myRecommendations",
    ]);
    const [editingUser, setEditingUser] = useState<Record<string, {
        username: string;
        permissions: MoonPermission[]
    }>>({});
    const [kavitaUsersLoading, setKavitaUsersLoading] = useState(false);
    const [kavitaUsersError, setKavitaUsersError] = useState<string | null>(null);
    const [kavitaUsersMessage, setKavitaUsersMessage] = useState<string | null>(null);
    const [kavitaUsers, setKavitaUsers] = useState<KavitaUserSummary[]>([]);
    const [kavitaRoleOptions, setKavitaRoleOptions] = useState<string[]>([]);
    const [editingKavitaRoles, setEditingKavitaRoles] = useState<Record<string, string[]>>({});
    const [savingKavitaRoles, setSavingKavitaRoles] = useState<Record<string, boolean>>({});

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
    const updaterSummary = useMemo(() => {
        let updateAvailable = 0;
        let upToDate = 0;
        let unsupported = 0;
        let errors = 0;

        for (const entry of installedUpdateSnapshots) {
            if (normalizeString(entry?.error).trim()) {
                errors += 1;
            }

            if (entry?.supported === false) {
                unsupported += 1;
                continue;
            }

            if (entry?.updateAvailable === true) {
                updateAvailable += 1;
                continue;
            }

            if (normalizeString(entry?.checkedAt).trim()) {
                upToDate += 1;
            }
        }

        return {
            total: installedUpdateSnapshots.length,
            updateAvailable,
            upToDate,
            unsupported,
            errors,
        };
    }, [installedUpdateSnapshots]);
    const factoryResetConfirmationMeta = useMemo(() => {
        const authProvider = normalizeString(accountUser?.authProvider).trim().toLowerCase();
        const accountName =
            normalizeString(accountUser?.username).trim() ||
            normalizeString(accountUser?.discordGlobalName).trim() ||
            normalizeString(accountUser?.discordUsername).trim();

        if (authProvider === "discord") {
            return {
                mode: "identity",
                label: "Confirm with Discord username",
                hint: accountName
                    ? `Type ${accountName} to confirm this reset.`
                    : "Type your current Discord username to confirm this reset.",
                requiredMessage: "Confirmation is required.",
            } as const;
        }

        return {
            mode: "password",
            label: "Confirm with password",
            hint: "Enter your current password to confirm this reset.",
            requiredMessage: "Password is required.",
        } as const;
    }, [accountUser]);
    const updatesBusy = updatesApplyingAll || Object.values(updating).some(Boolean);
    const currentService = (() => {
        if (activeView === "downloader") return "noona-raven";
        if (activeView === "discord") return "noona-portal";
        if (activeView === "kavita") return "noona-portal";
        if (activeView === "komf") return "noona-komf";
        if (activeView === "database") return "noona-vault";
        return activeTab === "portal"
            ? PORTAL_SETTINGS_SERVICES[portalSubtab]
            : (TAB_SERVICE[activeTab] ?? null);
    })();
    const currentEditor = currentService ? (editors[currentService] ?? defaultEditor()) : defaultEditor();
    const currentServiceMeta = currentService ? catalogByName.get(currentService) : null;
    const ravenEditor = editors["noona-raven"] ?? defaultEditor();
    const ravenEnvConfig = Array.isArray(ravenEditor.config?.envConfig) ? ravenEditor.config.envConfig : [];
    const wardenEditor = editors["noona-warden"] ?? defaultEditor();
    const wardenEnvConfig = Array.isArray(wardenEditor.config?.envConfig) ? wardenEditor.config.envConfig : [];
    const wardenServerIpField = wardenEnvConfig.find((entry) => normalizeString(entry?.key).trim() === "SERVER_IP");
    const wardenAutoUpdatesField = wardenEnvConfig.find((entry) => normalizeString(entry?.key).trim() === "AUTO_UPDATES");
    const wardenHostBaseUrl = normalizeString(wardenEditor.config?.hostServiceUrl).trim();
    const wardenAutoUpdatesEnabled = parseBooleanEnvFlag(wardenEditor.envDraft.AUTO_UPDATES);
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
    const canShowNav = canAccessEcosystem || canManageUsers;
    const sortedCollections = useMemo(() => sortCollections(collections), [collections]);
    const sortedDocuments = useMemo(() => sortDocumentsForDisplay(documents), [documents]);
    const vaultEditor = editors["noona-vault"] ?? defaultEditor();
    const vaultEnvConfig = Array.isArray(vaultEditor.config?.envConfig) ? vaultEditor.config.envConfig : [];
    const vaultMongoUriField = vaultEnvConfig.find((entry) => normalizeString(entry?.key).trim() === "MONGO_URI");
    const portalEditor = editors["noona-portal"] ?? defaultEditor();
    const portalEnvConfig = Array.isArray(portalEditor.config?.envConfig) ? portalEditor.config.envConfig : [];
    const portalDiscordFields = portalEnvConfig.filter((entry) => PORTAL_DISCORD_KEYS.has(normalizeString(entry?.key).trim()));
    const portalAccessFields = portalEnvConfig.filter((entry) => PORTAL_COMMAND_ACCESS_KEYS.has(normalizeString(entry?.key).trim()));
    const komfEditor = editors["noona-komf"] ?? defaultEditor();
    const komfEnvConfig = Array.isArray(komfEditor.config?.envConfig) ? komfEditor.config.envConfig : [];
    const kavitaUsersByIdentity = useMemo(() => {
        const map = new Map<string, KavitaUserSummary>();
        for (const user of kavitaUsers) {
            const identityKeys = getKavitaUserIdentityKeys(user);
            for (const key of identityKeys) {
                if (!map.has(key)) {
                    map.set(key, user);
                }
            }
        }
        return map;
    }, [kavitaUsers]);
    const managedUsersWithKavita = useMemo(() => {
        return managedUsers.map((entry) => {
            const identityKeys = getManagedUserIdentityKeys(entry);
            let linkedKavitaUser: KavitaUserSummary | null = null;
            for (const key of identityKeys) {
                const matched = kavitaUsersByIdentity.get(key);
                if (matched) {
                    linkedKavitaUser = matched;
                    break;
                }
            }

            return {
                user: entry,
                kavitaUser: linkedKavitaUser,
            };
        });
    }, [managedUsers, kavitaUsersByIdentity]);
    const kavitaUserByManagedLookup = useMemo(() => {
        const map = new Map<string, KavitaUserSummary | null>();
        for (const entry of managedUsersWithKavita) {
            const lookup = getUserLookupKey(entry.user);
            if (!lookup) continue;
            map.set(lookup, entry.kavitaUser);
        }
        return map;
    }, [managedUsersWithKavita]);
    const filesystemPreview = useMemo(() => {
        const actualServices = Array.isArray(storageLayoutServices) ? storageLayoutServices.filter((entry) => entry && typeof entry === "object") : [];
        if (actualServices.length > 0) {
            return actualServices;
        }

        const vaultFolderName = normalizeVaultFolderName(normalizeString(vaultEditor.envDraft.VAULT_DATA_FOLDER));
        return storageLayoutRoot.trim() ? getStoragePreview(storageLayoutRoot, vaultFolderName) : [];
    }, [storageLayoutRoot, storageLayoutServices, vaultEditor.envDraft.VAULT_DATA_FOLDER]);

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
    const ensureServiceConfigLoaded = (serviceName: string) => {
        const editor = editors[serviceName];
        if (editor?.loading || editor?.config) {
            return;
        }

        void loadServiceConfig(serviceName);
    };
    const ensureServiceConfigGroupLoaded = (serviceNames: readonly string[]) => {
        serviceNames.forEach((serviceName) => ensureServiceConfigLoaded(serviceName));
    };
    const loadStorageLayout = async () => {
        setStorageLayoutLoading(true);
        setStorageLayoutError(null);
        try {
            const res = await fetch("/api/noona/setup/layout", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as StorageLayoutResponse | null;
            if (!res.ok) {
                setStorageLayoutError(parseError(json, `Failed to load storage layout (HTTP ${res.status}).`));
                return;
            }

            const root = normalizeString(json?.root).trim();
            const services = Array.isArray(json?.services) ? json.services : [];
            setStorageLayoutRoot(root);
            setStorageLayoutServices(services);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setStorageLayoutError(msg);
        } finally {
            setStorageLayoutLoading(false);
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
    const selectDiscordGuild = (guildId: string) => {
        updateEnvDraft("noona-portal", "DISCORD_GUILD_ID", guildId);
        setDiscordValidation((prev) => prev ? ({
            ...prev,
            suggested: {
                ...(prev.suggested ?? {}),
                guildId,
            },
            guild: (Array.isArray(prev.guilds) ? prev.guilds.find((entry) => normalizeString(entry?.id).trim() === guildId) : null) ?? prev.guild ?? null,
        }) : prev);
        void testDiscordConnection(guildId);
    };
    const testDiscordConnection = async (guildOverride?: string) => {
        const portalValues = editors["noona-portal"]?.envDraft ?? {};
        const token = normalizeString(portalValues.DISCORD_BOT_TOKEN).trim();
        const clientId = normalizeString(portalValues.DISCORD_CLIENT_ID).trim();
        const guildId = normalizeString(guildOverride ?? portalValues.DISCORD_GUILD_ID).trim();

        if (!token) {
            setDiscordValidation(null);
            setDiscordValidationError("Discord bot token is required before testing the bot login.");
            return;
        }

        setDiscordValidating(true);
        setDiscordValidationError(null);

        try {
            const response = await fetch("/api/noona/setup/discord/validate", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({token, clientId, guildId}),
            });
            const payload = (await response.json().catch(() => null)) as DiscordSetupResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Discord validation failed (HTTP ${response.status}).`);
            }

            setDiscordValidation(payload);
            const suggestedClientId = normalizeString(payload?.suggested?.clientId).trim();
            if (suggestedClientId && !clientId) {
                updateEnvDraft("noona-portal", "DISCORD_CLIENT_ID", suggestedClientId);
            }
            const suggestedGuildId = normalizeString(payload?.suggested?.guildId).trim();
            if (suggestedGuildId && !guildId) {
                updateEnvDraft("noona-portal", "DISCORD_GUILD_ID", suggestedGuildId);
            }
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDiscordValidation(null);
            setDiscordValidationError(msg);
        } finally {
            setDiscordValidating(false);
        }
    };
    const updateEcosystemState = async (
        action: "start" | "stop" | "restart",
        options: { body?: Record<string, unknown>; successMessage?: string } = {},
    ): Promise<boolean> => {
        setEcosystemBusy(true);
        setGlobalError(null);
        setGlobalMessage(null);
        try {
            const res = await fetch(`/api/noona/settings/ecosystem/${action}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(options.body ?? {}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setGlobalError(parseError(json, `Failed to ${action} ecosystem (HTTP ${res.status}).`));
                return false;
            }
            setGlobalMessage(options.successMessage ?? `${action.charAt(0).toUpperCase()}${action.slice(1)} request sent.`);
            await loadCatalog();
            return true;
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setGlobalError(msg);
            return false;
        } finally {
            setEcosystemBusy(false);
        }
    };
    const downloadSetupConfigSnapshot = async () => {
        setSetupConfigBusy(true);
        setSetupConfigMessage(null);
        setSetupConfigError(null);

        try {
            const response = await fetch("/api/noona/setup/config", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as SetupConfigSnapshotResponse | null;
            if (!response.ok) {
                throw new Error(parseError(payload, `Failed to load settings JSON (HTTP ${response.status}).`));
            }

            const snapshot =
                payload?.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot)
                    ? payload.snapshot
                    : null;
            if (!snapshot) {
                throw new Error("No saved Warden settings JSON exists yet.");
            }

            const blob = new Blob([JSON.stringify(snapshot, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const now = new Date().toISOString().replace(/[:.]/g, "-");
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `noona-settings-${now}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setSetupConfigMessage("Downloaded Warden settings JSON file.");
        } catch (error_) {
            setSetupConfigError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setSetupConfigBusy(false);
        }
    };

    const openSetupConfigFilePicker = () => {
        setSetupConfigMessage(null);
        setSetupConfigError(null);
        setupConfigInputRef.current?.click();
    };

    const loadSetupConfigFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setSetupConfigBusy(true);
        setSetupConfigMessage(null);
        setSetupConfigError(null);
        setGlobalError(null);
        setGlobalMessage(null);

        try {
            const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Settings JSON file must contain an object.");
            }

            const version = Number(parsed.version);
            if (version !== 1 && version !== 2) {
                throw new Error("Unsupported settings JSON version.");
            }

            const saveResponse = await fetch("/api/noona/setup/config", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(parsed),
            });
            const savePayload = (await saveResponse.json().catch(() => null)) as SetupConfigSnapshotResponse | null;
            if (!saveResponse.ok) {
                throw new Error(parseError(savePayload, `Failed to load settings JSON (HTTP ${saveResponse.status}).`));
            }

            const selectedServices = normalizeSetupSelection(savePayload?.selected ?? parsed.selected);
            const restarted = await updateEcosystemState("restart", {
                body: {
                    forceFull: true,
                    ...(selectedServices.length > 0 ? {services: selectedServices} : {}),
                },
                successMessage: "Loaded settings JSON and sent ecosystem restart.",
            });
            if (!restarted) {
                return;
            }
            setSetupConfigMessage(`Loaded Warden settings JSON from ${file.name}.`);
        } catch (error_) {
            setSetupConfigError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setSetupConfigBusy(false);
            event.target.value = "";
        }
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

            const responsePayload = json as { warnings?: unknown[]; linkedRestarts?: unknown[] } | null;
            const responseWarnings = Array.isArray(responsePayload?.warnings)
                ? responsePayload.warnings
                    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : [];
            const linkedRestarts = Array.isArray(responsePayload?.linkedRestarts)
                ? responsePayload.linkedRestarts
                    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : [];
            const syncMessage = serviceName === "noona-moon" && linkedRestarts.includes("noona-kavita")
                ? " Managed Kavita was restarted so Kavita's Log in with Noona button uses the updated Moon URL."
                : "";
            const warningMessage = responseWarnings.length > 0 ? ` ${responseWarnings.join(" ")}` : "";

            patchEditor(serviceName, {
                message:
                    `${options.successMessage ?? (shouldRestart ? "Saved and restarted service." : "Saved changes.")}${syncMessage}${warningMessage}`,
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

    const loadVpnRegions = async () => {
        try {
            const res = await fetch("/api/noona/settings/downloads/vpn/regions", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as {
                regions?: VpnRegionOption[] | null;
                error?: string
            } | null;
            if (!res.ok) {
                setVpnError(parseError(json, `Failed to load VPN regions (HTTP ${res.status}).`));
                return;
            }

            const parsed = Array.isArray(json?.regions) ? json.regions : [];
            setVpnRegions(parsed);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setVpnError(msg);
        }
    };

    const loadVpnSettings = async () => {
        setVpnLoading(true);
        setVpnError(null);
        setVpnMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/vpn", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as DownloadVpnSettings | null;
            if (!res.ok) {
                setVpnError(parseError(json, `Failed to load VPN settings (HTTP ${res.status}).`));
                return;
            }

            setVpnEnabled(json?.enabled === true);
            setVpnAutoRotate(json?.autoRotate !== false);
            setVpnRotateEveryMinutes(
                String(
                    Number.isFinite(Number(json?.rotateEveryMinutes)) && Number(json?.rotateEveryMinutes) > 0
                        ? Math.floor(Number(json?.rotateEveryMinutes))
                        : Number(DEFAULT_VPN_ROTATE_MINUTES),
                ),
            );
            setVpnRegion(normalizeString(json?.region).trim() || DEFAULT_VPN_REGION);
            setVpnUsername(normalizeString(json?.piaUsername).trim());
            setVpnPassword("");
            setVpnPasswordConfigured(json?.passwordConfigured === true);
            setVpnUpdatedAt(normalizeString(json?.updatedAt).trim() || null);
            setVpnStatus(json?.status ?? null);
            if (Array.isArray(json?.regions)) {
                setVpnRegions(json?.regions ?? []);
            }
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setVpnError(msg);
        } finally {
            setVpnLoading(false);
        }
    };

    const saveVpnSettings = async () => {
        setVpnSaving(true);
        setVpnError(null);
        setVpnMessage(null);
        try {
            const rotateEveryMinutes = Number(vpnRotateEveryMinutes);
            if (!Number.isFinite(rotateEveryMinutes) || rotateEveryMinutes < 1) {
                setVpnError("Rotation interval must be a positive number of minutes.");
                return;
            }

            const res = await fetch("/api/noona/settings/downloads/vpn", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    enabled: vpnEnabled,
                    autoRotate: vpnAutoRotate,
                    rotateEveryMinutes,
                    region: vpnRegion,
                    piaUsername: vpnUsername,
                    piaPassword: vpnPassword,
                }),
            });
            const json = (await res.json().catch(() => null)) as DownloadVpnSettings | null;
            if (!res.ok) {
                setVpnError(parseError(json, `Failed to save VPN settings (HTTP ${res.status}).`));
                return;
            }

            setVpnUpdatedAt(normalizeString(json?.updatedAt).trim() || new Date().toISOString());
            setVpnEnabled(json?.enabled === true);
            setVpnAutoRotate(json?.autoRotate !== false);
            setVpnRotateEveryMinutes(
                String(
                    Number.isFinite(Number(json?.rotateEveryMinutes)) && Number(json?.rotateEveryMinutes) > 0
                        ? Math.floor(Number(json?.rotateEveryMinutes))
                        : rotateEveryMinutes,
                ),
            );
            setVpnRegion(normalizeString(json?.region).trim() || vpnRegion);
            setVpnUsername(normalizeString(json?.piaUsername).trim() || vpnUsername);
            setVpnPassword("");
            setVpnPasswordConfigured(json?.passwordConfigured === true || vpnPasswordConfigured);
            setVpnMessage("VPN settings saved.");
            await Promise.all([loadVpnRegions(), loadVpnSettings()]);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setVpnError(msg);
        } finally {
            setVpnSaving(false);
        }
    };

    const rotateVpnNow = async () => {
        setVpnRotating(true);
        setVpnError(null);
        setVpnMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/vpn/rotate", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({triggeredBy: "moon-settings"}),
            });
            const json = (await res.json().catch(() => null)) as {
                ok?: boolean;
                message?: string | null;
                error?: string | null;
            } | null;

            if (!res.ok || json?.ok === false) {
                const message = normalizeString(json?.error).trim()
                    || normalizeString(json?.message).trim()
                    || `Failed to rotate VPN endpoint (HTTP ${res.status}).`;
                setVpnError(message);
                return;
            }

            setVpnMessage(normalizeString(json?.message).trim() || "VPN endpoint rotated.");
            await loadVpnSettings();
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setVpnError(msg);
        } finally {
            setVpnRotating(false);
        }
    };

    const testVpnLogin = async () => {
        setVpnTesting(true);
        setVpnError(null);
        setVpnMessage(null);
        try {
            const res = await fetch("/api/noona/settings/downloads/vpn/test-login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    triggeredBy: "moon-settings",
                    region: vpnRegion,
                    piaUsername: vpnUsername,
                    piaPassword: vpnPassword,
                }),
            });
            const json = (await res.json().catch(() => null)) as VpnLoginTestResult | null;

            const failed = !res.ok || json?.ok === false;
            if (failed) {
                const message = normalizeString(json?.error).trim()
                    || normalizeString(json?.message).trim()
                    || `Failed to test VPN login (HTTP ${res.status}).`;
                setVpnError(message);
                return;
            }

            const message = normalizeString(json?.message).trim() || "PIA login test succeeded.";
            const region = normalizeString(json?.region).trim();
            const endpoint = normalizeString(json?.endpoint).trim();
            const reportedIp = normalizeString(json?.reportedIp).trim();
            const locationDetail = endpoint ? `${region || vpnRegion} (${endpoint})` : (region || "");
            const ipDetail = reportedIp ? `IP ${reportedIp}` : "";
            const detail = [locationDetail, ipDetail].filter(Boolean).join(" | ");
            setVpnMessage(detail ? `${message} ${detail}` : message);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setVpnError(msg);
        } finally {
            setVpnTesting(false);
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

            const next = Array.isArray(json?.collections)
                ? sortCollections(json.collections.filter((entry: unknown) => typeof entry === "string"))
                : [];
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

    const loadDocuments = async (collectionName: string, rawLimit = limit): Promise<DocumentLoadResult> => {
        const safeCollection = collectionName.trim();
        if (!safeCollection) {
            setDocuments([]);
            setLoadedDocumentLimit(0);
            setDocumentsHasMore(false);
            return {
                documents: [],
                hasMore: false,
                limit: 0,
            };
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
                return {
                    documents: [],
                    hasMore: false,
                    limit: safeLimit,
                };
            }
            const nextDocuments = Array.isArray(json?.documents) ? json.documents : [];
            const hasMore = nextDocuments.length >= safeLimit && safeLimit < 200;
            setDocuments(nextDocuments);
            setLoadedDocumentLimit(safeLimit);
            setDocumentsHasMore(hasMore);
            return {
                documents: nextDocuments,
                hasMore,
                limit: safeLimit,
            };
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setDocumentsError(msg);
            return {
                documents: [],
                hasMore: false,
                limit: safeLimit,
            };
        } finally {
            setDocumentsLoading(false);
        }
    };
    const loadMoreDocuments = async (): Promise<boolean> => {
        if (!collection.trim() || documentsLoading || !documentsHasMore) {
            return false;
        }

        const nextLimit = Math.min(200, loadedDocumentLimit + DATABASE_DOCUMENT_PAGE_SIZE);
        const result = await loadDocuments(collection, String(nextLimit));
        return result.hasMore;
    };

    const beginFactoryResetRecovery = (detail: string) => {
        setFactoryResetConfirmation("");
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

        const confirmation = factoryResetConfirmation.trim();
        if (!confirmation) {
            setFactoryResetError(factoryResetConfirmationMeta.requiredMessage);
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
                    confirmation,
                    password: factoryResetConfirmationMeta.mode === "password" ? confirmation : undefined,
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

    const userLookupKey = getUserLookupKey;

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
                loadedDefaultPermissions.length ? loadedDefaultPermissions : ["moon_login", "mySubscriptions", "myRecommendations"],
            );
            if (!newUserDiscordId.trim() && !newUserDisplayName.trim()) {
                setNewUserPermissions(
                    loadedDefaultPermissions.length ? loadedDefaultPermissions : ["moon_login", "mySubscriptions", "myRecommendations"],
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

    const loadKavitaUsers = async () => {
        setKavitaUsersLoading(true);
        setKavitaUsersError(null);
        setKavitaUsersMessage(null);
        try {
            const res = await fetch("/api/noona/portal/kavita/users", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as KavitaUsersResponse | null;
            if (!res.ok) {
                setKavitaUsersError(parseError(json, `Failed to load Kavita users (HTTP ${res.status}).`));
                return;
            }

            const roles = normalizeDistinctStringList(json?.roles);
            const users = Array.isArray(json?.users)
                ? json.users
                    .map((entry) => {
                        const rawId = typeof entry?.id === "number" ? entry.id : Number(entry?.id);
                        const id = Number.isFinite(rawId) && rawId > 0 ? Math.floor(rawId) : null;
                        return {
                            id,
                            username: normalizeString(entry?.username).trim(),
                            email: normalizeString(entry?.email).trim(),
                            roles: normalizeDistinctStringList(entry?.roles),
                            libraries: Array.isArray(entry?.libraries)
                                ? entry.libraries
                                    .filter((library): library is string | number =>
                                        typeof library === "string" || typeof library === "number",
                                    )
                                : [],
                            pending: entry?.pending === true,
                        } satisfies KavitaUserSummary;
                    })
                    .filter((entry) => entry.id != null && entry.username)
                : [];

            setKavitaRoleOptions(roles);
            setKavitaUsers(users);
            setKavitaUsersMessage(`Loaded ${users.length} Kavita user${users.length === 1 ? "" : "s"}.`);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setKavitaUsersError(msg);
        } finally {
            setKavitaUsersLoading(false);
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

        setEditingKavitaRoles((prev) => {
            if (!previousLookup || previousLookup === nextLookup || !prev[previousLookup]) {
                return prev;
            }
            const next = {...prev};
            next[nextLookup] = prev[previousLookup];
            delete next[previousLookup];
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

    const setEditingKavitaRolesFromCsv = (key: string, csv: string) => {
        const nextRoles = normalizeDistinctStringList(csv);
        setEditingKavitaRoles((prev) => ({
            ...prev,
            [key]: nextRoles,
        }));
    };

    const toggleEditingKavitaRole = (key: string, role: string) => {
        const normalizedRole = normalizeString(role).trim();
        if (!normalizedRole) return;

        setEditingKavitaRoles((prev) => {
            const current = normalizeDistinctStringList(prev[key]);
            const hasRole = current.some((entry) => entry.toLowerCase() === normalizedRole.toLowerCase());
            const nextRoles = hasRole
                ? current.filter((entry) => entry.toLowerCase() !== normalizedRole.toLowerCase())
                : [...current, normalizedRole];
            return {
                ...prev,
                [key]: nextRoles,
            };
        });
    };

    const saveManagedUserKavitaRoles = async (entry: ManagedUser) => {
        const lookup = userLookupKey(entry);
        if (!lookup) return;

        const linkedKavitaUser = kavitaUserByManagedLookup.get(lookup) ?? null;
        const linkedUsername = normalizeString(linkedKavitaUser?.username).trim();
        if (!linkedUsername) {
            setKavitaUsersError("No linked Kavita account was found for this Moon user.");
            return;
        }

        const nextRoles = normalizeDistinctStringList(editingKavitaRoles[lookup] ?? linkedKavitaUser?.roles);
        if (nextRoles.length === 0) {
            setKavitaUsersError("At least one Kavita role is required.");
            return;
        }

        setSavingKavitaRoles((prev) => ({
            ...prev,
            [lookup]: true,
        }));
        setKavitaUsersError(null);
        setKavitaUsersMessage(null);

        try {
            const res = await fetch(`/api/noona/portal/kavita/users/${encodeURIComponent(linkedUsername)}/roles`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    roles: nextRoles,
                }),
            });
            const json = (await res.json().catch(() => null)) as KavitaUserRoleUpdateResponse | null;
            if (!res.ok) {
                setKavitaUsersError(parseError(json, `Failed to update Kavita roles (HTTP ${res.status}).`));
                return;
            }

            const updatedRoles = normalizeDistinctStringList(json?.roles ?? json?.user?.roles ?? nextRoles);
            const updatedUser = json?.user ?? null;
            setKavitaUsers((prev) =>
                prev.map((record) => {
                    const sameUser = normalizeString(record.username).trim().toLowerCase() === linkedUsername.toLowerCase();
                    if (!sameUser) return record;
                    return {
                        ...record,
                        ...(updatedUser ?? {}),
                        username: normalizeString(updatedUser?.username).trim() || record.username,
                        email: normalizeString(updatedUser?.email).trim() || record.email,
                        roles: updatedRoles,
                    };
                }),
            );
            setEditingKavitaRoles((prev) => ({
                ...prev,
                [lookup]: updatedRoles,
            }));
            setKavitaUsersMessage(`Updated Kavita roles for ${linkedUsername}.`);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setKavitaUsersError(msg);
        } finally {
            setSavingKavitaRoles((prev) => ({
                ...prev,
                [lookup]: false,
            }));
        }
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
                const returnTo = returnToCandidate.startsWith("/") ? returnToCandidate : getSettingsHrefForView("updater");
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

    const restartEcosystem = async () => await updateEcosystemState("restart");

    useEffect(() => {
        void loadAuthStatus();
    }, []);

    useEffect(() => {
        if (authStateLoading || !canAccessEcosystem || activeSection !== "ecosystem") return;
        void loadCatalog();
    }, [activeSection, authStateLoading, canAccessEcosystem]);

    useEffect(() => {
        if (!canAccessEcosystem || activeSection !== "ecosystem") return;
        if (activeView === "overview") {
            void loadAuthStatus();
            void loadDebugSetting();
            ensureServiceConfigGroupLoaded(GENERAL_LINK_SERVICES);
            return;
        }
        if (activeView === "filesystem") {
            void loadStorageLayout();
            ensureServiceConfigGroupLoaded(FILESYSTEM_SERVICES);
            return;
        }
        if (activeView === "database") {
            ensureServiceConfigLoaded("noona-vault");
            void loadCollections();
            return;
        }
        if (activeView === "downloader") {
            ensureServiceConfigLoaded("noona-raven");
            void loadNaming();
            void loadDownloadWorkerSettings();
            void loadVpnRegions();
            void loadVpnSettings();
            return;
        }
        if (activeView === "updater") {
            ensureServiceConfigLoaded("noona-warden");
            void loadUpdates();
            return;
        }
        if (activeView === "discord" || activeView === "kavita") {
            ensureServiceConfigLoaded("noona-portal");
            return;
        }
        if (activeView === "komf") {
            ensureServiceConfigLoaded("noona-komf");
        }
    }, [activeSection, activeView, canAccessEcosystem]);

    useEffect(() => {
        if (activeSection !== "ecosystem" || activeView !== "database") return;
        if (!collection.trim()) return;
        void loadDocuments(collection);
    }, [activeSection, activeView, collection]);

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
        void Promise.all([loadManagedUsers(), loadKavitaUsers()]);
    }, [activeSection, canManageUsers]);

    useEffect(() => {
        if (managedUsersWithKavita.length === 0) return;
        setEditingKavitaRoles((prev) => {
            let changed = false;
            const next = {...prev};
            for (const entry of managedUsersWithKavita) {
                const lookup = getUserLookupKey(entry.user);
                if (!lookup || !entry.kavitaUser) continue;
                if (Array.isArray(next[lookup]) && next[lookup].length > 0) continue;
                next[lookup] = normalizeDistinctStringList(entry.kavitaUser.roles);
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [managedUsersWithKavita]);

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
                    <Column gap="8" style={{minWidth: 0}}>
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

                {!currentEditor.loading && renderServiceActions()}
            </Column>
        );
    };

    const getServiceLabel = (serviceName: string) => STORAGE_LABELS[serviceName] ?? serviceName;

    const getEditorFieldValue = (editor: ServiceEditorState, field: EnvConfigField | undefined) => {
        const key = normalizeString(field?.key).trim();
        if (!key) return "";
        return Object.prototype.hasOwnProperty.call(editor.envDraft, key)
            ? editor.envDraft[key]
            : normalizeString(field?.defaultValue);
    };

    const renderSharedFieldNotes = (field: EnvConfigField) => (
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

    const renderEditorFeedback = (editor: ServiceEditorState) => (
        <>
            {editor.error && <Text onBackground="danger-strong" variant="body-default-xs">{editor.error}</Text>}
            {editor.message && <Text onBackground="neutral-weak" variant="body-default-xs">{editor.message}</Text>}
        </>
    );

    const renderEditorField = (
        serviceName: string,
        editor: ServiceEditorState,
        field: EnvConfigField,
        keyPrefix: string,
        options: { secretVisible?: boolean; type?: "text" | "password" | "number" } = {},
    ) => {
        const key = normalizeString(field.key).trim();
        if (!key || field.readOnly === true) return null;

        return (
            <Column key={`${serviceName}:${keyPrefix}:${key}`} gap="8">
                <Input
                    id={`${serviceName}:${keyPrefix}:${key}`}
                    name={`${serviceName}:${keyPrefix}:${key}`}
                    label={normalizeString(field.label).trim() || key}
                    type={options.type ?? (isSecretKey(key) && !options.secretVisible ? "password" : "text")}
                    value={getEditorFieldValue(editor, field)}
                    onChange={(event) => updateEnvDraft(serviceName, key, event.target.value)}
                />
                {renderSharedFieldNotes(field)}
            </Column>
        );
    };

    const mergeFallbackFields = (fields: EnvConfigField[], fallbackFields: EnvConfigField[]) => {
        const merged: EnvConfigField[] = [];
        const seen = new Set<string>();

        for (const field of [...fields, ...fallbackFields]) {
            const key = normalizeString(field?.key).trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(field);
        }

        return merged;
    };

    const renderServiceCards = (
        serviceNames: readonly string[],
        resolveFields: (serviceName: string, editor: ServiceEditorState) => EnvConfigField[],
        options: {
            emptyTitle: string;
            emptyDescription: string;
            saveLabel: string;
            descriptionForService?: (serviceName: string, editor: ServiceEditorState) => string;
        },
    ) => {
        const visibleServiceNames = serviceNames.filter((serviceName) => {
            const editor = editors[serviceName];
            return Boolean(editor?.config) || catalogByName.has(serviceName);
        });

        if (visibleServiceNames.length === 0) {
            return (
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="8">
                        <Heading as="h3" variant="heading-strong-l">{options.emptyTitle}</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">{options.emptyDescription}</Text>
                    </Column>
                </Card>
            );
        }

        return (
            <div className={settingsStyles.defaultCardGrid}>
                {visibleServiceNames.map((serviceName) => {
                    const editor = editors[serviceName] ?? defaultEditor();
                    const meta = catalogByName.get(serviceName);
                    const fields = resolveFields(serviceName, editor).filter((field) => field.readOnly !== true);
                    const hostUrl = normalizeString(editor.config?.hostServiceUrl ?? meta?.hostServiceUrl).trim();

                    return (
                        <Card
                            key={`service-card-${serviceName}`}
                            fillWidth
                            background={BG_SURFACE}
                            border="neutral-alpha-weak"
                            padding="l"
                            radius="l"
                        >
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                    <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                        <Heading as="h3"
                                                 variant="heading-strong-m">{getServiceLabel(serviceName)}</Heading>
                                        {hostUrl && (
                                            <Badge background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                                Live link available
                                            </Badge>
                                        )}
                                    </Row>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button
                                            variant="secondary"
                                            disabled={editor.loading || editor.saving}
                                            onClick={() => void loadServiceConfig(serviceName)}
                                        >
                                            {editor.loading ? "Loading..." : "Reload"}
                                        </Button>
                                        <Button
                                            variant="primary"
                                            disabled={editor.loading || editor.saving || fields.length === 0}
                                            onClick={() => void saveServiceConfig(serviceName)}
                                        >
                                            {editor.saving ? "Saving..." : options.saveLabel}
                                        </Button>
                                    </Row>
                                </Row>
                                {options.descriptionForService && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        {options.descriptionForService(serviceName, editor)}
                                    </Text>
                                )}
                                {hostUrl && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Current detected URL: {hostUrl}
                                    </Text>
                                )}
                                {renderEditorFeedback(editor)}
                                {editor.loading && (
                                    <Row fillWidth horizontal="center" paddingY="16">
                                        <Spinner/>
                                    </Row>
                                )}
                                {!editor.loading && fields.length === 0 && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        No editable settings are exposed here for this service.
                                    </Text>
                                )}
                                {!editor.loading && fields.map((field) =>
                                    renderEditorField(serviceName, editor, field, "service-card"),
                                )}
                            </Column>
                        </Card>
                    );
                })}
            </div>
        );
    };

    const renderOverviewSettings = () => (
        <Column fillWidth gap="16">
            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Heading as="h2" variant="heading-strong-l">Loaded profile</Heading>
                    {accountLoading && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}
                    {!accountLoading && (
                        <Column gap="8">
                            {accountError &&
                                <Text onBackground="danger-strong" variant="body-default-xs">{accountError}</Text>}
                            {accountUser ? (
                                <>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Signed in as {normalizeString(accountUser.username).trim() || "Unknown user"}.
                                    </Text>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Provider: {normalizeString(accountUser.authProvider).trim() || "unknown"}
                                    </Text>
                                    {normalizeString(accountUser.email).trim() && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Email: {normalizeString(accountUser.email).trim()}
                                        </Text>
                                    )}
                                    {normalizeString(accountUser.discordUsername).trim() && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Discord: {normalizeString(accountUser.discordUsername).trim()}
                                            {normalizeString(accountUser.discordGlobalName).trim()
                                                ? ` (${normalizeString(accountUser.discordGlobalName).trim()})`
                                                : ""}
                                        </Text>
                                    )}
                                    {currentPermissions.length > 0 && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {currentPermissions.map((permission) => (
                                                <Badge key={`current-permission-${permission}`}
                                                       background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                                    {MOON_PERMISSION_LABELS[permission]}
                                                </Badge>
                                            ))}
                                        </Row>
                                    )}
                                </>
                            ) : (
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    No signed-in profile is available.
                                </Text>
                            )}
                        </Column>
                    )}
                </Column>
            </Card>

            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Heading as="h2" variant="heading-strong-l">Ecosystem controls</Heading>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Start, stop, or restart the managed Noona stack from one place. You can also download or load
                        the same Warden settings JSON snapshot used by the setup wizard.
                    </Text>
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="secondary" disabled={ecosystemBusy}
                                onClick={() => void updateEcosystemState("start")}>
                            {ecosystemBusy ? "Working..." : "Start ecosystem"}
                        </Button>
                        <Button variant="primary" disabled={ecosystemBusy} onClick={() => void restartEcosystem()}>
                            {ecosystemBusy ? "Working..." : "Restart ecosystem"}
                        </Button>
                        <Button variant="secondary" disabled={ecosystemBusy}
                                onClick={() => void updateEcosystemState("stop")}>
                            {ecosystemBusy ? "Working..." : "Stop ecosystem"}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={ecosystemBusy || setupConfigBusy}
                            onClick={() => void downloadSetupConfigSnapshot()}
                        >
                            {setupConfigBusy ? "Working..." : "Save JSON"}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={ecosystemBusy || setupConfigBusy}
                            onClick={() => openSetupConfigFilePicker()}
                        >
                            {setupConfigBusy ? "Working..." : "Load JSON"}
                        </Button>
                        <input
                            ref={setupConfigInputRef}
                            type="file"
                            accept="application/json,.json"
                            onChange={(event) => void loadSetupConfigFromFile(event)}
                            style={{display: "none"}}
                            aria-label="Load Warden settings JSON file"
                        />
                    </Row>
                    {setupConfigMessage && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            {setupConfigMessage}
                        </Text>
                    )}
                    {setupConfigError && (
                        <Text onBackground="danger-strong" variant="body-default-xs">
                            {setupConfigError}
                        </Text>
                    )}
                </Column>
            </Card>

            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Heading as="h2" variant="heading-strong-l">Service links</Heading>
                        <Button variant="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>
                            {catalogLoading ? "Refreshing..." : "Refresh service list"}
                        </Button>
                    </Row>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Keep the internal and external links in sync without exposing the full backend wiring.
                    </Text>
                    {renderServiceCards(
                        GENERAL_LINK_SERVICES,
                        (serviceName, editor) =>
                            mergeFallbackFields(
                                Array.isArray(editor.config?.envConfig) ? editor.config.envConfig : [],
                                editor.config ? (SERVICE_LINK_FALLBACK_FIELDS[serviceName] ?? []) : [],
                            ).filter((field) => {
                                const key = normalizeString(field.key).trim();
                                return key === "SERVER_IP" || isUrlLikeField(key);
                            }),
                        {
                            emptyTitle: "No service links available",
                            emptyDescription: "The current stack has not published any editable service links yet.",
                            saveLabel: "Save and restart",
                            descriptionForService: (serviceName, editor) =>
                                normalizeString(editor.config?.name).trim()
                                || normalizeString(catalogByName.get(serviceName)?.description).trim()
                                || "Update the user-facing addresses for this part of Noona.",
                        },
                    )}
                </Column>
            </Card>

            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Heading as="h2" variant="heading-strong-l">Diagnostics</Heading>
                        <Badge background={debugEnabled ? "warning-alpha-weak" : "neutral-alpha-weak"}
                               onBackground="neutral-strong">
                            {debugEnabled ? "debug enabled" : "debug disabled"}
                        </Badge>
                    </Row>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Toggle live debug logging across the managed services when you need deeper troubleshooting.
                    </Text>
                    {formatIso(debugUpdatedAt) && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Updated {formatIso(debugUpdatedAt)}
                        </Text>
                    )}
                    {debugError && <Text onBackground="danger-strong" variant="body-default-xs">{debugError}</Text>}
                    {debugMessage && <Text onBackground="neutral-weak" variant="body-default-xs">{debugMessage}</Text>}
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="primary" disabled={debugLoading || debugSaving}
                                onClick={() => void setDebugMode(!debugEnabled)}>
                            {debugSaving ? "Updating..." : debugEnabled ? "Disable debug mode" : "Enable debug mode"}
                        </Button>
                        <Button variant="secondary" disabled={debugLoading || debugSaving}
                                onClick={() => void loadDebugSetting()}>
                            {debugLoading ? "Refreshing..." : "Refresh"}
                        </Button>
                    </Row>
                </Column>
            </Card>
        </Column>
    );

    const renderFilesystemSettings = () => (
        <Column fillWidth gap="16">
            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Heading as="h2" variant="heading-strong-l">File system layout</Heading>
                        <Button variant="secondary" disabled={storageLayoutLoading}
                                onClick={() => void loadStorageLayout()}>
                            {storageLayoutLoading ? "Refreshing..." : "Refresh layout"}
                        </Button>
                    </Row>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        This mirrors the setup wizard view so users can see where Noona is reading and writing files.
                    </Text>
                    {storageLayoutRoot && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Root folder: {storageLayoutRoot}
                        </Text>
                    )}
                    {storageLayoutError &&
                        <Text onBackground="danger-strong" variant="body-default-xs">{storageLayoutError}</Text>}
                    {storageLayoutLoading && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}
                    {!storageLayoutLoading && filesystemPreview.length === 0 && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            No storage layout preview is available yet.
                        </Text>
                    )}
                    {!storageLayoutLoading && filesystemPreview.length > 0 && (
                        <div className={settingsStyles.defaultCardGrid}>
                            {filesystemPreview.map((serviceEntry, index) => {
                                const serviceName = normalizeString(serviceEntry.service).trim();
                                const label = normalizeString(serviceEntry.label).trim() || getServiceLabel(serviceName);
                                const folders = Array.isArray(serviceEntry.folders) ? serviceEntry.folders : [];

                                return (
                                    <Card
                                        key={`filesystem-preview-${serviceName || index}`}
                                        fillWidth
                                        background={BG_SURFACE}
                                        border="neutral-alpha-weak"
                                        padding="m"
                                        radius="l"
                                    >
                                        <Column gap="8">
                                            <Heading as="h3" variant="heading-strong-m">{label}</Heading>
                                            {folders.length === 0 && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    No folders were published for this service.
                                                </Text>
                                            )}
                                            {folders.map((folder, folderIndex) => (
                                                <Card
                                                    key={`filesystem-folder-${serviceName}-${folderIndex}`}
                                                    fillWidth
                                                    background={BG_NEUTRAL_ALPHA_WEAK}
                                                    border="neutral-alpha-weak"
                                                    padding="m"
                                                    radius="l"
                                                >
                                                    <Column gap="4">
                                                        <Text variant="label-default-s">
                                                            {normalizeString(folder.key).trim() || `Folder ${folderIndex + 1}`}
                                                        </Text>
                                                        {normalizeString(folder.hostPath).trim() && (
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                Host: {normalizeString(folder.hostPath).trim()}
                                                            </Text>
                                                        )}
                                                        {normalizeString(folder.containerPath).trim() && (
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                Container: {normalizeString(folder.containerPath).trim()}
                                                            </Text>
                                                        )}
                                                    </Column>
                                                </Card>
                                            ))}
                                        </Column>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </Column>
            </Card>

            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Heading as="h2" variant="heading-strong-l">Editable storage paths</Heading>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Update the managed folder paths without leaving the settings page.
                    </Text>
                    {renderServiceCards(
                        FILESYSTEM_SERVICES,
                        (_serviceName, editor) =>
                            (Array.isArray(editor.config?.envConfig) ? editor.config.envConfig : []).filter((field) => {
                                const key = normalizeString(field.key).trim();
                                return isPathLikeField(key);
                            }),
                        {
                            emptyTitle: "No storage paths available",
                            emptyDescription: "No editable storage path settings were published for the current stack.",
                            saveLabel: "Save and restart",
                            descriptionForService: () => "Change the folders this service uses on disk.",
                        },
                    )}
                </Column>
            </Card>
        </Column>
    );

    const renderDatabaseSettings = () => {
        const renderDocumentCard = (entry: unknown, index: number) => {
            const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
            const oidValue = record && typeof record._id === "object" && record._id && "$oid" in (record._id as Record<string, unknown>)
                ? (record._id as Record<string, unknown>).$oid
                : record?._id;
            const idCandidate = normalizeString(oidValue).trim();
            const label = record
                ? normalizeString(record.title ?? record.name ?? record.key ?? idCandidate).trim()
                : "";
            const timestamp = formatIso(
                record?.updatedAt ?? record?.createdAt ?? record?.requestedAt ?? record?.approvedAt ?? record?.completedAt,
            );

            return (
                <Row key={`${collection}-${idCandidate || index}`} fillWidth>
                    <Card
                        fillWidth
                        background={BG_SURFACE}
                        border="neutral-alpha-weak"
                        padding="m"
                        radius="l"
                    >
                        <Column gap="8" style={{minWidth: 0}}>
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Text variant="label-default-s">{label || `Document ${index + 1}`}</Text>
                            {timestamp && (
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    {timestamp}
                                </Text>
                            )}
                        </Row>
                        {idCandidate && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                ID: {idCandidate}
                            </Text>
                        )}
                        <Text variant="body-default-xs"
                              style={{
                                  whiteSpace: "pre-wrap",
                                  fontFamily: "var(--font-code)",
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                  minWidth: 0,
                              }}>
                            {JSON.stringify(entry, null, 2)}
                        </Text>
                        </Column>
                    </Card>
                </Row>
            );
        };

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Database connection</Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="secondary"
                                    disabled={vaultEditor.loading || vaultEditor.saving}
                                    onClick={() => setShowMongoUri((prev) => !prev)}
                                >
                                    {showMongoUri ? "Hide URI" : "Show URI"}
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={vaultEditor.loading || vaultEditor.saving}
                                    onClick={() => void loadServiceConfig("noona-vault")}
                                >
                                    {vaultEditor.loading ? "Loading..." : "Reload"}
                                </Button>
                                <Button
                                    variant="primary"
                                    disabled={vaultEditor.loading || vaultEditor.saving || !vaultMongoUriField}
                                    onClick={() => void saveServiceConfig("noona-vault")}
                                >
                                    {vaultEditor.saving ? "Saving..." : "Save and restart"}
                                </Button>
                            </Row>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Keep the managed Mongo URI hidden by default, but editable when you need to change it.
                        </Text>
                        {renderEditorFeedback(vaultEditor)}
                        {vaultEditor.loading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!vaultEditor.loading && vaultMongoUriField && renderEditorField(
                            "noona-vault",
                            vaultEditor,
                            vaultMongoUriField,
                            "mongo-uri",
                            {type: showMongoUri ? "text" : "password"},
                        )}
                        {!vaultEditor.loading && !vaultMongoUriField && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                No editable Mongo URI field is available for the current Vault configuration.
                            </Text>
                        )}
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Collection viewer</Heading>
                            <Button variant="secondary" disabled={collectionsLoading}
                                    onClick={() => void loadCollections()}>
                                {collectionsLoading ? "Refreshing..." : "Refresh collections"}
                            </Button>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Collections are sorted alphabetically, and documents are sorted by the newest timestamp Moon
                            can infer.
                        </Text>
                        {collectionsError &&
                            <Text onBackground="danger-strong" variant="body-default-xs">{collectionsError}</Text>}
                        {collectionsLoading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!collectionsLoading && (
                            <Column gap="12">
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    {sortedCollections.map((name) => (
                                        <Button
                                            key={`collection-${name}`}
                                            variant={collection === name ? "primary" : "secondary"}
                                            onClick={() => setCollection(name)}
                                        >
                                            {name}
                                        </Button>
                                    ))}
                                </Row>
                                {collection && (
                                    <Row gap="12" vertical="end" style={{flexWrap: "wrap"}}>
                                        <div style={{width: "12rem", maxWidth: "100%"}}>
                                            <Input
                                                id="vault-limit"
                                                name="vault-limit"
                                                type="number"
                                                label="Initial batch size"
                                                value={limit}
                                                onChange={(event) => setLimit(event.target.value)}
                                            />
                                        </div>
                                        <Button variant="secondary" disabled={documentsLoading}
                                                onClick={() => void loadDocuments(collection, limit)}>
                                            {documentsLoading ? "Loading..." : "Load documents"}
                                        </Button>
                                    </Row>
                                )}
                                {documentsError && <Text onBackground="danger-strong"
                                                         variant="body-default-xs">{documentsError}</Text>}
                                {collection && (
                                    <Column gap="8">
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Showing {sortedDocuments.length} document{sortedDocuments.length === 1 ? "" : "s"}
                                            {documentsHasMore ? " with more available as you scroll." : "."}
                                        </Text>
                                        <Column
                                            fillWidth
                                            gap="8"
                                            background={BG_NEUTRAL_ALPHA_WEAK}
                                            padding="m"
                                            radius="l"
                                            border="neutral-alpha-weak"
                                            style={{
                                                height: DATABASE_DOCUMENT_VIEWER_HEIGHT,
                                                minHeight: DATABASE_DOCUMENT_VIEWER_HEIGHT,
                                                overflowY: "auto",
                                                overflowX: "hidden",
                                                paddingRight: 12,
                                            }}
                                        >
                                            {documentsLoading && sortedDocuments.length === 0 && (
                                                <Row
                                                    fillWidth
                                                    horizontal="center"
                                                    vertical="center"
                                                    style={{height: "100%"}}
                                                >
                                                    <Spinner/>
                                                </Row>
                                            )}
                                            {sortedDocuments.length === 0 && !documentsLoading && !documentsError && (
                                                <Row
                                                    fillWidth
                                                    horizontal="center"
                                                    vertical="center"
                                                    style={{height: "100%"}}
                                                >
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        No documents were returned for this collection.
                                                    </Text>
                                                </Row>
                                            )}
                                            {sortedDocuments.length > 0 && (
                                                <InfiniteScroll
                                                    items={sortedDocuments}
                                                    loading={documentsLoading}
                                                    loadMore={loadMoreDocuments}
                                                    threshold={160}
                                                    renderItem={renderDocumentCard}
                                                />
                                            )}
                                        </Column>
                                    </Column>
                                )}
                            </Column>
                        )}
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="danger-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Heading as="h2" variant="heading-strong-l">Danger zone</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Factory reset wipes Vault storage and restarts Noona as a clean build.
                        </Text>
                        <Input
                            id="vault-factory-reset-password"
                            name="vault-factory-reset-password"
                            type={factoryResetConfirmationMeta.mode === "password" ? "password" : "text"}
                            label={factoryResetConfirmationMeta.label}
                            value={factoryResetConfirmation}
                            disabled={factoryResetBusy}
                            onChange={(event) => setFactoryResetConfirmation(event.target.value)}
                        />
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            {factoryResetConfirmationMeta.hint}
                        </Text>
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
                            <Card fillWidth background={BG_SURFACE} border={BG_WARNING_ALPHA_WEAK} padding="m"
                                  radius="l">
                                <Column gap="8">
                                    <Row horizontal="between" vertical="center">
                                        <Text variant="label-default-s">Restart progress</Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            {clampPercent(factoryResetProgress.percent)}%
                                        </Text>
                                    </Row>
                                    <Row fillWidth background={BG_NEUTRAL_ALPHA_WEAK}
                                         style={{height: 8, borderRadius: 999, overflow: "hidden"}}>
                                        <Row background={BG_WARNING_ALPHA_WEAK} style={{
                                            height: "100%",
                                            width: `${clampPercent(factoryResetProgress.percent)}%`
                                        }}/>
                                    </Row>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        {factoryResetProgress.detail}
                                    </Text>
                                </Column>
                            </Card>
                        )}
                        {factoryResetError &&
                            <Text onBackground="danger-strong" variant="body-default-xs">{factoryResetError}</Text>}
                        {factoryResetMessage &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{factoryResetMessage}</Text>}
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={factoryResetBusy}
                                    onClick={() => void runFactoryReset()}>
                                {factoryResetProgress ? "Restarting..." : factoryResetBusy ? "Resetting..." : "Factory reset"}
                            </Button>
                        </Row>
                    </Column>
                </Card>
            </Column>
        );
    };

    const renderDownloaderSettings = () => {
        const downloaderRuntimeFields = ravenEnvConfig.filter((field) => {
            const key = normalizeString(field.key).trim();
            if (!key || key === KOMF_APPLICATION_YML_KEY || field.readOnly === true) return false;
            return !isUrlLikeField(key) && !isPathLikeField(key) && !/KAVITA_API_KEY/i.test(key);
        });

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Downloader runtime</Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button variant="secondary" disabled={ravenEditor.loading || ravenEditor.saving}
                                        onClick={() => void loadServiceConfig("noona-raven")}>
                                    {ravenEditor.loading ? "Loading..." : "Reload"}
                                </Button>
                                <Button variant="primary" disabled={ravenEditor.loading || ravenEditor.saving}
                                        onClick={() => void saveServiceConfig("noona-raven")}>
                                    {ravenEditor.saving ? "Saving..." : "Save and restart"}
                                </Button>
                            </Row>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Worker count and other downloader runtime controls live here.
                        </Text>
                        {renderEditorFeedback(ravenEditor)}
                        {ravenEditor.loading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!ravenEditor.loading && downloaderRuntimeFields.length === 0 && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                No editable downloader runtime fields are available.
                            </Text>
                        )}
                        {!ravenEditor.loading && downloaderRuntimeFields.map((field) =>
                            renderEditorField("noona-raven", ravenEditor, field, "downloader-runtime"),
                        )}
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Naming schema</Heading>
                            <Row gap="8">
                                <Button variant="secondary" disabled={namingLoading} onClick={() => void loadNaming()}>
                                    {namingLoading ? "Reloading..." : "Reload"}
                                </Button>
                                <Button variant="primary" disabled={namingLoading || namingSaving}
                                        onClick={() => void saveNaming()}>
                                    {namingSaving ? "Saving..." : "Save naming"}
                                </Button>
                            </Row>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Tokens: {TOKENS.join(" ")}
                        </Text>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            <code>{`{chapter}`}</code> now uses the configured chapter
                            padding. <code>{`{chapter_padded}`}</code> remains available as the same padded value.
                        </Text>
                        {namingError &&
                            <Text onBackground="danger-strong" variant="body-default-xs">{namingError}</Text>}
                        {namingMessage &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{namingMessage}</Text>}
                        <Input id="titleTemplate" name="titleTemplate" label="Title template" value={titleTemplate}
                               onChange={(event) => setTitleTemplate(event.target.value)}/>
                        <Input id="chapterTemplate" name="chapterTemplate" label="Chapter template"
                               value={chapterTemplate} onChange={(event) => setChapterTemplate(event.target.value)}/>
                        <Input id="pageTemplate" name="pageTemplate" label="Page template" value={pageTemplate}
                               onChange={(event) => setPageTemplate(event.target.value)}/>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Input id="pagePad" name="pagePad" label="Page padding" type="number" value={pagePad}
                                   onChange={(event) => setPagePad(event.target.value)}/>
                            <Input id="chapterPad" name="chapterPad" label="Chapter padding" type="number"
                                   value={chapterPad} onChange={(event) => setChapterPad(event.target.value)}/>
                        </Row>
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Column gap="4">
                                <Heading as="h2" variant="heading-strong-l">Thread speed limits</Heading>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Set a per-thread download cap in KB/s, or type values like 10mb or 1gb. Use -1 for
                                    unlimited speed.
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
                                <Button variant="secondary" disabled={downloadWorkerSettingsLoading}
                                        onClick={() => void loadDownloadWorkerSettings()}>
                                    {downloadWorkerSettingsLoading ? "Reloading..." : "Reload"}
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
                        {downloadWorkerSettingsError && <Text onBackground="danger-strong"
                                                              variant="body-default-xs">{downloadWorkerSettingsError}</Text>}
                        {downloadWorkerSettingsMessage && <Text onBackground="neutral-weak"
                                                                variant="body-default-xs">{downloadWorkerSettingsMessage}</Text>}
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
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Column gap="4">
                                <Heading as="h2" variant="heading-strong-l">PIA VPN</Heading>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Configure PIA credentials, select a region endpoint, and rotate Raven&apos;s IP on a
                                    schedule.
                                </Text>
                                {vpnUpdatedAt && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Updated {formatIso(vpnUpdatedAt)}
                                    </Text>
                                )}
                                {vpnStatus && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Status: {normalizeString(vpnStatus.connectionState).trim() || "unknown"}
                                        {normalizeString(vpnStatus.publicIp).trim()
                                            ? ` | Public IP ${normalizeString(vpnStatus.publicIp).trim()}`
                                            : ""}
                                    </Text>
                                )}
                            </Column>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="secondary"
                                    disabled={vpnLoading || vpnTesting}
                                    onClick={() => void Promise.all([loadVpnRegions(), loadVpnSettings()])}
                                >
                                    {vpnLoading ? "Reloading..." : "Reload"}
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                                    onClick={() => void testVpnLogin()}
                                >
                                    {vpnTesting ? "Testing..." : "Test login"}
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting || !vpnEnabled}
                                    onClick={() => void rotateVpnNow()}
                                >
                                    {vpnRotating ? "Rotating..." : "Rotate now"}
                                </Button>
                                <Button
                                    variant="primary"
                                    disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                                    onClick={() => void saveVpnSettings()}
                                >
                                    {vpnSaving ? "Saving..." : "Save VPN"}
                                </Button>
                            </Row>
                        </Row>
                        {vpnError && <Text onBackground="danger-strong" variant="body-default-xs">{vpnError}</Text>}
                        {vpnMessage && <Text onBackground="neutral-weak" variant="body-default-xs">{vpnMessage}</Text>}
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Switch
                                isChecked={vpnEnabled}
                                disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                                ariaLabel="Toggle Raven VPN"
                                onToggle={() => setVpnEnabled((prev) => !prev)}
                            />
                            <Text variant="body-default-xs">Enable VPN for Raven downloads</Text>
                        </Row>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Switch
                                isChecked={vpnAutoRotate}
                                disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting || !vpnEnabled}
                                ariaLabel="Toggle Raven VPN auto-rotation"
                                onToggle={() => setVpnAutoRotate((prev) => !prev)}
                            />
                            <Text variant="body-default-xs">Auto rotate every 30 minutes (or custom interval)</Text>
                        </Row>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Input
                                id="vpnRotateEveryMinutes"
                                name="vpnRotateEveryMinutes"
                                label="Rotate every (minutes)"
                                type="number"
                                value={vpnRotateEveryMinutes}
                                disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                                onChange={(event) => setVpnRotateEveryMinutes(event.target.value)}
                            />
                            <Column fillWidth gap="8" style={{minWidth: "18rem"}}>
                                <Text variant="body-default-s">PIA region</Text>
                                <select
                                    value={vpnRegion}
                                    onChange={(event) => setVpnRegion(event.target.value)}
                                    disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                                    aria-label="Select PIA region"
                                    style={{
                                        width: "100%",
                                        minHeight: "2.5rem",
                                        borderRadius: "0.75rem",
                                        border: "1px solid var(--neutral-alpha-medium)",
                                        background: "var(--neutral-alpha-weak)",
                                        color: "inherit",
                                        padding: "0.5rem 0.75rem",
                                    }}
                                >
                                    {vpnRegions.length === 0 && (
                                        <option
                                            value={vpnRegion}
                                            style={{color: "black", backgroundColor: "white"}}
                                        >
                                            {vpnRegion || DEFAULT_VPN_REGION}
                                        </option>
                                    )}
                                    {vpnRegions.map((entry) => {
                                        const id = normalizeString(entry?.id).trim();
                                        if (!id) return null;
                                        const label = normalizeString(entry?.label).trim() || id;
                                        const endpoint = normalizeString(entry?.endpoint).trim();
                                        return (
                                            <option
                                                key={id}
                                                value={id}
                                                style={{color: "black", backgroundColor: "white"}}
                                            >
                                                {endpoint ? `${label} (${endpoint})` : label}
                                            </option>
                                        );
                                    })}
                                </select>
                            </Column>
                        </Row>
                        <Input
                            id="vpnUsername"
                            name="vpnUsername"
                            label="PIA Username"
                            type="text"
                            value={vpnUsername}
                            disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                            onChange={(event) => setVpnUsername(event.target.value)}
                        />
                        <Input
                            id="vpnPassword"
                            name="vpnPassword"
                            label={vpnPasswordConfigured ? "PIA Password (leave blank to keep stored value)" : "PIA Password"}
                            type="password"
                            value={vpnPassword}
                            disabled={vpnLoading || vpnSaving || vpnRotating || vpnTesting}
                            onChange={(event) => setVpnPassword(event.target.value)}
                        />
                    </Column>
                </Card>
            </Column>
        );
    };

    const renderUpdaterSettings = () => (
        <Column fillWidth gap="16">
            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Heading as="h2" variant="heading-strong-l">Update behavior</Heading>
                        <Button
                            variant="primary"
                            disabled={wardenEditor.loading || wardenEditor.saving}
                            onClick={() =>
                                void saveServiceConfig("noona-warden", {
                                    restart: false,
                                    successMessage: "Saved updater settings.",
                                    onSuccess: async () => {
                                        await loadCatalog();
                                    },
                                })
                            }
                        >
                            {wardenEditor.saving ? "Saving..." : "Save updater settings"}
                        </Button>
                    </Row>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        The updater uses the host base URL and auto-update policy from Warden.
                    </Text>
                    {wardenHostBaseUrl && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Current host URL base: {wardenHostBaseUrl}
                        </Text>
                    )}
                    {renderEditorFeedback(wardenEditor)}
                    {wardenEditor.loading && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}
                    {!wardenEditor.loading && (
                        <Column gap="12">
                            {wardenServerIpField && renderEditorField("noona-warden", wardenEditor, wardenServerIpField, "warden-links")}
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
                                        {renderSharedFieldNotes(wardenAutoUpdatesField)}
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
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Heading as="h2" variant="heading-strong-l">Noona updater</Heading>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={updatesLoading || updatesBusy}
                                    onClick={() => void loadUpdates()}>
                                {updatesLoading ? "Reloading..." : "Reload"}
                            </Button>
                            <Button variant="secondary" disabled={updatesLoading || updatesChecking || updatesBusy}
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
                        Check and apply Docker image updates in a grid so users can see the whole stack at once.
                    </Text>
                    {updatesError && <Text onBackground="danger-strong" variant="body-default-xs">{updatesError}</Text>}
                    {updatesMessage &&
                        <Text onBackground="neutral-weak" variant="body-default-xs">{updatesMessage}</Text>}
                    {updatesLoading && (
                        <Row fillWidth horizontal="center" paddingY="16">
                            <Spinner/>
                        </Row>
                    )}
                    {!updatesLoading && installedUpdateSnapshots.length === 0 && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            No update snapshots are available for installed services.
                        </Text>
                    )}
                    {!updatesLoading && installedUpdateSnapshots.length > 0 && (
                        <Column fillWidth gap="12">
                            <div
                                style={{
                                    display: "grid",
                                    width: "100%",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))",
                                    gap: 12,
                                }}
                            >
                                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="m"
                                      radius="l">
                                    <Column gap="4">
                                        <Text variant="label-default-s" onBackground="neutral-weak">Installed</Text>
                                        <Heading as="p" variant="display-strong-xs">{updaterSummary.total}</Heading>
                                    </Column>
                                </Card>
                                <Card fillWidth background={BG_SURFACE} border="warning-alpha-medium" padding="m"
                                      radius="l">
                                    <Column gap="4">
                                        <Text variant="label-default-s" onBackground="neutral-weak">Need updates</Text>
                                        <Heading as="p"
                                                 variant="display-strong-xs">{updaterSummary.updateAvailable}</Heading>
                                    </Column>
                                </Card>
                                <Card fillWidth background={BG_SURFACE} border="success-alpha-medium" padding="m"
                                      radius="l">
                                    <Column gap="4">
                                        <Text variant="label-default-s" onBackground="neutral-weak">Up to date</Text>
                                        <Heading as="p" variant="display-strong-xs">{updaterSummary.upToDate}</Heading>
                                    </Column>
                                </Card>
                                <Card fillWidth background={BG_SURFACE} border="danger-alpha-medium" padding="m"
                                      radius="l">
                                    <Column gap="4">
                                        <Text variant="label-default-s" onBackground="neutral-weak">Unsupported /
                                            errors</Text>
                                        <Heading as="p" variant="display-strong-xs">
                                            {updaterSummary.unsupported + updaterSummary.errors}
                                        </Heading>
                                    </Column>
                                </Card>
                            </div>

                            <div className={settingsStyles.defaultCardGrid}>
                                {installedUpdateSnapshots.map((entry, index) => {
                                    const service = normalizeString(entry.service).trim();
                                    const updateAvailable = entry.updateAvailable === true;
                                    const unsupported = entry.supported === false;
                                    const checkedAt = formatIso(entry.checkedAt);
                                    const image = normalizeString(entry.image).trim();
                                    const errorMessage = normalizeString(entry.error).trim();
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
                                        <Card
                                            key={`${service || "unknown"}-${index}`}
                                            fillWidth
                                            background={BG_SURFACE}
                                            border="neutral-alpha-weak"
                                            padding="m"
                                            radius="l"
                                        >
                                            <Column fillWidth gap="12" style={{height: "100%"}}>
                                                <Row horizontal="between" vertical="start" gap="12"
                                                     style={{flexWrap: "wrap"}}>
                                                    <Column gap="8" style={{minWidth: 0, flex: "1 1 12rem"}}>
                                                        <Text variant="heading-default-s">
                                                            {getServiceLabel(service || "unknown")}
                                                        </Text>
                                                        <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                            <Badge background={badgeBackground}
                                                                   onBackground="neutral-strong">
                                                                {badgeLabel}
                                                            </Badge>
                                                            {checkedAt && (
                                                                <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                                       onBackground="neutral-strong">
                                                                    {checkedAt}
                                                                </Badge>
                                                            )}
                                                        </Row>
                                                    </Column>
                                                    <Button
                                                        variant={updateAvailable ? "primary" : "secondary"}
                                                        disabled={!service || unsupported || !updateAvailable || updatesApplyingAll || updating[service]}
                                                        onClick={() => void updateImage(service)}
                                                    >
                                                        {updating[service] ? "Updating..." : "Update"}
                                                    </Button>
                                                </Row>

                                                <Column gap="8" style={{marginTop: "auto"}}>
                                                    {image && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            Image: {image}
                                                        </Text>
                                                    )}
                                                    {!checkedAt && !errorMessage && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            No update check has been recorded yet for this service.
                                                        </Text>
                                                    )}
                                                    {errorMessage && (
                                                        <Text onBackground="danger-strong" variant="body-default-xs"
                                                              wrap="balance">
                                                            {errorMessage}
                                                        </Text>
                                                    )}
                                                </Column>
                                            </Column>
                                        </Card>
                                    );
                                })}
                            </div>
                        </Column>
                    )}
                </Column>
            </Card>
        </Column>
    );

    const renderDiscordSettings = () => {
        const discordRoles = Array.isArray(discordValidation?.roles) ? discordValidation.roles : [];
        const guilds = Array.isArray(discordValidation?.guilds) ? discordValidation.guilds : [];

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Discord connection</Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button
                                    variant="secondary"
                                    disabled={portalEditor.loading || portalEditor.saving || discordValidating}
                                    onClick={() => void testDiscordConnection()}
                                >
                                    {discordValidating ? "Testing..." : "Test Discord connection"}
                                </Button>
                                <Button
                                    variant="primary"
                                    disabled={portalEditor.loading || portalEditor.saving}
                                    onClick={() => void saveServiceConfig("noona-portal")}
                                >
                                    {portalEditor.saving ? "Saving..." : "Save and restart"}
                                </Button>
                            </Row>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Edit the Discord bot credentials and validate them against the selected guild.
                        </Text>
                        {renderEditorFeedback(portalEditor)}
                        {discordValidationError && <Text onBackground="danger-strong"
                                                         variant="body-default-xs">{discordValidationError}</Text>}
                        {portalEditor.loading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!portalEditor.loading && portalDiscordFields.map((field) =>
                            renderEditorField("noona-portal", portalEditor, field, "discord-connection"),
                        )}
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Heading as="h2" variant="heading-strong-l">Discord validation</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Use this like the setup wizard: confirm the bot, application, and guild before saving role
                            rules.
                        </Text>
                        {!discordValidation && !discordValidationError && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Run a connection test to load guild and role details.
                            </Text>
                        )}
                        {discordValidation?.botUser && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Bot
                                user: {normalizeString(discordValidation.botUser.tag).trim() || normalizeString(discordValidation.botUser.username).trim()}
                            </Text>
                        )}
                        {discordValidation?.application && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Application: {normalizeString(discordValidation.application.name).trim()}
                                {discordValidation.application.verified ? " (verified)" : ""}
                            </Text>
                        )}
                        {guilds.length > 0 && (
                            <Column gap="8">
                                <Text onBackground="neutral-weak" variant="label-default-s">Guild</Text>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    {guilds.map((guild) => {
                                        const guildId = normalizeString(guild.id).trim();
                                        const selected = normalizeString(portalEditor.envDraft.DISCORD_GUILD_ID).trim() === guildId;
                                        return (
                                            <Button
                                                key={`discord-guild-${guildId}`}
                                                variant={selected ? "primary" : "secondary"}
                                                onClick={() => selectDiscordGuild(guildId)}
                                            >
                                                {normalizeString(guild.name).trim() || guildId}
                                            </Button>
                                        );
                                    })}
                                </Row>
                            </Column>
                        )}
                        {discordRoles.length > 0 && (
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {discordRoles.map((role) => (
                                    <Badge key={`discord-role-${normalizeString(role.id).trim()}`}
                                           background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                        {normalizeString(role.name).trim() || normalizeString(role.id).trim()}
                                    </Badge>
                                ))}
                            </Row>
                        )}
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Heading as="h2" variant="heading-strong-l">Command permissions</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Assign the Discord role required for each command.
                        </Text>
                        {portalAccessFields.length === 0 && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                No command role fields are available for the current Portal configuration.
                            </Text>
                        )}
                        {portalAccessFields.map((field) => {
                            const fieldKey = normalizeString(field.key).trim();
                            const selectedRoleId = normalizeString(portalEditor.envDraft[fieldKey]).trim();

                            return (
                                <Column key={`portal-access-${fieldKey}`} gap="8">
                                    {renderEditorField("noona-portal", portalEditor, field, "command-access")}
                                    {discordRoles.length > 0 && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {discordRoles.map((role) => {
                                                const roleId = normalizeString(role.id).trim();
                                                const selected = selectedRoleId === roleId;
                                                return (
                                                    <Button
                                                        key={`portal-access-role-${fieldKey}-${roleId}`}
                                                        variant={selected ? "primary" : "secondary"}
                                                        onClick={() => updateEnvDraft("noona-portal", fieldKey, roleId)}
                                                    >
                                                        {normalizeString(role.name).trim() || roleId}
                                                    </Button>
                                                );
                                            })}
                                        </Row>
                                    )}
                                </Column>
                            );
                        })}
                    </Column>
                </Card>
            </Column>
        );
    };

    const renderKomfSettings = () => {
        const komfConfigField = komfEnvConfig.find((field) => normalizeString(field.key).trim() === KOMF_APPLICATION_YML_KEY);
        const komfRuntimeFields = komfEnvConfig.filter((field) => {
            const key = normalizeString(field.key).trim();
            return key !== KOMF_APPLICATION_YML_KEY && field.readOnly !== true;
        });

        return (
            <Column fillWidth gap="16">
                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Komf settings</Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button variant="secondary"
                                        onClick={() => patchEditor("noona-komf", {advanced: !komfEditor.advanced})}>
                                    {komfEditor.advanced ? "Hide raw editor" : "Show raw editor"}
                                </Button>
                                <Button variant="secondary" disabled={komfEditor.loading || komfEditor.saving}
                                        onClick={() => void loadServiceConfig("noona-komf")}>
                                    {komfEditor.loading ? "Loading..." : "Reload"}
                                </Button>
                                <Button variant="primary" disabled={komfEditor.loading || komfEditor.saving}
                                        onClick={() => void saveServiceConfig("noona-komf")}>
                                    {komfEditor.saving ? "Saving..." : "Save and restart"}
                                </Button>
                            </Row>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Edit the managed Komf application file and the runtime settings Moon exposes for it.
                        </Text>
                        {renderEditorFeedback(komfEditor)}
                        {komfEditor.loading && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!komfEditor.loading && komfConfigField && (
                            <KomfApplicationEditor
                                label={normalizeString(komfConfigField.label).trim() || "Managed application.yml"}
                                description={komfConfigField.description}
                                warning={komfConfigField.warning}
                                value={getEditorFieldValue(komfEditor, komfConfigField)}
                                defaultValue={normalizeString(komfConfigField.defaultValue)}
                                disabled={komfConfigField.readOnly === true}
                                showRawEditor={komfEditor.advanced}
                                onChange={(nextValue) => updateEnvDraft("noona-komf", KOMF_APPLICATION_YML_KEY, nextValue)}
                            />
                        )}
                        {!komfEditor.loading && komfRuntimeFields.length > 0 && (
                            <Column gap="12">
                                {komfRuntimeFields.map((field) => renderEditorField("noona-komf", komfEditor, field, "komf-runtime"))}
                            </Column>
                        )}
                    </Column>
                </Card>
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

        const sortedUsers = [...managedUsersWithKavita].sort((left, right) =>
            normalizeString(left.user.username).localeCompare(normalizeString(right.user.username)),
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
                    <Column gap="8">
                        <Heading as="h2" variant="heading-strong-l">Moon permission legend</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Permission descriptions are listed once here to reduce visual noise in each user card.
                        </Text>
                        <Column gap={6}>
                            {MOON_PERMISSION_ORDER.map((permission) => (
                                <Text key={`permission-legend-${permission}`} onBackground="neutral-weak"
                                      variant="body-default-xs">
                                    {MOON_PERMISSION_LABELS[permission]}: {MOON_PERMISSION_DESCRIPTIONS[permission]}
                                </Text>
                            ))}
                        </Column>
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
                        </Column>
                        <Button variant="primary" disabled={usersSaving} onClick={() => void createManagedUser()}>
                            {usersSaving ? "Saving..." : "Create Discord user"}
                        </Button>
                    </Column>
                </Card>

                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Heading as="h2" variant="heading-strong-l">Users</Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                <Button variant="secondary" disabled={usersLoading || usersSaving}
                                        onClick={() => void loadManagedUsers()}>
                                    {usersLoading ? "Loading..." : "Refresh Moon users"}
                                </Button>
                                <Button variant="secondary" disabled={kavitaUsersLoading}
                                        onClick={() => void loadKavitaUsers()}>
                                    {kavitaUsersLoading ? "Loading..." : "Refresh Kavita users"}
                                </Button>
                            </Row>
                        </Row>
                        {usersError && <Text onBackground="danger-strong" variant="body-default-xs">{usersError}</Text>}
                        {usersMessage &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{usersMessage}</Text>}
                        {kavitaUsersError &&
                            <Text onBackground="danger-strong" variant="body-default-xs">{kavitaUsersError}</Text>}
                        {kavitaUsersMessage &&
                            <Text onBackground="neutral-weak" variant="body-default-xs">{kavitaUsersMessage}</Text>}
                        {(usersLoading || kavitaUsersLoading) && (
                            <Row fillWidth horizontal="center" paddingY="16">
                                <Spinner/>
                            </Row>
                        )}
                        {!usersLoading && !kavitaUsersLoading && sortedUsers.length === 0 && (
                            <Text onBackground="neutral-weak" variant="body-default-xs">No users found.</Text>
                        )}
                        {!usersLoading && !kavitaUsersLoading && sortedUsers.length > 0 && (
                            <Column gap="12">
                                {sortedUsers.map(({user: entry, kavitaUser}) => {
                                    const key = userLookupKey(entry);
                                    const fallbackUsername = normalizeString(entry.username).trim();
                                    const draft = editingUser[key] ?? {
                                        username: fallbackUsername,
                                        permissions: normalizePermissions(entry.permissions),
                                    };
                                    const isProtected = entry.isBootstrapUser === true;
                                    const authProvider = normalizeString(entry.authProvider).trim() || "local";
                                    const discordUserId = normalizeString(entry.discordUserId).trim();
                                    const linkedKavitaUsername = normalizeString(kavitaUser?.username).trim();
                                    const linkedKavitaEmail = normalizeString(kavitaUser?.email).trim();
                                    const linkedKavitaRoles = normalizeDistinctStringList(kavitaUser?.roles);
                                    const kavitaRoleDraft = normalizeDistinctStringList(editingKavitaRoles[key] ?? linkedKavitaRoles);
                                    const hasLinkedKavitaUser = Boolean(linkedKavitaUsername);
                                    const kavitaSaveBusy = savingKavitaRoles[key] === true;

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
                                                </Column>
                                                <Column gap="8">
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Kavita roles
                                                    </Text>
                                                    {!hasLinkedKavitaUser && (
                                                        <Text onBackground="warning-strong" variant="body-default-xs">
                                                            No linked Kavita account was found for this user by email or
                                                            username.
                                                        </Text>
                                                    )}
                                                    {hasLinkedKavitaUser && (
                                                        <>
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                Linked Kavita user: {linkedKavitaUsername}
                                                                {linkedKavitaEmail ? ` (${linkedKavitaEmail})` : ""}
                                                            </Text>
                                                            <Input
                                                                id={`user-kavita-roles-${key}`}
                                                                name={`user-kavita-roles-${key}`}
                                                                label="Kavita roles (comma separated)"
                                                                value={serializeCsvSelections(kavitaRoleDraft)}
                                                                disabled={isProtected || kavitaSaveBusy}
                                                                onChange={(event) =>
                                                                    setEditingKavitaRolesFromCsv(key, event.target.value)
                                                                }
                                                            />
                                                            {kavitaRoleOptions.length > 0 && (
                                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                                    {kavitaRoleOptions.map((role) => {
                                                                        const selected = kavitaRoleDraft.some(
                                                                            (entryRole) => entryRole.toLowerCase() === role.toLowerCase(),
                                                                        );
                                                                        return (
                                                                            <Button
                                                                                key={`${key}-kavita-role-${role}`}
                                                                                variant={selected ? "primary" : "secondary"}
                                                                                disabled={isProtected || kavitaSaveBusy}
                                                                                onClick={() => toggleEditingKavitaRole(key, role)}
                                                                            >
                                                                                {role}
                                                                            </Button>
                                                                        );
                                                                    })}
                                                                </Row>
                                                            )}
                                                        </>
                                                    )}
                                                </Column>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Button variant="primary" disabled={isProtected || usersSaving}
                                                            onClick={() => void saveManagedUser(entry)}>
                                                        Save user
                                                    </Button>
                                                    {hasLinkedKavitaUser && (
                                                        <Button
                                                            variant="secondary"
                                                            disabled={isProtected || kavitaSaveBusy || kavitaRoleDraft.length === 0}
                                                            onClick={() => void saveManagedUserKavitaRoles(entry)}
                                                        >
                                                            {kavitaSaveBusy ? "Saving Kavita roles..." : "Save Kavita roles"}
                                                        </Button>
                                                    )}
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
                                activeSection={activeNavSection}
                                activeView={activeView}
                                canAccessEcosystem={canAccessEcosystem}
                                canManageUsers={canManageUsers}
                                onNavigate={navigateToSettings}
                            />
                        )}

                        <Column fillWidth gap="16" style={{flex: "1 1 40rem", minWidth: 0}}>
                            {activeSection === "ecosystem" && canAccessEcosystem && (
                                <>
                                    {catalogError && <Text onBackground="danger-strong"
                                                           variant="body-default-xs">{catalogError}</Text>}
                                    {globalError && <Text onBackground="danger-strong"
                                                          variant="body-default-xs">{globalError}</Text>}
                                    {globalMessage && <Text onBackground="neutral-weak"
                                                            variant="body-default-xs">{globalMessage}</Text>}

                                    {catalogLoading && (
                                        <Row fillWidth horizontal="center" paddingY="24">
                                            <Spinner/>
                                        </Row>
                                    )}

                                    {activeView === "overview" && renderOverviewSettings()}
                                    {activeView === "filesystem" && renderFilesystemSettings()}
                                    {activeView === "database" && renderDatabaseSettings()}
                                    {activeView === "downloader" && renderDownloaderSettings()}
                                    {activeView === "updater" && renderUpdaterSettings()}
                                    {activeView === "discord" && renderDiscordSettings()}
                                    {activeView === "kavita" && renderServiceConfig()}
                                    {activeView === "komf" && renderKomfSettings()}
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
