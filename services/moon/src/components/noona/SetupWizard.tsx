"use client";

import {type ChangeEvent, useEffect, useMemo, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, Spinner, Text} from "@once-ui-system/core";
import styles from "./SetupWizard.module.scss";

type EnvConfigField = {
    key: string;
    label?: string | null;
    defaultValue?: string | null;
    description?: string | null;
    warning?: string | null;
    required?: boolean;
    readOnly?: boolean;
};

type ServiceCatalogEntry = {
    name: string;
    category?: string | null;
    image?: string | null;
    port?: number | null;
    hostServiceUrl?: string | null;
    description?: string | null;
    health?: string | null;
    envConfig?: EnvConfigField[] | null;
    required?: boolean;
    installed?: boolean;
};

type CatalogResponse = {
    services?: ServiceCatalogEntry[];
    error?: string;
};

type InstallProgressItem = {
    name: string;
    label?: string | null;
    status: string;
    detail?: string | null;
    updatedAt?: string | null;
};

type InstallProgress = {
    items: InstallProgressItem[];
    percent: number | null;
    status: string;
};

type InstallRequestEntry = {
    name: string;
    env?: Record<string, string>;
};

type InstallResultEntry = {
    name: string;
    status: string;
    error?: string | null;
};

type InstallResponse = {
    results?: InstallResultEntry[];
    accepted?: boolean;
    started?: boolean;
    alreadyRunning?: boolean;
    progress?: InstallProgress | null;
    error?: string;
};

type ServiceLogEntry = {
    timestamp?: string | null;
    level?: string | null;
    stream?: string | null;
    message?: string | null;
    detail?: string | null;
};

type ServiceLogHistory = {
    service?: string | null;
    entries?: ServiceLogEntry[] | null;
    summary?: {
        status?: string | null;
        percent?: number | null;
        detail?: string | null;
        updatedAt?: string | null;
    } | null;
    error?: string;
};

type StorageLayoutFolder = {
    key: string;
    hostPath: string;
    containerPath?: string | null;
};

type StorageLayoutService = {
    service: string;
    folders: StorageLayoutFolder[];
};

type StorageLayoutResponse = {
    root?: string | null;
    services?: StorageLayoutService[];
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

type ManagedKavitaAccount = {
    username?: string | null;
    email?: string | null;
    password?: string | null;
};

type ManagedKavitaServiceKeyResponse = {
    apiKey?: string | null;
    baseUrl?: string | null;
    mode?: string | null;
    account?: ManagedKavitaAccount | null;
    services?: string[] | null;
    updatedServices?: Array<{
        name?: string | null;
        baseUrl?: string | null;
        apiKeyField?: string | null;
        restarted?: boolean | null;
    }> | null;
    error?: string;
};

type IntegrationMode = "managed" | "external";
type SetupTabId = "storage" | "integrations" | "services" | "install";

type WizardConfigPayloadV1 = {
    version: 1;
    selected: string[];
    values: Record<string, Record<string, string>>;
};

type WizardConfigPayloadV2 = {
    version: 2;
    selected: string[];
    values: Record<string, Record<string, string>>;
    storageRoot: string;
    integrations: {
        kavita: {
            mode: IntegrationMode;
            baseUrl: string;
            apiKey: string;
            sharedLibraryPath: string;
            containerName: string;
            account: {
                username: string;
                email: string;
                password: string;
            };
        };
        komf: {
            mode: IntegrationMode;
            baseUrl: string;
            containerName: string;
        };
    };
};

type WizardConfigImport = Partial<WizardConfigPayloadV1> | Partial<WizardConfigPayloadV2>;

type MissingRequiredField = {
    service: string;
    key: string;
};

type ProgressTone = "brand-alpha-medium" | "success-alpha-medium" | "danger-alpha-medium" | "neutral-alpha-medium";
type ServicePlanGroupId = "storage" | "library" | "external" | "platform" | "automation" | "other";
type ServicePlanGroupDefinition = {
    id: Exclude<ServicePlanGroupId, "other">;
    label: string;
    services: string[];
};
type ServicePlanGroup = {
    id: ServicePlanGroupId;
    label: string;
    services: string[];
    items: ServiceCatalogEntry[];
};

const ALWAYS_RUNNING = new Set(["noona-moon", "noona-sage"]);
const MANAGED_INTEGRATIONS = new Set(["noona-kavita", "noona-komf"]);
const DEFAULT_SELECTED = new Set(["noona-portal", "noona-raven"]);
const ADVANCED_KEYS = new Set(["DEBUG", "SERVICE_NAME", "VAULT_API_TOKEN", "VAULT_TOKEN_MAP"]);
const COMING_SOON_SERVICES = new Set(["noona-oracle"]);
const DERIVED_KEYS = new Set([
    "NOONA_DATA_ROOT",
    "KAVITA_BASE_URL",
    "KAVITA_API_KEY",
    "KAVITA_DATA_MOUNT",
    "KAVITA_LIBRARY_ROOT",
    "KAVITA_CONFIG_HOST_MOUNT_PATH",
    "KAVITA_LIBRARY_HOST_MOUNT_PATH",
    "KAVITA_ADMIN_USERNAME",
    "KAVITA_ADMIN_EMAIL",
    "KAVITA_ADMIN_PASSWORD",
    "KOMF_KAVITA_BASE_URI",
    "KOMF_KAVITA_API_KEY",
    "KOMF_CONFIG_HOST_MOUNT_PATH",
]);

const LOG_POLL_INTERVAL_MS = 1200;
const LOG_LIMIT = 140;
const PORTAL_REQUIRED_KEYS = Object.freeze([
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "KAVITA_BASE_URL",
    "KAVITA_API_KEY",
]);
const PORTAL_ROLE_ID_KEYS = new Set([
    "DISCORD_GUILD_ROLE_ID",
    "DISCORD_DEFAULT_ROLE_ID",
    "REQUIRED_ROLE_DING",
    "REQUIRED_ROLE_JOIN",
    "REQUIRED_ROLE_SCAN",
    "REQUIRED_ROLE_SEARCH",
]);
const INSTALL_PROGRESS_START_TIMEOUT_MS = 60_000;
const TERMINAL_INSTALL_STATUSES = new Set(["complete", "error"]);
const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;
const BG_DANGER_ALPHA_WEAK = "danger-alpha-weak" as const;
const BG_BRAND_ALPHA_WEAK = "brand-alpha-weak" as const;
const BG_SUCCESS_ALPHA_WEAK = "success-alpha-weak" as const;

const SETUP_TABS: Array<{ id: SetupTabId; label: string; description: string }> = [
    {id: "storage", label: "Storage", description: "Pick the Noona root folder and review shared mounts."},
    {id: "integrations", label: "Integrations", description: "Choose managed or external Kavita and Komf."},
    {id: "services", label: "Services", description: "Review install targets and edit service-specific settings."},
    {
        id: "install",
        label: "Install",
        description: "Import/export config, run the install, and continue to the setup summary."
    },
];

const SERVICE_LABELS: Record<string, string> = {
    "noona-moon": "Moon",
    "noona-oracle": "Oracle",
    "noona-portal": "Portal",
    "noona-raven": "Raven",
    "noona-sage": "Sage",
    "noona-vault": "Vault",
    "noona-redis": "Redis",
    "noona-mongo": "Mongo",
    "noona-kavita": "Kavita",
    "noona-komf": "Komf",
};

const SERVICE_NAME_ALIASES: Record<string, string> = {
    kavita: "noona-kavita",
    komf: "noona-komf",
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const normalizeServiceName = (value: unknown): string => {
    const normalized = normalizeString(value).trim();
    return SERVICE_NAME_ALIASES[normalized] || normalized;
};

const sanitizeEnvValue = (value: string): string =>
    value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

const isManagedKavitaApiKeyField = (
    serviceName: string,
    key: string,
    kavitaMode: IntegrationMode,
    komfMode: IntegrationMode,
): boolean => {
    if (kavitaMode !== "managed") {
        return false;
    }

    if ((serviceName === "noona-portal" || serviceName === "noona-raven") && key === "KAVITA_API_KEY") {
        return true;
    }

    return serviceName === "noona-komf" && komfMode === "managed" && key === "KOMF_KAVITA_API_KEY";
};

const isSetupFieldRequired = (
    serviceName: string,
    key: string,
    {
        kavitaMode,
        komfMode,
        descriptorRequired,
    }: {
        kavitaMode: IntegrationMode;
        komfMode: IntegrationMode;
        descriptorRequired: boolean;
    },
): boolean => {
    if (isManagedKavitaApiKeyField(serviceName, key, kavitaMode, komfMode)) {
        return false;
    }

    if (serviceName !== "noona-portal" || !PORTAL_REQUIRED_KEYS.includes(key)) {
        return descriptorRequired;
    }

    return true;
};

const cloneEnvState = (values: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(values).map(([serviceName, envMap]) => [serviceName, {...envMap}]));

const normalizeInstallStatus = (value: string | null | undefined): string =>
    (typeof value === "string" ? value : "").trim().toLowerCase();

const clampPercent = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const formatInstallStatusLabel = (value: string) => {
    const normalized = normalizeInstallStatus(value);
    if (!normalized) return "Unknown";
    if (normalized === "complete" || normalized === "completed") return "Complete";
    return normalized
        .split(/[\s_-]+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
};

const formatInstallDetail = (detail: string | null | undefined): string | null => {
    if (!detail) return null;
    let text = detail.trim();
    if (!text) return null;

    const hostMatch = text.match(/^host_service_url:\s*(.+)$/i);
    if (hostMatch) {
        const url = hostMatch[1]?.trim();
        text = url ? `URL: ${url}` : "URL ready";
    }

    text = text.replace(/^\[[^\n]*?]\s*/, "").trim();
    if (/\s\d+$/.test(text) && !/\d+\/\d+/.test(text)) {
        text = text.replace(/\s\d+$/, "").trim();
    }

    if (/^\d+(?:\/\d+)?$/.test(text)) {
        return null;
    }

    return text;
};

const isSecretKey = (key: string) => /TOKEN|API_KEY|PASSWORD/i.test(key) || key === "MONGO_URI";
const isUrlKey = (key: string) => /_URL$|_BASE_URL$/i.test(key);

const detectPathSeparator = (root: string) => (root.includes("\\") ? "\\" : "/");

const joinHostPath = (root: string, ...segments: string[]) => {
    const separator = detectPathSeparator(root);
    const normalizedRoot = root.replace(/[\\/]+$/, "");
    const safeSegments = segments.map((segment) => segment.replace(/[\\/]+/g, separator).replace(new RegExp(`^${separator}+|${separator}+$`, "g"), ""));
    return [normalizedRoot, ...safeSegments.filter(Boolean)].join(separator);
};

const normalizeVaultFolderName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "vault";
    if (trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) return "vault";
    const cleaned = trimmed.replace(/[:*?"<>|]/g, "").trim();
    return cleaned || "vault";
};

const buildInitialEnvState = (services: ServiceCatalogEntry[]) => {
    const state: Record<string, Record<string, string>> = {};

    for (const service of services) {
        const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];
        state[service.name] = Object.fromEntries(
            envConfig
                .filter((field) => field?.key)
                .map((field) => [field.key, normalizeString(field.defaultValue ?? "")]),
        );
    }

    return state;
};

const buildPersistedWizardEnvState = (
    services: ServiceCatalogEntry[],
    values: Record<string, Record<string, string>>,
) => {
    const state: Record<string, Record<string, string>> = {};

    for (const service of services) {
        const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];
        const persistedKeys = Array.from(new Set(
            envConfig
                .filter((field) =>
                    field?.key
                    && field.readOnly !== true
                    && !DERIVED_KEYS.has(field.key)
                    && field.key !== "NOONA_DATA_ROOT",
                )
                .map((field) => field.key),
        ));
        const current = values[service.name] ?? {};
        state[service.name] = Object.fromEntries(
            persistedKeys.map((key) => [key, normalizeString(current[key])]),
        );
    }

    return state;
};

function ProgressBar({
                         value,
                         tone = "brand-alpha-medium",
                         indeterminate = false,
                     }: {
    value: number | null;
    tone?: ProgressTone;
    indeterminate?: boolean;
}) {
    const normalizedValue = value == null ? null : clampPercent(value);

    return (
        <Row
            fillWidth
            background={BG_NEUTRAL_ALPHA_WEAK}
            className={styles.progressTrack}
            style={{height: 8, borderRadius: 999, overflow: "hidden"}}
        >
            {indeterminate || normalizedValue == null ? (
                <Row background={tone} className={styles.progressIndeterminate}/>
            ) : (
                <Row background={tone} style={{height: "100%", width: `${normalizedValue}%`}}/>
            )}
        </Row>
    );
}

const parseMongoUriParts = (uri: string): { username: string | null; host: string | null } => {
    const trimmed = uri.trim();
    if (!trimmed || !trimmed.toLowerCase().startsWith("mongodb://")) return {username: null, host: null};

    const rest = trimmed.slice("mongodb://".length);
    const beforePath = rest.split(/[/?]/)[0] ?? "";
    if (!beforePath) return {username: null, host: null};

    if (!beforePath.includes("@")) {
        return {username: null, host: beforePath};
    }

    const chunks = beforePath.split("@");
    const host = chunks[chunks.length - 1] ?? null;
    const authPart = chunks.slice(0, -1).join("@");
    const username = authPart.split(":")[0] ?? null;

    return {
        username: username?.trim() ? username.trim() : null,
        host: host?.trim() ? host.trim() : null,
    };
};

const deriveVaultMongoUri = (values: Record<string, Record<string, string>>): string | null => {
    const mongoEnv = values["noona-mongo"] ?? {};
    const mongoUser = normalizeString(mongoEnv.MONGO_INITDB_ROOT_USERNAME).trim();
    const mongoPass = normalizeString(mongoEnv.MONGO_INITDB_ROOT_PASSWORD).trim();
    if (!mongoUser || !mongoPass) return null;

    const vaultEnv = values["noona-vault"] ?? {};
    const currentUri = normalizeString(vaultEnv.MONGO_URI).trim();
    const parsed = parseMongoUriParts(currentUri);

    if (parsed.username && parsed.username !== mongoUser) {
        return null;
    }

    const host = parsed.host ?? "noona-mongo:27017";
    return `mongodb://${encodeURIComponent(mongoUser)}:${encodeURIComponent(mongoPass)}@${host}/admin?authSource=admin`;
};

const applyDerivedEnvState = (values: Record<string, Record<string, string>>) => {
    const nextUri = deriveVaultMongoUri(values);
    if (!nextUri) return values;

    const currentUri = values["noona-vault"]?.MONGO_URI ?? "";
    if (currentUri === nextUri) return values;

    return {
        ...values,
        "noona-vault": {
            ...(values["noona-vault"] ?? {}),
            MONGO_URI: nextUri,
        },
    };
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
                containerPath: "/var/log/noona"
            }]
        },
        {
            service: "noona-portal",
            label: "Portal",
            folders: [{
                key: "logs",
                label: "Logs",
                hostPath: joinHostPath(safeRoot, "portal", "logs"),
                containerPath: "/var/log/noona"
            }]
        },
        {
            service: "noona-raven",
            label: "Raven",
            folders: [
                {
                    key: "downloads",
                    label: "Downloads",
                    hostPath: joinHostPath(safeRoot, "raven", "downloads"),
                    containerPath: "/downloads"
                },
                {
                    key: "logs",
                    label: "Logs",
                    hostPath: joinHostPath(safeRoot, "raven", "logs"),
                    containerPath: "/app/logs"
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
                containerPath: "/var/log/noona"
            }]
        },
        {
            service: "noona-vault",
            label: "Vault",
            folders: [
                {
                    key: "logs",
                    label: "Logs",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "logs"),
                    containerPath: "/var/log/noona"
                },
                {
                    key: "mongo",
                    label: "Mongo data",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "mongo"),
                    containerPath: "/data/db"
                },
                {
                    key: "redis",
                    label: "Redis data",
                    hostPath: joinHostPath(safeRoot, vaultFolder, "redis"),
                    containerPath: "/data"
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
                    containerPath: "/kavita/config"
                },
                {
                    key: "manga",
                    label: "Library share",
                    hostPath: joinHostPath(safeRoot, "raven", "downloads"),
                    containerPath: "/manga"
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
                containerPath: "/config"
            }]
        },
    ];
};

const sortServices = (left: ServiceCatalogEntry, right: ServiceCatalogEntry) => {
    const leftIndex = INSTALL_ORDER_INDEX.get(left.name) ?? -1;
    const rightIndex = INSTALL_ORDER_INDEX.get(right.name) ?? -1;
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.name.localeCompare(right.name);
};

const INSTALL_ORDER = [
    "noona-mongo",
    "noona-redis",
    "noona-vault",
    "noona-kavita",
    "noona-raven",
    "noona-komf",
    "noona-portal",
    "noona-sage",
    "noona-moon",
    "noona-oracle",
] as const;
const INSTALL_ORDER_INDEX = new Map<string, number>(INSTALL_ORDER.map((name, idx) => [name, idx]));
const SERVICE_PLAN_GROUPS: ServicePlanGroupDefinition[] = [
    {
        id: "storage",
        label: "Storage",
        services: ["noona-mongo", "noona-redis", "noona-vault"],
    },
    {
        id: "library",
        label: "Library Management",
        services: ["noona-kavita", "noona-raven"],
    },
    {
        id: "external",
        label: "External APIs",
        services: ["noona-komf", "noona-portal"],
    },
    {
        id: "platform",
        label: "Platform",
        services: ["noona-sage", "noona-moon"],
    },
    {
        id: "automation",
        label: "Automation",
        services: ["noona-oracle"],
    },
] as const;
const SERVICE_PLAN_GROUP_BY_NAME = new Map<string, string>(
    SERVICE_PLAN_GROUPS.flatMap((group) => group.services.map((name) => [name, group.id] as const)),
);

const sortServiceNamesForInstall = (left: string, right: string) => {
    const leftIndex = INSTALL_ORDER_INDEX.get(left) ?? -1;
    const rightIndex = INSTALL_ORDER_INDEX.get(right) ?? -1;
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.localeCompare(right);
};

const buildDerivedValues = ({
                                values,
                                storageRoot,
                                servicesByName,
                                kavitaMode,
                                kavitaBaseUrl,
                                kavitaApiKey,
                                kavitaAdminUsername,
                                kavitaAdminEmail,
                                kavitaAdminPassword,
                                kavitaSharedLibraryPath,
                                komfMode,
                            }: {
    values: Record<string, Record<string, string>>;
    storageRoot: string;
    servicesByName: Map<string, ServiceCatalogEntry>;
    kavitaMode: IntegrationMode;
    kavitaBaseUrl: string;
    kavitaApiKey: string;
    kavitaAdminUsername: string;
    kavitaAdminEmail: string;
    kavitaAdminPassword: string;
    kavitaSharedLibraryPath: string;
    komfMode: IntegrationMode;
}) => {
    const next = cloneEnvState(values);
    const rootValue = storageRoot.trim();
    const resolvedKavitaBaseUrl = kavitaMode === "managed" ? "http://noona-kavita:5000" : kavitaBaseUrl.trim();

    const mergeEnv = (serviceName: string, patch: Record<string, string>) => {
        if (!servicesByName.has(serviceName)) return;
        next[serviceName] = {...(next[serviceName] ?? {}), ...patch};
    };

    if (rootValue) {
        for (const serviceName of ["noona-vault", "noona-raven", "noona-kavita", "noona-komf"]) {
            mergeEnv(serviceName, {NOONA_DATA_ROOT: rootValue});
        }
    }

    mergeEnv("noona-portal", {
        KAVITA_BASE_URL: resolvedKavitaBaseUrl,
        KAVITA_API_KEY: kavitaApiKey.trim(),
    });
    mergeEnv("noona-raven", {
        KAVITA_DATA_MOUNT: kavitaMode === "external" ? kavitaSharedLibraryPath.trim() : "",
        KAVITA_BASE_URL: resolvedKavitaBaseUrl,
        KAVITA_API_KEY: kavitaApiKey.trim(),
        KAVITA_LIBRARY_ROOT: kavitaMode === "managed" ? "/manga" : normalizeString(next["noona-raven"]?.KAVITA_LIBRARY_ROOT),
    });
    mergeEnv("noona-kavita", {
        KAVITA_ADMIN_USERNAME: kavitaMode === "managed" ? kavitaAdminUsername.trim() : "",
        KAVITA_ADMIN_EMAIL: kavitaMode === "managed" ? kavitaAdminEmail.trim() : "",
        KAVITA_ADMIN_PASSWORD: kavitaMode === "managed" ? kavitaAdminPassword.trim() : "",
    });
    mergeEnv("noona-komf", {
        KOMF_KAVITA_BASE_URI: resolvedKavitaBaseUrl,
        KOMF_KAVITA_API_KEY: komfMode === "managed" ? kavitaApiKey.trim() : normalizeString(next["noona-komf"]?.KOMF_KAVITA_API_KEY),
    });

    return applyDerivedEnvState(next);
};

const validateSelection = ({
                               selected,
                               values,
                               servicesByName,
                               storageRoot,
                               kavitaMode,
                               komfMode,
                               kavitaApiKey,
                               kavitaAccount,
                               kavitaAdminPasswordConfirm,
                               managedKavitaTargets,
                           }: {
    selected: Set<string>;
    values: Record<string, Record<string, string>>;
    servicesByName: Map<string, ServiceCatalogEntry>;
    storageRoot: string;
    kavitaMode: IntegrationMode;
    komfMode: IntegrationMode;
    kavitaApiKey: string;
    kavitaAccount: ManagedKavitaAccount;
    kavitaAdminPasswordConfirm: string;
    managedKavitaTargets: string[];
}): { ok: true } | { ok: false; message: string; missing: MissingRequiredField[] } => {
    const missing: MissingRequiredField[] = [];
    const unknownServices: string[] = [];

    if (!storageRoot.trim()) {
        missing.push({service: "storage", key: "NOONA_DATA_ROOT"});
    }

    if (selected.size === 0) {
        return {ok: false, message: "Select at least one service to install.", missing};
    }

    for (const serviceName of selected) {
        const service = servicesByName.get(serviceName);
        if (!service) {
            unknownServices.push(serviceName);
            continue;
        }

        const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];
        const current = values[serviceName] ?? {};
        for (const field of envConfig) {
            if (!field?.key || field.readOnly) continue;
            const required = isSetupFieldRequired(serviceName, field.key, {
                kavitaMode,
                komfMode,
                descriptorRequired: field.required === true,
            });
            if (!required) continue;
            if (!normalizeString(current[field.key]).trim()) {
                missing.push({service: serviceName, key: field.key});
            }
        }
    }

    if (
        kavitaMode === "managed"
        && managedKavitaTargets.length > 0
        && !normalizeString(kavitaApiKey).trim()
    ) {
        const username = normalizeString(kavitaAccount.username).trim();
        const email = normalizeString(kavitaAccount.email).trim();
        const password = normalizeString(kavitaAccount.password).trim();
        const confirmPassword = normalizeString(kavitaAdminPasswordConfirm).trim();

        if (!username) {
            missing.push({service: "noona-kavita", key: "KAVITA_ADMIN_USERNAME"});
        }
        if (!email) {
            missing.push({service: "noona-kavita", key: "KAVITA_ADMIN_EMAIL"});
        }
        if (!password) {
            missing.push({service: "noona-kavita", key: "KAVITA_ADMIN_PASSWORD"});
        }
        if (password && !confirmPassword) {
            missing.push({service: "noona-kavita", key: "KAVITA_ADMIN_PASSWORD_CONFIRM"});
        }
        if (password && confirmPassword && password !== confirmPassword) {
            return {
                ok: false,
                message: "Managed Kavita admin passwords do not match.",
                missing: [...missing, {service: "noona-kavita", key: "KAVITA_ADMIN_PASSWORD_CONFIRM"}],
            };
        }
    }

    if (unknownServices.length > 0) {
        return {
            ok: false,
            message: `Selection contains unknown services (${Array.from(new Set(unknownServices)).join(", ")}). Refresh the page and try again.`,
            missing
        };
    }

    if (missing.length > 0) {
        return {ok: false, message: "Fill all required settings before installing.", missing};
    }

    return {ok: true};
};

const buildInstallPayload = ({
                                 services,
                                 selected,
                                 values,
                             }: {
    services: ServiceCatalogEntry[];
    selected: Set<string>;
    values: Record<string, Record<string, string>>;
}) =>
    Array.from(selected)
        .filter((name) => !ALWAYS_RUNNING.has(name))
        .sort(sortServiceNamesForInstall)
        .map((name) => {
            const service = services.find((entry) => entry.name === name);
            const envConfig = Array.isArray(service?.envConfig) ? service.envConfig : [];
            const editableKeys = new Set(envConfig.filter((field) => field?.key && field.readOnly !== true).map((field) => field.key));
            const env = Object.fromEntries(
                Object.entries(values[name] ?? {})
                    .filter(([key, value]) => {
                        if (!normalizeString(value).trim()) return false;
                        return editableKeys.size === 0 || editableKeys.has(key) || DERIVED_KEYS.has(key) || key === "NOONA_DATA_ROOT";
                    })
                    .map(([key, value]) => [key, sanitizeEnvValue(normalizeString(value).trim())]),
            );

            return Object.keys(env).length > 0 ? {name, env} : {name};
        });

export function SetupWizard() {
    const router = useRouter();
    const [catalog, setCatalog] = useState<ServiceCatalogEntry[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED));
    const [values, setValues] = useState<Record<string, Record<string, string>>>(() => ({}));
    const [storageRoot, setStorageRoot] = useState("");
    const [defaultStorageRoot, setDefaultStorageRoot] = useState("");
    const [activeTab, setActiveTab] = useState<SetupTabId>("storage");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({
        "noona-portal": true,
        "noona-raven": true,
        "noona-kavita": true,
        "noona-komf": true
    });

    const [kavitaMode, setKavitaMode] = useState<IntegrationMode>("managed");
    const [kavitaBaseUrl, setKavitaBaseUrl] = useState("http://noona-kavita:5000");
    const [kavitaApiKey, setKavitaApiKey] = useState("");
    const [kavitaAdminUsername, setKavitaAdminUsername] = useState("");
    const [kavitaAdminEmail, setKavitaAdminEmail] = useState("");
    const [kavitaAdminPassword, setKavitaAdminPassword] = useState("");
    const [kavitaAdminPasswordConfirm, setKavitaAdminPasswordConfirm] = useState("");
    const [kavitaSharedLibraryPath, setKavitaSharedLibraryPath] = useState("");
    const [kavitaContainerName, setKavitaContainerName] = useState("");

    const [komfMode, setKomfMode] = useState<IntegrationMode>("managed");
    const [komfBaseUrl, setKomfBaseUrl] = useState("");
    const [komfContainerName, setKomfContainerName] = useState("");

    const [discordValidation, setDiscordValidation] = useState<DiscordSetupResponse | null>(null);
    const [discordValidationError, setDiscordValidationError] = useState<string | null>(null);

    const [logHistory, setLogHistory] = useState<ServiceLogHistory | null>(null);
    const [logError, setLogError] = useState<string | null>(null);
    const logPollRef = useRef<number | null>(null);
    const [discordValidating, setDiscordValidating] = useState(false);

    const [configMessage, setConfigMessage] = useState<string | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);
    const [installing, setInstalling] = useState(false);
    const [openingSummary, setOpeningSummary] = useState(false);
    const [installError, setInstallError] = useState<string | null>(null);
    const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
    const [installResult, setInstallResult] = useState<InstallResponse | null>(null);

    const pollRef = useRef<number | null>(null);
    const installRequestRef = useRef<AbortController | null>(null);
    const installProgressTimeoutRef = useRef<number | null>(null);
    const installTargetsRef = useRef<Set<string>>(new Set());
    const installProgressStartedRef = useRef(false);
    const summaryNavigationRef = useRef(false);
    const configInputRef = useRef<HTMLInputElement | null>(null);

    const services = catalog ?? [];
    const servicesByName = useMemo(() => new Map(services.map((entry) => [entry.name, entry])), [services]);
    const discordRoleOptions = useMemo(() => {
        const roles = Array.isArray(discordValidation?.roles) ? discordValidation.roles : [];
        return roles
            .map((entry) => ({
                id: normalizeString(entry?.id).trim(),
                name: normalizeString(entry?.name).trim(),
            }))
            .filter((entry) => entry.id);
    }, [discordValidation]);

    const effectiveSelected = useMemo(() => {
        const next = new Set<string>(selected);
        for (const name of ALWAYS_RUNNING) next.add(name);
        for (const service of services) {
            if (service.required) next.add(service.name);
        }
        if (kavitaMode === "managed") {
            next.add("noona-kavita");
            next.add("noona-raven");
        } else next.delete("noona-kavita");
        if (komfMode === "managed") next.add("noona-komf");
        else next.delete("noona-komf");
        return next;
    }, [selected, services, kavitaMode, komfMode]);

    const managedKavitaServiceTargets = useMemo(() => {
        if (kavitaMode !== "managed") return [];

        const targets: string[] = [];
        if (effectiveSelected.has("noona-portal")) targets.push("noona-portal");
        if (effectiveSelected.has("noona-raven")) targets.push("noona-raven");
        if (komfMode === "managed" && effectiveSelected.has("noona-komf")) targets.push("noona-komf");
        return targets;
    }, [effectiveSelected, kavitaMode, komfMode]);
    const kavitaAdminPasswordConfirmError = useMemo(() => {
        if (
            kavitaMode !== "managed"
            || managedKavitaServiceTargets.length === 0
            || normalizeString(kavitaApiKey).trim()
        ) {
            return undefined;
        }

        const password = normalizeString(kavitaAdminPassword).trim();
        const confirmPassword = normalizeString(kavitaAdminPasswordConfirm).trim();
        if (!password && !confirmPassword) {
            return undefined;
        }
        if (password && !confirmPassword) {
            return "Confirm the Kavita admin password.";
        }
        if (password && confirmPassword && password !== confirmPassword) {
            return "Passwords do not match.";
        }
        return undefined;
    }, [kavitaMode, managedKavitaServiceTargets, kavitaApiKey, kavitaAdminPassword, kavitaAdminPasswordConfirm]);

    const effectiveValues = useMemo(
        () => buildDerivedValues({
            values,
            storageRoot,
            servicesByName,
            kavitaMode,
            kavitaBaseUrl,
            kavitaApiKey,
            kavitaAdminUsername,
            kavitaAdminEmail,
            kavitaAdminPassword,
            kavitaSharedLibraryPath,
            komfMode,
        }),
        [
            values,
            storageRoot,
            servicesByName,
            kavitaMode,
            kavitaBaseUrl,
            kavitaApiKey,
            kavitaAdminUsername,
            kavitaAdminEmail,
            kavitaAdminPassword,
            kavitaSharedLibraryPath,
            komfMode,
        ],
    );

    const installResultErrors = useMemo(() => {
        if (!Array.isArray(installResult?.results)) return [];
        return installResult.results.filter((entry) => normalizeInstallStatus(entry?.status) === "error");
    }, [installResult]);
    const installReadyForSummary = useMemo(() => {
        if (installing) return false;

        const progressStatus = normalizeInstallStatus(installProgress?.status);
        if (progressStatus === "complete") {
            return true;
        }

        const logStatus = normalizeInstallStatus(logHistory?.summary?.status);
        return logStatus === "complete";
    }, [installing, installProgress, logHistory]);

    const missingRequiredFields = useMemo(() => {
        const result = validateSelection({
            selected: effectiveSelected,
            values: effectiveValues,
            servicesByName,
            storageRoot,
            kavitaMode,
            komfMode,
            kavitaApiKey,
            kavitaAccount: {
                username: kavitaAdminUsername,
                email: kavitaAdminEmail,
                password: kavitaAdminPassword,
            },
            kavitaAdminPasswordConfirm,
            managedKavitaTargets: managedKavitaServiceTargets,
        });
        return result.ok ? [] : result.missing;
    }, [
        effectiveSelected,
        effectiveValues,
        servicesByName,
        storageRoot,
        kavitaMode,
        komfMode,
        kavitaApiKey,
        kavitaAdminUsername,
        kavitaAdminEmail,
        kavitaAdminPassword,
        kavitaAdminPasswordConfirm,
        managedKavitaServiceTargets,
    ]);

    const vaultFolderName = useMemo(
        () => normalizeVaultFolderName(normalizeString(effectiveValues["noona-vault"]?.VAULT_DATA_FOLDER)),
        [effectiveValues],
    );

    const storagePreview = useMemo(() => {
        const root = storageRoot.trim() || defaultStorageRoot.trim();
        if (!root) return [];
        return getStoragePreview(root, vaultFolderName).filter((entry) => {
            if (entry.service === "noona-kavita") return kavitaMode === "managed";
            if (entry.service === "noona-komf") return komfMode === "managed";
            return true;
        });
    }, [storageRoot, defaultStorageRoot, vaultFolderName, kavitaMode, komfMode]);

    const sortedServices = useMemo(() => {
        const list = [...services];
        list.sort(sortServices);
        return list;
    }, [services]);
    const groupedServices = useMemo<ServicePlanGroup[]>(() => {
        const servicesByName = new Map(sortedServices.map((service) => [service.name, service]));
        const grouped: ServicePlanGroup[] = SERVICE_PLAN_GROUPS
            .map((group) => ({
                ...group,
                items: group.services
                    .map((name) => servicesByName.get(name))
                    .filter((service): service is ServiceCatalogEntry => Boolean(service)),
            }))
            .filter((group) => group.items.length > 0);

        const extras = sortedServices.filter((service) => !SERVICE_PLAN_GROUP_BY_NAME.has(service.name));
        if (extras.length > 0) {
            grouped.push({
                id: "other",
                label: "Other",
                services: [],
                items: extras,
            });
        }

        return grouped;
    }, [sortedServices]);

    const clearInstallProgressTimeout = () => {
        if (installProgressTimeoutRef.current != null) {
            window.clearTimeout(installProgressTimeoutRef.current);
            installProgressTimeoutRef.current = null;
        }
    };

    const resetInstallSession = () => {
        installTargetsRef.current = new Set();
        installProgressStartedRef.current = false;
        clearInstallProgressTimeout();
    };

    const abortInstallRequest = () => {
        if (installRequestRef.current) {
            installRequestRef.current.abort();
            installRequestRef.current = null;
        }
    };

    const stopPolling = () => {
        if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    const stopLogPolling = () => {
        if (logPollRef.current != null) {
            window.clearInterval(logPollRef.current);
            logPollRef.current = null;
        }
    };

    const pollLogs = async () => {
        try {
            const res = await fetch(`/api/noona/install/history?limit=${LOG_LIMIT}`, {cache: "no-store"});
            const payload = (await res.json().catch(() => ({}))) as ServiceLogHistory;

            if (!res.ok) {
                const message = normalizeString((payload as any)?.error).trim() || `Unable to load logs (HTTP ${res.status}).`;
                setLogError(message);
                return;
            }

            setLogError(null);
            setLogHistory(payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLogError(message);
        }
    };

    const pollProgress = async () => {
        try {
            const res = await fetch("/api/noona/install/progress", {cache: "no-store"});
            const payload = (await res.json().catch(() => null)) as InstallProgress | null;
            if (!payload || !Array.isArray(payload.items)) return;

            const activeTargets = installTargetsRef.current;
            const sessionActive = activeTargets.size > 0;
            const hasRelevantItems = payload.items.some((item) => activeTargets.has(item.name));
            const normalizedStatus = normalizeInstallStatus(payload.status);
            const isFinished = TERMINAL_INSTALL_STATUSES.has(normalizedStatus);

            if (sessionActive && !installProgressStartedRef.current) {
                if (!hasRelevantItems || isFinished) return;
                installProgressStartedRef.current = true;
                clearInstallProgressTimeout();
            }

            setInstallProgress(payload);

            if (sessionActive && installProgressStartedRef.current && isFinished) {
                stopPolling();
                resetInstallSession();
                setInstalling(false);

                if (normalizedStatus === "complete") {
                    setInstallError(null);
                    setInstallResult((prev) => prev ?? {results: []});
                    void openSetupSummary();
                } else {
                    setInstallError((prev) => prev ?? "Installation finished with errors. Check service statuses below.");
                }

                abortInstallRequest();
            }
        } catch {
            // Keep polling through transient failures.
        }
    };

    useEffect(() => {
        stopLogPolling();
        if (activeTab !== "install") {
            return () => {
                stopLogPolling();
            };
        }

        void pollLogs();
        logPollRef.current = window.setInterval(() => void pollLogs(), LOG_POLL_INTERVAL_MS);

        return () => {
            stopLogPolling();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setCatalogError(null);
            setCatalog(null);

            try {
                const [servicesRes, layoutRes] = await Promise.all([
                    fetch("/api/noona/services", {cache: "no-store"}),
                    fetch("/api/noona/setup/layout", {cache: "no-store"}),
                ]);

                const servicesJson = (await servicesRes.json().catch(() => null)) as CatalogResponse | null;
                const layoutJson = (await layoutRes.json().catch(() => null)) as StorageLayoutResponse | null;
                if (cancelled) return;

                if (!servicesRes.ok) {
                    setCatalogError(servicesJson?.error || `Failed to load services (HTTP ${servicesRes.status}).`);
                    return;
                }

                const list = Array.isArray(servicesJson?.services) ? servicesJson.services : [];
                const layoutRoot = normalizeString(layoutJson?.root).trim();
                setCatalog(list);
                setValues(applyDerivedEnvState(buildInitialEnvState(list)));
                if (layoutRoot) {
                    setDefaultStorageRoot(layoutRoot);
                    setStorageRoot((current) => current || layoutRoot);
                    setKavitaSharedLibraryPath((current) => current || joinHostPath(layoutRoot, "raven", "downloads"));
                }
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setCatalogError(message);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => () => {
        stopPolling();
        clearInstallProgressTimeout();
        abortInstallRequest();
        resetInstallSession();
    }, []);

    const toggleSelected = (name: string) => {
        const service = servicesByName.get(name);
        if (
            !service ||
            ALWAYS_RUNNING.has(name) ||
            service.required ||
            MANAGED_INTEGRATIONS.has(name) ||
            (name === "noona-raven" && kavitaMode === "managed")
        ) {
            return;
        }

        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const updateEnv = (serviceName: string, key: string, nextValue: string) => {
        if (serviceName === "noona-portal" && ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"].includes(key)) {
            setDiscordValidation(null);
            setDiscordValidationError(null);
        } else if (serviceName === "noona-portal" && key === "DISCORD_GUILD_ID") {
            setDiscordValidationError(null);
        }
        setValues((prev) =>
            applyDerivedEnvState({
                ...prev,
                [serviceName]: {
                    ...(prev[serviceName] ?? {}),
                    [key]: nextValue,
                },
            }),
        );
    };

    const applyDiscordSuggestedValues = (payload: DiscordSetupResponse | null, {overwrite = false} = {}) => {
        const suggestedClientId = normalizeString(payload?.suggested?.clientId).trim();
        const suggestedGuildId = normalizeString(payload?.suggested?.guildId).trim();
        const currentPortal = effectiveValues["noona-portal"] ?? {};

        if (!overwrite && (!suggestedClientId || normalizeString(currentPortal.DISCORD_CLIENT_ID).trim()) && (!suggestedGuildId || normalizeString(currentPortal.DISCORD_GUILD_ID).trim())) {
            return;
        }

        setValues((prev) => {
            const current = prev["noona-portal"] ?? {};
            const nextPortal = {...current};

            if (suggestedClientId && (overwrite || !normalizeString(current.DISCORD_CLIENT_ID).trim())) {
                nextPortal.DISCORD_CLIENT_ID = suggestedClientId;
            }

            if (suggestedGuildId && (overwrite || !normalizeString(current.DISCORD_GUILD_ID).trim())) {
                nextPortal.DISCORD_GUILD_ID = suggestedGuildId;
            }

            return applyDerivedEnvState({
                ...prev,
                "noona-portal": nextPortal,
            });
        });
    };

    const useDiscordGuild = (guildId: string) => {
        updateEnv("noona-portal", "DISCORD_GUILD_ID", guildId);
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
        const portalValues = effectiveValues["noona-portal"] ?? {};
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
            applyDiscordSuggestedValues(payload, {overwrite: false});
        } catch (error) {
            setDiscordValidation(null);
            setDiscordValidationError(error instanceof Error ? error.message : String(error));
        } finally {
            setDiscordValidating(false);
        }
    };

    const toggleServiceExpansion = (name: string) => {
        setExpandedServices((prev) => ({
            ...prev,
            [name]: !prev[name],
        }));
    };

    const downloadConfigFile = () => {
        setConfigMessage(null);
        setConfigError(null);

        if (!catalog) {
            setConfigError("Services have not loaded yet.");
            return;
        }

        try {
            const payload: WizardConfigPayloadV2 = {
                version: 2,
                selected: Array.from(effectiveSelected).sort((left, right) => left.localeCompare(right)),
                values: buildPersistedWizardEnvState(catalog, values),
                storageRoot,
                integrations: {
                    kavita: {
                        mode: kavitaMode,
                        baseUrl: kavitaBaseUrl,
                        apiKey: kavitaMode === "external" ? kavitaApiKey : "",
                        sharedLibraryPath: kavitaSharedLibraryPath,
                        containerName: kavitaContainerName,
                        account: {
                            username: kavitaAdminUsername,
                            email: kavitaAdminEmail,
                            password: kavitaAdminPassword,
                        },
                    },
                    komf: {
                        mode: komfMode,
                        baseUrl: komfBaseUrl,
                        containerName: komfContainerName,
                    },
                },
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const now = new Date().toISOString().replace(/[:.]/g, "-");
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `noona-setup-${now}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setConfigMessage("Downloaded setup JSON file.");
        } catch (error) {
            setConfigError(error instanceof Error ? error.message : String(error));
        }
    };

    const openConfigFilePicker = () => {
        setConfigMessage(null);
        setConfigError(null);
        configInputRef.current?.click();
    };

    const loadConfigFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
        setConfigMessage(null);
        setConfigError(null);

        if (!catalog) {
            setConfigError("Services have not loaded yet.");
            event.target.value = "";
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const parsed = JSON.parse(await file.text()) as WizardConfigImport;
            const version = Number(parsed.version);
            if (version !== 1 && version !== 2) {
                setConfigError("Unsupported setup JSON version.");
                return;
            }
            const parsedV2 = version === 2 ? (parsed as Partial<WizardConfigPayloadV2>) : null;

            const knownServiceNames = new Set(catalog.map((service) => service.name));
            const nextSelected = new Set<string>();
            if (Array.isArray(parsed.selected)) {
                for (const entry of parsed.selected) {
                    const normalized = normalizeServiceName(entry);
                    if (normalized && knownServiceNames.has(normalized)) {
                        nextSelected.add(normalized);
                    }
                }
            }

            const nextValues = cloneEnvState(buildInitialEnvState(catalog));
            if (parsed.values && typeof parsed.values === "object") {
                for (const [rawServiceName, envMap] of Object.entries(parsed.values)) {
                    const serviceName = normalizeServiceName(rawServiceName);
                    if (!knownServiceNames.has(serviceName) || !envMap || typeof envMap !== "object") continue;
                    const service = catalog.find((entry) => entry.name === serviceName);
                    const envConfig = Array.isArray(service?.envConfig) ? service.envConfig : [];
                    const persistedKeys = new Set(
                        envConfig
                            .filter((field) =>
                                field?.key
                                && field.readOnly !== true
                                && !DERIVED_KEYS.has(field.key)
                                && field.key !== "NOONA_DATA_ROOT",
                            )
                            .map((field) => field.key),
                    );
                    nextValues[serviceName] = {
                        ...(nextValues[serviceName] ?? {}),
                        ...Object.fromEntries(
                            Object.entries(envMap)
                                .filter(([key]) => persistedKeys.has(key))
                                .map(([key, value]) => [key, sanitizeEnvValue(normalizeString(value))]),
                        ),
                    };
                }
            }

            setSelected(nextSelected);
            setValues(applyDerivedEnvState(nextValues));

            if (version === 2) {
                const nextStorageRoot = normalizeString(parsedV2?.storageRoot).trim();
                if (nextStorageRoot) {
                    setStorageRoot(nextStorageRoot);
                }

                const kavita = parsedV2?.integrations?.kavita;
                if (kavita) {
                    const nextKavitaMode = kavita.mode === "external" ? "external" : "managed";
                    setKavitaMode(nextKavitaMode);
                    setKavitaBaseUrl(normalizeString(kavita.baseUrl) || "http://noona-kavita:5000");
                    setKavitaApiKey(nextKavitaMode === "external" ? normalizeString(kavita.apiKey) : "");
                    setKavitaAdminUsername(normalizeString(kavita.account?.username));
                    setKavitaAdminEmail(normalizeString(kavita.account?.email));
                    setKavitaAdminPassword(normalizeString(kavita.account?.password));
                    setKavitaAdminPasswordConfirm(normalizeString(kavita.account?.password));
                    setKavitaSharedLibraryPath(normalizeString(kavita.sharedLibraryPath));
                    setKavitaContainerName(normalizeString(kavita.containerName));
                }

                const komf = parsedV2?.integrations?.komf;
                if (komf) {
                    setKomfMode(komf.mode === "external" ? "external" : "managed");
                    setKomfBaseUrl(normalizeString(komf.baseUrl));
                    setKomfContainerName(normalizeString(komf.containerName));
                }
            } else {
                const importedPortal = nextValues["noona-portal"] ?? {};
                const importedRaven = nextValues["noona-raven"] ?? {};
                const nextKavitaMode = nextSelected.has("noona-kavita") ? "managed" : "external";
                setKavitaMode(nextKavitaMode);
                setKavitaBaseUrl(normalizeString(importedPortal.KAVITA_BASE_URL) || "http://noona-kavita:5000");
                setKavitaApiKey(nextKavitaMode === "external" ? normalizeString(importedPortal.KAVITA_API_KEY) : "");
                setKavitaAdminUsername("");
                setKavitaAdminEmail("");
                setKavitaAdminPassword("");
                setKavitaAdminPasswordConfirm("");
                setKavitaSharedLibraryPath(normalizeString(importedRaven.KAVITA_DATA_MOUNT));
                setKomfMode(nextSelected.has("noona-komf") ? "managed" : "external");
            }

            setConfigMessage(`Loaded setup JSON from ${file.name}.`);
        } catch (error) {
            setConfigError(error instanceof Error ? error.message : String(error));
        } finally {
            event.target.value = "";
        }
    };

    const persistDiscordAuthConfig = async () => {
        const portalValues = effectiveValues["noona-portal"] ?? {};
        const clientId = normalizeString(portalValues.DISCORD_CLIENT_ID).trim();
        const clientSecret = normalizeString(portalValues.DISCORD_CLIENT_SECRET).trim();
        if (!clientId || !clientSecret) {
            throw new Error("Discord client ID and client secret are required before continuing to the setup summary.");
        }

        let lastError: string | null = null;
        for (let attempt = 1; attempt <= 5; attempt += 1) {
            try {
                const response = await fetch("/api/noona/auth/discord/config", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({clientId, clientSecret}),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error(
                        normalizeString(payload?.error).trim()
                        || `Failed to save Discord OAuth config (HTTP ${response.status}).`,
                    );
                }
                return;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                if (attempt < 5) {
                    await new Promise((resolve) => window.setTimeout(resolve, attempt * 1000));
                }
            }
        }

        throw new Error(lastError || "Unable to save Discord OAuth config.");
    };

    const provisionManagedKavitaServiceKey = async () => {
        if (kavitaMode !== "managed" || managedKavitaServiceTargets.length === 0) {
            return;
        }

        const account = {
            username: normalizeString(kavitaAdminUsername).trim(),
            email: normalizeString(kavitaAdminEmail).trim(),
            password: normalizeString(kavitaAdminPassword).trim(),
        };
        const hasAccount = Boolean(account.username || account.email || account.password);
        const response = await fetch("/api/noona/setup/kavita/service-key", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                services: managedKavitaServiceTargets,
                ...(hasAccount ? {account} : {}),
            }),
        });
        const payload = (await response.json().catch(() => null)) as ManagedKavitaServiceKeyResponse | null;
        if (!response.ok) {
            throw new Error(
                normalizeString(payload?.error).trim()
                || `Managed Kavita key provisioning failed (HTTP ${response.status}).`,
            );
        }

        const nextApiKey = normalizeString(payload?.apiKey).trim();
        const nextBaseUrl = normalizeString(payload?.baseUrl).trim();

        if (nextBaseUrl) {
            setKavitaBaseUrl(nextBaseUrl);
        }
        if (nextApiKey) {
            setKavitaApiKey(nextApiKey);
        }

        const nextAccount = payload?.account;
        if (nextAccount) {
            const username = normalizeString(nextAccount.username).trim();
            const email = normalizeString(nextAccount.email).trim();
            if (username) {
                setKavitaAdminUsername(username);
            }
            if (email) {
                setKavitaAdminEmail(email);
            }
        }
    };

    const openSetupSummary = async () => {
        if (summaryNavigationRef.current) return;

        summaryNavigationRef.current = true;
        setOpeningSummary(true);
        try {
            await provisionManagedKavitaServiceKey();
            await persistDiscordAuthConfig();
            const selectedServices = Array.from(effectiveSelected).sort((left, right) => left.localeCompare(right));
            const nextUrl = `/setupwizard/summary?selected=${encodeURIComponent(selectedServices.join(","))}`;
            router.push(nextUrl);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setInstallError(detail);
            summaryNavigationRef.current = false;
            setOpeningSummary(false);
        }
    };

    const install = async () => {
        if (!catalog) return;

        const validation = validateSelection({
            selected: effectiveSelected,
            values: effectiveValues,
            servicesByName,
            storageRoot,
            kavitaMode,
            komfMode,
            kavitaApiKey,
            kavitaAccount: {
                username: kavitaAdminUsername,
                email: kavitaAdminEmail,
                password: kavitaAdminPassword,
            },
            kavitaAdminPasswordConfirm,
            managedKavitaTargets: managedKavitaServiceTargets,
        });
        if (!validation.ok) {
            setInstallError(validation.message);
            setActiveTab("install");
            return;
        }

        const payload = buildInstallPayload({services, selected: effectiveSelected, values: effectiveValues});
        const targetNames = new Set(payload.map((entry) => entry.name));

        setInstallError(null);
        setInstallResult(null);
        setInstallProgress(null);
        setInstalling(true);
        setOpeningSummary(false);
        summaryNavigationRef.current = false;
        installTargetsRef.current = targetNames;
        installProgressStartedRef.current = false;

        clearInstallProgressTimeout();
        installProgressTimeoutRef.current = window.setTimeout(() => {
            if (!installProgressStartedRef.current) {
                setInstallError("Warden did not report install progress yet. The request is still running.");
            }
        }, INSTALL_PROGRESS_START_TIMEOUT_MS);

        stopPolling();
        pollRef.current = window.setInterval(() => void pollProgress(), 1200);
        void pollProgress();

        const controller = new AbortController();
        installRequestRef.current = controller;

        try {
            const response = await fetch("/api/noona/install", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({services: payload}),
                signal: controller.signal,
            });

            const json = (await response.json().catch(() => ({}))) as InstallResponse;
            if (!response.ok) {
                const errorMessage =
                    typeof json?.error === "string" && json.error.trim()
                        ? json.error.trim()
                        : `Install failed (HTTP ${response.status}).`;
                if (installProgressStartedRef.current) {
                    setInstallError(`${errorMessage} Progress is already running; continuing to monitor install status.`);
                    return;
                }
                stopPolling();
                resetInstallSession();
                setInstalling(false);
                setInstallError(errorMessage);
                return;
            }

            const responseEntries = Array.isArray(json?.results) ? json.results : [];
            setInstallResult({...json, results: responseEntries});

            const responseProgress = json?.progress;
            if (responseProgress && Array.isArray(responseProgress.items)) {
                const hasRelevantItems = responseProgress.items.some((item) => targetNames.has(item.name));
                const normalizedStatus = normalizeInstallStatus(responseProgress.status);
                const isFinished = TERMINAL_INSTALL_STATUSES.has(normalizedStatus);
                if (hasRelevantItems && !isFinished) {
                    installProgressStartedRef.current = true;
                    clearInstallProgressTimeout();
                }
                setInstallProgress(responseProgress);
            }

            void pollProgress();
        } catch (error) {
            if (!controller.signal.aborted) {
                if (installProgressStartedRef.current) {
                    const message = error instanceof Error ? error.message : String(error);
                    setInstallError(`${message} Progress is already running; continuing to monitor install status.`);
                    return;
                }
                stopPolling();
                resetInstallSession();
                setInstalling(false);
                setInstallError(error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (installRequestRef.current === controller) {
                installRequestRef.current = null;
            }
            clearInstallProgressTimeout();
        }
    };

    const renderServiceCard = (serviceName: string) => {
        const service = servicesByName.get(serviceName);
        if (!service) return null;

        const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];
        const visibleFields = envConfig.filter((field) => {
            if (!field?.key) return false;
            if (
                kavitaMode === "managed"
                && (
                    ((serviceName === "noona-portal" || serviceName === "noona-raven") && field.key === "KAVITA_API_KEY")
                    || (serviceName === "noona-komf" && field.key === "KOMF_KAVITA_API_KEY")
                )
            ) {
                return false;
            }
            if (showAdvanced) return true;
            if (DERIVED_KEYS.has(field.key)) return false;
            return !ADVANCED_KEYS.has(field.key);
        });

        const isOpen = expandedServices[serviceName] === true;

        return (
            <Card key={serviceName} fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l"
                  radius="l">
                <Column gap="16">
                    <Row horizontal="between" vertical="center" gap="12">
                        <Column gap="4" style={{minWidth: 0}}>
                            <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                <Heading as="h3" variant="heading-strong-l">
                                    {SERVICE_LABELS[serviceName] || serviceName}
                                </Heading>
                                {COMING_SOON_SERVICES.has(serviceName) && (
                                    <Badge background={BG_NEUTRAL_ALPHA_WEAK} onBackground="neutral-strong">
                                        coming soon
                                    </Badge>
                                )}
                            </Row>
                            {service.description && (
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    {service.description}
                                </Text>
                            )}
                            {service.image && (
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Pulls: {service.image}
                                </Text>
                            )}
                        </Column>
                        <Button size="s" variant="secondary" onClick={() => toggleServiceExpansion(serviceName)}>
                            {isOpen ? "Hide fields" : "Show fields"}
                        </Button>
                    </Row>
                    {isOpen && (
                        <Column gap="16">
                            {serviceName === "noona-portal" && (
                                <Card fillWidth background={BG_NEUTRAL_ALPHA_WEAK} border="neutral-alpha-weak"
                                      padding="m" radius="m">
                                    <Column gap="12">
                                        <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                            <Column gap="4">
                                                <Text variant="label-default-s">Discord bot login test</Text>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Test the entered bot token, detect the application client ID, and
                                                    pick a guild without leaving setup.
                                                </Text>
                                            </Column>
                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                <Button size="s" variant="secondary"
                                                        onClick={() => void testDiscordConnection()}
                                                        disabled={discordValidating}>
                                                    {discordValidating ? "Testing..." : "Test bot login"}
                                                </Button>
                                                {discordValidation?.suggested && (
                                                    <Button size="s" variant="secondary"
                                                            onClick={() => applyDiscordSuggestedValues(discordValidation, {overwrite: true})}>
                                                        Use detected values
                                                    </Button>
                                                )}
                                            </Row>
                                        </Row>

                                        {discordValidationError && (
                                            <Text onBackground="danger-strong" variant="body-default-xs">
                                                {discordValidationError}
                                            </Text>
                                        )}

                                        {discordValidation?.botUser && (
                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                <Badge background={BG_SUCCESS_ALPHA_WEAK} onBackground="neutral-strong">
                                                    {normalizeString(discordValidation.botUser.tag).trim() || normalizeString(discordValidation.botUser.username).trim() || "Bot ready"}
                                                </Badge>
                                                {normalizeString(discordValidation.application?.id).trim() && (
                                                    <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                           onBackground="neutral-strong">
                                                        client: {discordValidation.application?.id}
                                                    </Badge>
                                                )}
                                                {discordValidation.application?.clientIdMatches === false && (
                                                    <Badge background={BG_DANGER_ALPHA_WEAK}
                                                           onBackground="neutral-strong">
                                                        client ID mismatch
                                                    </Badge>
                                                )}
                                            </Row>
                                        )}

                                        {Array.isArray(discordValidation?.guilds) && discordValidation.guilds.length > 0 && (
                                            <Column gap="8">
                                                <Text variant="label-default-s">Accessible guilds</Text>
                                                {discordValidation.guilds.map((guild) => {
                                                    const guildId = normalizeString(guild?.id).trim();
                                                    const currentGuildId = normalizeString(effectiveValues["noona-portal"]?.DISCORD_GUILD_ID).trim();
                                                    return (
                                                        <Row key={guildId || guild?.name || "guild"} fillWidth
                                                             horizontal="between" vertical="center" gap="12"
                                                             background={BG_SURFACE} padding="12" radius="m">
                                                            <Column gap="4" style={{minWidth: 0}}>
                                                                <Text
                                                                    variant="body-default-s">{normalizeString(guild?.name).trim() || guildId || "Unknown guild"}</Text>
                                                                {guildId && (
                                                                    <Text onBackground="neutral-weak"
                                                                          variant="body-default-xs">
                                                                        {guildId}
                                                                    </Text>
                                                                )}
                                                            </Column>
                                                            <Button size="s"
                                                                    variant={currentGuildId === guildId ? "primary" : "secondary"}
                                                                    onClick={() => useDiscordGuild(guildId)}
                                                                    disabled={!guildId}>
                                                                {currentGuildId === guildId ? "Selected" : "Use guild"}
                                                            </Button>
                                                        </Row>
                                                    );
                                                })}
                                            </Column>
                                        )}
                                    </Column>
                                </Card>
                            )}
                            {visibleFields.length === 0 ? (
                                <Text onBackground="neutral-weak">No additional fields to edit here.</Text>
                            ) : (
                                visibleFields.map((field) => {
                                    const key = field.key;
                                    const current = effectiveValues[serviceName]?.[key] ?? "";
                                    const required = isSetupFieldRequired(serviceName, key, {
                                        kavitaMode,
                                        komfMode,
                                        descriptorRequired: field.required === true,
                                    });
                                    const isMissing = required && !field.readOnly && !current.trim();
                                    const useRoleDropdown =
                                        serviceName === "noona-portal"
                                        && PORTAL_ROLE_ID_KEYS.has(key)
                                        && discordRoleOptions.length > 0;
                                    const normalizedCurrentRole = current.trim();
                                    const roleOptions =
                                        useRoleDropdown && normalizedCurrentRole && !discordRoleOptions.some((role) => role.id === normalizedCurrentRole)
                                            ? [{
                                                id: normalizedCurrentRole,
                                                name: `Current value (${normalizedCurrentRole})`
                                            }, ...discordRoleOptions]
                                            : discordRoleOptions;

                                    return (
                                        <Column key={key} gap="8">
                                            <Row gap="8" vertical="center">
                                                <Text variant="label-default-s">{field.label || key}</Text>
                                                {required && <Badge background={BG_BRAND_ALPHA_WEAK}
                                                                    onBackground="neutral-strong">required</Badge>}
                                                {field.readOnly && <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                                          onBackground="neutral-strong">read-only</Badge>}
                                            </Row>
                                            {useRoleDropdown ? (
                                                <Column gap="8">
                                                    <select
                                                        id={`${serviceName}:${key}`}
                                                        name={key}
                                                        aria-label={field.label || key}
                                                        className={styles.nativeSelect}
                                                        value={current}
                                                        disabled={field.readOnly === true}
                                                        onChange={(event) => updateEnv(serviceName, key, event.target.value)}
                                                    >
                                                        <option
                                                            value="">{isMissing ? "Select a required guild role" : "Select a guild role"}</option>
                                                        {roleOptions.map((role) => (
                                                            <option key={`${key}:${role.id}`} value={role.id}>
                                                                {role.name || role.id} ({role.id})
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <Text onBackground={isMissing ? "danger-strong" : "neutral-weak"}
                                                          variant="body-default-xs">
                                                        {isMissing
                                                            ? "Required value missing."
                                                            : "Loaded from the last successful bot login for the selected guild."}
                                                    </Text>
                                                </Column>
                                            ) : (
                                                <Input
                                                    id={`${serviceName}:${key}`}
                                                    name={key}
                                                    type={isSecretKey(key) ? "password" : isUrlKey(key) ? "url" : "text"}
                                                    value={current}
                                                    disabled={field.readOnly === true}
                                                    errorMessage={isMissing ? "Required value missing." : undefined}
                                                    onChange={(event) => updateEnv(serviceName, key, event.target.value)}
                                                />
                                            )}
                                            {(field.description || field.warning) && (
                                                <Column gap="4">
                                                    {field.description && <Text onBackground="neutral-weak"
                                                                                variant="body-default-xs">{field.description}</Text>}
                                                    {field.warning && <Text onBackground="danger-strong"
                                                                            variant="body-default-xs">{field.warning}</Text>}
                                                </Column>
                                            )}
                                            {!useRoleDropdown && serviceName === "noona-portal" && PORTAL_ROLE_ID_KEYS.has(key) && (
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    Run `Test bot login` after selecting a guild to load a role dropdown
                                                    for this field.
                                                </Text>
                                            )}
                                        </Column>
                                    );
                                })
                            )}
                        </Column>
                    )}
                </Column>
            </Card>
        );
    };

    const logEntries = Array.isArray(logHistory?.entries) ? logHistory.entries : [];

    return (
        <Column maxWidth="xl" gap="24" paddingY="12" horizontal="center">
            <Column gap="8" horizontal="center" align="center">
                <Heading variant="display-strong-s" wrap="balance">Noona Setup Wizard</Heading>
                <Text onBackground="neutral-weak" wrap="balance">
                    Build the Noona stack around one storage root, choose managed or external integrations, then hand
                    the install plan to Warden.
                </Text>
            </Column>

            <Column fillWidth gap="24">
                <Column gap="24" fillWidth>
                    {catalogError && (
                        <Card fillWidth background={BG_SURFACE} border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Row gap="8" vertical="center">
                                    <Badge background={BG_DANGER_ALPHA_WEAK} onBackground="neutral-strong">Backend
                                        unavailable</Badge>
                                    <Text onBackground="neutral-weak">Moon could not reach Warden or Sage.</Text>
                                </Row>
                                <Text>{catalogError}</Text>
                            </Column>
                        </Card>
                    )}

                    {!catalog && !catalogError && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {catalog && (
                        <>
                    <Row fillWidth gap="8" style={{flexWrap: "wrap"}}>
                        <Badge background={BG_BRAND_ALPHA_WEAK}
                               onBackground="neutral-strong">{Array.from(effectiveSelected).length} services</Badge>
                        <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                               onBackground="neutral-strong">Storage: {storageRoot || defaultStorageRoot || "not set"}</Badge>
                        <Badge background={BG_SUCCESS_ALPHA_WEAK}
                               onBackground="neutral-strong">Kavita: {kavitaMode}</Badge>
                        <Badge background={BG_SUCCESS_ALPHA_WEAK} onBackground="neutral-strong">Komf: {komfMode}</Badge>
                    </Row>

                    <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                        <Column gap="16">
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {SETUP_TABS.map((tab) => (
                                    <Button key={tab.id} size="s"
                                            variant={activeTab === tab.id ? "primary" : "secondary"}
                                            onClick={() => setActiveTab(tab.id)}>
                                        {tab.label}
                                    </Button>
                                ))}
                            </Row>
                            <Column gap="4">
                                <Heading as="h2"
                                         variant="heading-strong-l">{SETUP_TABS.find((entry) => entry.id === activeTab)?.label}</Heading>
                                <Text onBackground="neutral-weak"
                                      variant="body-default-xs">{SETUP_TABS.find((entry) => entry.id === activeTab)?.description}</Text>
                            </Column>
                        </Column>
                    </Card>

                    {activeTab === "storage" && (
                        <Column fillWidth gap="16">
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="16">
                                    <Heading as="h2" variant="heading-strong-l">Noona data root</Heading>
                                    <Input
                                        id="noona-storage-root"
                                        name="noona-storage-root"
                                        type="text"
                                        value={storageRoot}
                                        placeholder={defaultStorageRoot || "/mnt/user/noona or %APPDATA%\\noona"}
                                        errorMessage={!storageRoot.trim() ? "Choose a host folder for the Noona stack." : undefined}
                                        onChange={(event) => setStorageRoot(event.target.value)}
                                    />
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Warden now uses a single root for the stack. On Windows the default is
                                        `%APPDATA%\\noona`; on non-Windows hosts the default is `/mnt/user/noona`.
                                    </Text>
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="16">
                                    <Heading as="h2" variant="heading-strong-l">Folder layout preview</Heading>
                                    <Column gap="12">
                                        {storagePreview.map((entry) => (
                                            <Column key={entry.service} gap="8">
                                                <Row gap="8" vertical="center">
                                                    <Badge background={BG_BRAND_ALPHA_WEAK}
                                                           onBackground="neutral-strong">{entry.label}</Badge>
                                                    <Text onBackground="neutral-weak"
                                                          variant="body-default-xs">{entry.service}</Text>
                                                </Row>
                                                {entry.folders.map((folder) => (
                                                    <Row
                                                        key={`${entry.service}:${folder.key}`}
                                                        fillWidth
                                                        horizontal="between"
                                                        vertical="center"
                                                        gap="12"
                                                        background={BG_NEUTRAL_ALPHA_WEAK}
                                                        padding="12"
                                                        radius="m"
                                                    >
                                                        <Column gap="4" style={{minWidth: 0}}>
                                                            <Text variant="label-default-s">{folder.label}</Text>
                                                            <Text onBackground="neutral-weak" variant="body-default-xs"
                                                                  wrap="balance">{folder.hostPath}</Text>
                                                        </Column>
                                                        {folder.containerPath && (
                                                            <Badge background={BG_SUCCESS_ALPHA_WEAK}
                                                                   onBackground="neutral-strong">{folder.containerPath}</Badge>
                                                        )}
                                                    </Row>
                                                ))}
                                            </Column>
                                        ))}
                                    </Column>
                                </Column>
                            </Card>
                        </Column>
                    )}

                    {activeTab === "integrations" && (
                        <Column fillWidth gap="16">
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="16">
                                    <Row horizontal="between" vertical="center" gap="12">
                                        <Heading as="h2" variant="heading-strong-l">Kavita</Heading>
                                        <Row gap="8">
                                            <Button size="s"
                                                    variant={kavitaMode === "managed" ? "primary" : "secondary"}
                                                    onClick={() => setKavitaMode("managed")}>Install with Noona</Button>
                                            <Button size="s"
                                                    variant={kavitaMode === "external" ? "primary" : "secondary"}
                                                    onClick={() => setKavitaMode("external")}>I have my own</Button>
                                        </Row>
                                    </Row>
                                    {kavitaMode === "managed" ? (
                                        <Column gap="12">
                                            <Text onBackground="neutral-weak" variant="body-default-xs">Warden will
                                                install `captainpax/noona-kavita:latest`, mount a config folder under
                                                the Noona root, share Raven downloads into `/manga`, and pass the
                                                initial admin credentials into the managed container on first
                                                boot.</Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                Noona will then create or reuse a managed Kavita auth key after install
                                                and wire it into Portal, Raven, and Komf automatically.
                                            </Text>
                                            <Column gap="8">
                                                <Text onBackground="neutral-strong" variant="label-default-s">
                                                    First admin account
                                                </Text>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                                    These credentials are passed to the managed `noona-kavita`
                                                    container so it can create the first Kavita admin account, and Noona
                                                    also reuses them to provision the managed API key.
                                                </Text>
                                                <Input
                                                    id="managed-kavita-admin-username"
                                                    name="managed-kavita-admin-username"
                                                    type="text"
                                                    value={kavitaAdminUsername}
                                                    placeholder="Kavita admin username"
                                                    onChange={(event) => setKavitaAdminUsername(event.target.value)}
                                                />
                                                <Input
                                                    id="managed-kavita-admin-email"
                                                    name="managed-kavita-admin-email"
                                                    type="email"
                                                    value={kavitaAdminEmail}
                                                    placeholder="admin@example.com"
                                                    onChange={(event) => setKavitaAdminEmail(event.target.value)}
                                                />
                                                <Input
                                                    id="managed-kavita-admin-password"
                                                    name="managed-kavita-admin-password"
                                                    type="password"
                                                    value={kavitaAdminPassword}
                                                    placeholder="Kavita admin password"
                                                    onChange={(event) => setKavitaAdminPassword(event.target.value)}
                                                />
                                                <Input
                                                    id="managed-kavita-admin-password-confirm"
                                                    name="managed-kavita-admin-password-confirm"
                                                    type="password"
                                                    value={kavitaAdminPasswordConfirm}
                                                    placeholder="Confirm Kavita admin password"
                                                    errorMessage={kavitaAdminPasswordConfirmError}
                                                    onChange={(event) => setKavitaAdminPasswordConfirm(event.target.value)}
                                                />
                                            </Column>
                                            {normalizeString(kavitaApiKey).trim() && (
                                                <Badge background={BG_SUCCESS_ALPHA_WEAK} onBackground="neutral-strong">
                                                    Managed Kavita API key ready
                                                </Badge>
                                            )}
                                        </Column>
                                    ) : (
                                        <Column gap="12">
                                            <Input id="external-kavita-base-url" name="external-kavita-base-url"
                                                   type="url" value={kavitaBaseUrl}
                                                   placeholder="https://your-kavita.example"
                                                   onChange={(event) => setKavitaBaseUrl(event.target.value)}/>
                                            <Input id="external-kavita-api-key" name="external-kavita-api-key"
                                                   type="password" value={kavitaApiKey} placeholder="Kavita API key"
                                                   onChange={(event) => setKavitaApiKey(event.target.value)}/>
                                            <Input id="external-kavita-library-path" name="external-kavita-library-path"
                                                   type="text" value={kavitaSharedLibraryPath}
                                                   placeholder={joinHostPath(storageRoot || defaultStorageRoot || "/mnt/user/noona", "raven", "downloads")}
                                                   onChange={(event) => setKavitaSharedLibraryPath(event.target.value)}/>
                                            <Input id="external-kavita-container" name="external-kavita-container"
                                                   type="text" value={kavitaContainerName} placeholder="noona-kavita"
                                                   onChange={(event) => setKavitaContainerName(event.target.value)}/>
                                        </Column>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="16">
                                    <Row horizontal="between" vertical="center" gap="12">
                                        <Heading as="h2" variant="heading-strong-l">Komf</Heading>
                                        <Row gap="8">
                                            <Button size="s" variant={komfMode === "managed" ? "primary" : "secondary"}
                                                    onClick={() => setKomfMode("managed")}>Install with Noona</Button>
                                            <Button size="s" variant={komfMode === "external" ? "primary" : "secondary"}
                                                    onClick={() => setKomfMode("external")}>I have my own</Button>
                                        </Row>
                                    </Row>
                                    {komfMode === "managed" ? (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">Warden will install
                                            `sndxr/komf:latest`, mount a config folder under the Noona root, and point
                                            Komf at the Kavita mode you selected above.</Text>
                                    ) : (
                                        <Column gap="12">
                                            <Input id="external-komf-base-url" name="external-komf-base-url" type="url"
                                                   value={komfBaseUrl} placeholder="https://your-komf.example"
                                                   onChange={(event) => setKomfBaseUrl(event.target.value)}/>
                                            <Input id="external-komf-container" name="external-komf-container"
                                                   type="text" value={komfContainerName} placeholder="noona-komf"
                                                   onChange={(event) => setKomfContainerName(event.target.value)}/>
                                        </Column>
                                    )}
                                </Column>
                            </Card>
                        </Column>
                    )}

                    {activeTab === "services" && (
                        <Row fillWidth gap="24" s={{direction: "column"}}>
                            <Column flex={1} gap="16">
                                <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l"
                                      radius="l">
                                    <Column gap="16">
                                        <Row horizontal="between" vertical="center" gap="12">
                                            <Heading as="h2" variant="heading-strong-l">Service plan</Heading>
                                            <Button size="s" variant="secondary"
                                                    onClick={() => setShowAdvanced((prev) => !prev)}>{showAdvanced ? "Hide advanced" : "Show advanced"}</Button>
                                        </Row>
                                        <Column gap="16">
                                            {groupedServices.map((group) => (
                                                <Column key={group.id} gap="8">
                                                    <Text variant="label-default-s" onBackground="neutral-weak"
                                                          style={{letterSpacing: "0.08em", textTransform: "uppercase"}}>
                                                        {group.label}
                                                    </Text>
                                                    <Column gap="8">
                                                        {group.items.map((service) => {
                                                            const name = service.name;
                                                            const ravenLocked = name === "noona-raven" && kavitaMode === "managed";
                                                            const disabled =
                                                                ALWAYS_RUNNING.has(name) ||
                                                                service.required === true ||
                                                                MANAGED_INTEGRATIONS.has(name) ||
                                                                ravenLocked;
                                                            return (
                                                                <Row key={name} fillWidth horizontal="between"
                                                                     vertical="center" gap="12" paddingY="8">
                                                                    <Column gap="4" style={{minWidth: 0}}>
                                                                        <Row gap="8" vertical="center">
                                                                            <Text
                                                                                variant="heading-default-s">{SERVICE_LABELS[name] || name}</Text>
                                                                            {service.required &&
                                                                                <Badge background={BG_BRAND_ALPHA_WEAK}
                                                                                       onBackground="neutral-strong">required</Badge>}
                                                                            {service.installed &&
                                                                                <Badge
                                                                                    background={BG_SUCCESS_ALPHA_WEAK}
                                                                                    onBackground="neutral-strong">installed</Badge>}
                                                                            {COMING_SOON_SERVICES.has(name) &&
                                                                                <Badge
                                                                                    background={BG_NEUTRAL_ALPHA_WEAK}
                                                                                    onBackground="neutral-strong">coming
                                                                                    soon</Badge>}
                                                                            {MANAGED_INTEGRATIONS.has(name) &&
                                                                                <Badge
                                                                                    background={BG_NEUTRAL_ALPHA_WEAK}
                                                                                    onBackground="neutral-strong">{name === "noona-kavita" ? kavitaMode : komfMode}</Badge>}
                                                                            {ravenLocked && <Badge
                                                                                background={BG_BRAND_ALPHA_WEAK}
                                                                                onBackground="neutral-strong">required
                                                                                by Kavita</Badge>}
                                                                        </Row>
                                                                        {service.description && <Text
                                                                            onBackground="neutral-weak"
                                                                            variant="body-default-xs"
                                                                            wrap="balance">{service.description}</Text>}
                                                                    </Column>
                                                                    <input type="checkbox"
                                                                           checked={effectiveSelected.has(name)}
                                                                           disabled={disabled}
                                                                           onChange={() => toggleSelected(name)}
                                                                           aria-label={`Select ${name}`}/>
                                                                </Row>
                                                            );
                                                        })}
                                                    </Column>
                                                </Column>
                                            ))}
                                        </Column>
                                    </Column>
                                </Card>
                            </Column>

                            <Column flex={2} gap="16">
                                {Array.from(effectiveSelected)
                                    .sort((left, right) => sortServices(servicesByName.get(left) ?? {name: left}, servicesByName.get(right) ?? {name: right}))
                                    .map((name) => renderServiceCard(name))}
                            </Column>
                        </Row>
                    )}

                    {activeTab === "install" && (
                        <Column fillWidth gap="16">
                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="16">
                                    <Heading as="h2" variant="heading-strong-l">Install plan</Heading>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button size="s" variant="secondary" onClick={() => downloadConfigFile()}>Download
                                            JSON</Button>
                                        <Button size="s" variant="secondary" onClick={() => openConfigFilePicker()}>Upload
                                            JSON</Button>
                                        <input ref={configInputRef} type="file" accept="application/json,.json"
                                               onChange={(event) => void loadConfigFromFile(event)}
                                               style={{display: "none"}} aria-label="Upload setup JSON file"/>
                                    </Row>
                                    {configMessage &&
                                        <Text onBackground="neutral-weak"
                                              variant="body-default-xs">{configMessage}</Text>}
                                    {configError &&
                                        <Text onBackground="danger-strong"
                                              variant="body-default-xs">{configError}</Text>}
                                    {missingRequiredFields.length > 0 && (
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {missingRequiredFields.map((entry) => (
                                                <Badge key={`${entry.service}:${entry.key}`}
                                                       background={BG_DANGER_ALPHA_WEAK} onBackground="neutral-strong">
                                                    {entry.service}:{entry.key}
                                                </Badge>
                                            ))}
                                        </Row>
                                    )}
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button size="m" variant="primary" disabled={installing || openingSummary}
                                                onClick={() => void install()}>
                                            {installing ? "Installing..." : "Install selected services"}
                                        </Button>
                                        {installReadyForSummary && (
                                            <Button
                                                size="m"
                                                variant="secondary"
                                                disabled={openingSummary}
                                                onClick={() => void openSetupSummary()}
                                            >
                                                {openingSummary ? "Opening summary..." : "Continue to summary"}
                                            </Button>
                                        )}
                                    </Row>
                                    {installReadyForSummary && !openingSummary && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Install completed. Continue to the summary page when you are ready.
                                        </Text>
                                    )}
                                    {openingSummary && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Saving managed service access and preparing the setup summary.
                                        </Text>
                                    )}
                                    {installError && <Text onBackground="danger-strong">{installError}</Text>}
                                    {installProgress && (
                                        <Column gap="8">
                                            <Row horizontal="between" vertical="center">
                                                <Text
                                                    onBackground="neutral-weak">Status: {formatInstallStatusLabel(installProgress.status)}</Text>
                                                <Text
                                                    onBackground="neutral-weak">{installProgress.percent != null ? `${installProgress.percent}%` : ""}</Text>
                                            </Row>
                                            <ProgressBar value={installProgress.percent ?? 0}
                                                         indeterminate={installProgress.percent == null && installProgress.status !== "idle"}
                                                         tone="brand-alpha-medium"/>
                                            <Line background={BG_NEUTRAL_ALPHA_WEAK}/>
                                            <Column gap="8">
                                                {installProgress.items.map((item) => {
                                                    const normalized = normalizeInstallStatus(item.status);
                                                    const progressValue = normalized === "installed" || normalized === "error" ? 100 : normalized === "pending" ? 0 : null;
                                                    const tone: ProgressTone = normalized === "installed" ? "success-alpha-medium" : normalized === "error" ? "danger-alpha-medium" : normalized === "pending" ? "neutral-alpha-medium" : "brand-alpha-medium";
                                                    return (
                                                        <Column key={item.name} gap="8">
                                                            <Row horizontal="between" gap="12" vertical="center">
                                                                <Text>{item.label ?? item.name}</Text>
                                                                <Text
                                                                    onBackground="neutral-weak">{formatInstallStatusLabel(item.status)}</Text>
                                                            </Row>
                                                            <ProgressBar value={progressValue}
                                                                         indeterminate={progressValue == null}
                                                                         tone={tone}/>
                                                            {formatInstallDetail(item.detail) &&
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">{formatInstallDetail(item.detail)}</Text>}
                                                        </Column>
                                                    );
                                                })}
                                            </Column>
                                        </Column>
                                    )}
                                </Column>
                            </Card>

                            <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                                <Column gap="12" fillWidth>
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4">
                                            <Heading as="h2" variant="heading-strong-m">Install logs</Heading>
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                Live installation history for the current Warden session.
                                            </Text>
                                        </Column>
                                        <Badge background={BG_BRAND_ALPHA_WEAK} onBackground="neutral-strong">
                                            Install session
                                        </Badge>
                                    </Row>
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            {normalizeString(logHistory?.summary?.status).trim()
                                                ? `Status: ${formatInstallStatusLabel(normalizeString(logHistory?.summary?.status).trim())}`
                                                : installProgress?.status
                                                    ? `Status: ${formatInstallStatusLabel(installProgress.status)}`
                                                    : "Status: idle"}
                                        </Text>
                                        <Button
                                            size="s"
                                            variant="secondary"
                                            onClick={() => void pollLogs()}
                                        >
                                            Refresh
                                        </Button>
                                    </Row>
                                    {logError &&
                                        <Text onBackground="danger-strong" variant="body-default-xs">{logError}</Text>}
                                    <Column className={styles.logViewport} padding="12" gap="8" fillWidth>
                                        {logEntries.length === 0 ? (
                                            <Text onBackground="neutral-weak" variant="body-default-xs">Waiting for
                                                Warden output.</Text>
                                        ) : (
                                            logEntries.map((entry, idx) => {
                                                const ts = normalizeString(entry?.timestamp).trim();
                                                const message = normalizeString(entry?.message).trim();
                                                const detail = normalizeString(entry?.detail).trim();
                                                const line = [ts, message, detail].filter(Boolean).join(" ");
                                                return (
                                                    <Text
                                                        key={`${ts || "log"}:${idx}`}
                                                        variant="body-default-xs"
                                                        onBackground="neutral-weak"
                                                        className={styles.logLine}
                                                    >
                                                        {line || "(empty log line)"}
                                                    </Text>
                                                );
                                            })
                                        )}
                                    </Column>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        {logHistory?.summary?.updatedAt ? `Updated: ${logHistory.summary.updatedAt}` : "Updated: waiting for first entry"}
                                    </Text>
                                </Column>
                            </Card>
                        </Column>
                    )}
                        </>
                    )}
                </Column>

            </Column>
        </Column>
    );
}
