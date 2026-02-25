"use client";

import {type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState} from "react";
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

type WizardConfigPayloadV1 = {
    version: 1;
    selected: string[];
    values: Record<string, Record<string, string>>;
};

const ALWAYS_RUNNING = new Set(["noona-moon", "noona-sage"]);
const DEFAULT_SELECTED = new Set(["noona-portal", "noona-raven", ...ALWAYS_RUNNING]);
const ADVANCED_KEYS = new Set(["DEBUG", "SERVICE_NAME", "VAULT_API_TOKEN", "VAULT_TOKEN_MAP"]);

const isSecretKey = (key: string) => /TOKEN|API_KEY|PASSWORD/i.test(key) || key === "MONGO_URI";
const isUrlKey = (key: string) => /_URL$|_BASE_URL$/i.test(key);

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const sanitizeEnvValue = (value: string): string =>
    value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

const parseMongoUriParts = (uri: string): { username: string | null; host: string | null } => {
    const trimmed = uri.trim();
    if (!trimmed) return {username: null, host: null};
    if (!trimmed.toLowerCase().startsWith("mongodb://")) return {username: null, host: null};

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
    const userEnc = encodeURIComponent(mongoUser);
    const passEnc = encodeURIComponent(mongoPass);
    return `mongodb://${userEnc}:${passEnc}@${host}/admin?authSource=admin`;
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

const buildInitialEnvState = (services: ServiceCatalogEntry[]) => {
    const state: Record<string, Record<string, string>> = {};

    for (const service of services) {
        const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];
        const env: Record<string, string> = {};
        for (const field of envConfig) {
            if (!field?.key) continue;
            env[field.key] = normalizeString(field.defaultValue ?? "");
        }
        state[service.name] = env;
    }

    return state;
};

type ProgressTone = "brand-alpha-medium" | "success-alpha-medium" | "danger-alpha-medium" | "neutral-alpha-medium";

const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;
const BG_DANGER_ALPHA_WEAK = "danger-alpha-weak" as const;
const BG_BRAND_ALPHA_WEAK = "brand-alpha-weak" as const;
const BG_SUCCESS_ALPHA_WEAK = "success-alpha-weak" as const;

const clampPercent = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const formatInstallStatusLabel = (value: string) => {
    const normalized = value.trim().toLowerCase();

    if (normalized === "idle") return "Idle";
    if (normalized === "complete" || normalized === "completed") return "Complete";
    if (normalized === "pending") return "Pending";
    if (normalized === "downloading") return "Downloading";
    if (normalized === "installing") return "Installing";
    if (normalized === "installed") return "Installed";
    if (normalized === "error") return "Error";

    if (!normalized) return "Unknown";
    return normalized;
};

const formatInstallDetail = (detail: string | null | undefined): string | null => {
    if (!detail) return null;
    let text = detail.trim();
    if (!text) return null;

    // Normalize legacy "host_service_url:" readouts.
    const hostMatch = text.match(/^host_service_url:\s*(.+)$/i);
    if (hostMatch) {
        const url = hostMatch[1]?.trim();
        text = url ? `URL: ${url}` : "URL ready";
    }

    // Strip docker layer/image identifiers like "[4f4fb700ef54] ".
    text = text.replace(/^\[[^\n]*?]\s*/, "").trim();

    // Drop trailing bare numbers like "Downloading 3".
    if (/\s\d+$/.test(text) && !/\d+\/\d+/.test(text)) {
        text = text.replace(/\s\d+$/, "").trim();
    }

    // Hide meaningless numeric-only details.
    if (/^\d+(?:\/\d+)?$/.test(text)) {
        return null;
    }

    return text;
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
            style={{
                height: 8,
                borderRadius: 999,
                overflow: "hidden",
            }}
        >
            {indeterminate || normalizedValue == null ? (
                <Row background={tone} className={styles.progressIndeterminate}/>
            ) : (
                <Row
                    background={tone}
                    style={{
                        height: "100%",
                        width: `${normalizedValue}%`,
                    }}
                />
            )}
        </Row>
    );
}

const buildInstallPayload = ({
                                 services,
                                 selected,
                                 values,
                             }: {
    services: ServiceCatalogEntry[];
    selected: Set<string>;
    values: Record<string, Record<string, string>>;
}): InstallRequestEntry[] => {
    const byName = new Map(services.map((entry) => [entry.name, entry]));

    const targets = Array.from(selected).filter((name) => !ALWAYS_RUNNING.has(name));
    return targets.map((name) => {
        const svc = byName.get(name);
        const envConfig = Array.isArray(svc?.envConfig) ? svc?.envConfig : [];
        const current = values[name] ?? {};

        const env: Record<string, string> = {};
        for (const field of envConfig) {
            if (!field?.key) continue;
            if (field.readOnly) continue;
            const raw = current[field.key];
            const trimmed = raw.trim();
            if (!trimmed) continue;
            env[field.key] = sanitizeEnvValue(trimmed);
        }

        return Object.keys(env).length > 0 ? {name, env} : {name};
    });
};

const portalRequiredKeys = Object.freeze([
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_ID",
    "KAVITA_BASE_URL",
    "KAVITA_API_KEY",
]);

const validateSelection = ({
                               selected,
                               values,
                           }: {
    selected: Set<string>;
    values: Record<string, Record<string, string>>;
}): { ok: true } | { ok: false; message: string; missing: Array<{ service: string; key: string }> } => {
    const missing: Array<{ service: string; key: string }> = [];

    const targets = Array.from(selected).filter((name) => !ALWAYS_RUNNING.has(name));
    if (targets.length === 0) {
        return {ok: false, message: "Select at least one service to install.", missing};
    }

    if (selected.has("noona-portal")) {
        const portalEnv = values["noona-portal"] ?? {};
        for (const key of portalRequiredKeys) {
            const value = typeof portalEnv[key] === "string" ? portalEnv[key].trim() : "";
            if (!value) {
                missing.push({service: "noona-portal", key});
            }
        }
    }

    if (missing.length > 0) {
        return {
            ok: false,
            message: "Fill required Portal settings before installing.",
            missing,
        };
    }

    return {ok: true};
};

export function SetupWizard() {
    const [catalog, setCatalog] = useState<ServiceCatalogEntry[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);

    const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED));
    const [values, setValues] = useState<Record<string, Record<string, string>>>(() => ({}));

    const [showAdvanced, setShowAdvanced] = useState(false);

    const [configMessage, setConfigMessage] = useState<string | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);

    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState<string | null>(null);
    const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
    const [installResult, setInstallResult] = useState<unknown | null>(null);
    const [summaryOpen, setSummaryOpen] = useState(false);

    const [finishing, setFinishing] = useState(false);
    const [finishError, setFinishError] = useState<string | null>(null);

    const pollRef = useRef<number | null>(null);
    const finishInFlightRef = useRef(false);
    const configInputRef = useRef<HTMLInputElement | null>(null);

    const services = catalog ?? [];
    const servicesByName = useMemo(() => new Map(services.map((entry) => [entry.name, entry])), [services]);

    const missingPortalKeys = useMemo(() => {
        const result = validateSelection({selected, values});
        return result.ok ? [] : result.missing;
    }, [selected, values]);

    const stopPolling = useCallback(() => {
        if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollProgress = async () => {
        try {
            const res = await fetch("/api/noona/install/progress", {cache: "no-store"});
            const payload = (await res.json().catch(() => null)) as InstallProgress | null;
            if (payload && Array.isArray(payload.items)) {
                setInstallProgress(payload);
            }
        } catch {
            // Keep polling; transient failures are expected during Docker pulls.
        }
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setCatalogError(null);
            setCatalog(null);
            try {
                const res = await fetch("/api/noona/services", {cache: "no-store"});
                const json = (await res.json()) as CatalogResponse;
                if (!res.ok) {
                    setCatalogError(json?.error || `Failed to load services (HTTP ${res.status}).`);
                    return;
                }

                const list = Array.isArray(json.services) ? json.services : [];
                if (cancelled) return;

                setCatalog(list);
                setValues(applyDerivedEnvState(buildInitialEnvState(list)));

                // Ensure anything marked "required" is selected by default.
                setSelected((prev) => {
                    const next = new Set(prev);
                    for (const service of list) {
                        if (service?.required) next.add(service.name);
                    }
                    return next;
                });
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setCatalogError(message);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, [stopPolling]);

    const toggleSelected = (name: string) => {
        const service = servicesByName.get(name);
        if (ALWAYS_RUNNING.has(name) || service?.required) {
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

    const install = async () => {
        if (!catalog) return;

        const validation = validateSelection({selected, values});
        if (!validation.ok) {
            setInstallError(validation.message);
            return;
        }

        setInstalling(true);
        setInstallError(null);
        setInstallResult(null);
        setInstallProgress(null);
        setSummaryOpen(false);

        stopPolling();
        pollRef.current = window.setInterval(pollProgress, 1200);
        void pollProgress();

        const payload = buildInstallPayload({services: catalog, selected, values});

        try {
            const responsePromise = fetch("/api/noona/install", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({services: payload}),
            });

            const response = await responsePromise;
            const json = await response.json().catch(() => ({}));

            if (!response.ok) {
                const errorMessage =
                    typeof json?.error === "string" && json.error.trim()
                        ? json.error.trim()
                        : `Install failed (HTTP ${response.status}).`;
                setInstallError(errorMessage);
                return;
            }

            setInstallResult(json);
            setSummaryOpen(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setInstallError(message);
        } finally {
            stopPolling();
            setInstalling(false);
            void pollProgress();
        }
    };

    const downloadConfigFile = () => {
        setConfigMessage(null);
        setConfigError(null);

        if (!catalog) {
            setConfigError("Services have not loaded yet.");
            return;
        }

        try {
            const payload: WizardConfigPayloadV1 = {
                version: 1,
                selected: Array.from(selected),
                values,
            };
            const formatted = JSON.stringify(payload, null, 2);
            const blob = new Blob([formatted], {type: "application/json"});
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
            const message = error instanceof Error ? error.message : String(error);
            setConfigError(message);
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
            const raw = await file.text();
            const parsed = JSON.parse(raw) as unknown;

            if (!parsed || typeof parsed !== "object") {
                setConfigError("Setup JSON must be an object.");
                return;
            }

            const payload = parsed as Partial<WizardConfigPayloadV1>;
            if (payload.version !== 1) {
                setConfigError("Unsupported setup JSON version.");
                return;
            }

            const nextSelected = new Set<string>();
            if (Array.isArray(payload.selected)) {
                for (const entry of payload.selected) {
                    if (entry.trim()) {
                        nextSelected.add(entry.trim());
                    }
                }
            }

            // Always force required/running services on.
            for (const name of ALWAYS_RUNNING) nextSelected.add(name);
            for (const service of catalog) {
                if (service?.required) nextSelected.add(service.name);
            }

            const nextValues: Record<string, Record<string, string>> = {};
            if (payload.values && typeof payload.values === "object") {
                for (const [serviceName, env] of Object.entries(payload.values)) {
                    if (!serviceName) continue;
                    if (!env || typeof env !== "object") continue;

                    const envMap: Record<string, string> = {};
                    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
                        if (!key.trim()) continue;
                        envMap[key] = sanitizeEnvValue(typeof value === "string" ? value : String(value ?? ""));
                    }

                    nextValues[serviceName] = envMap;
                }
            }

            setSelected(nextSelected);
            setValues((prev) =>
                applyDerivedEnvState(Object.keys(nextValues).length > 0 ? {...prev, ...nextValues} : prev),
            );
            setConfigMessage(`Loaded setup JSON from ${file.name}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setConfigError(message);
        } finally {
            event.target.value = "";
        }
    };

    const finishSetup = async () => {
        if (finishInFlightRef.current) {
            return;
        }

        finishInFlightRef.current = true;
        setFinishError(null);
        setFinishing(true);

        try {
            const res = await fetch("/api/noona/setup/complete", {method: "POST"});
            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
                const message =
                    typeof json?.error === "string" && json.error.trim()
                        ? json.error.trim()
                        : `Failed to complete setup (HTTP ${res.status}).`;
                setFinishError(message);
                return;
            }

            window.location.assign("/");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setFinishError(message);
        } finally {
            setFinishing(false);
            finishInFlightRef.current = false;
        }
    };

    const sorted = useMemo(() => {
        const list = [...services];
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }, [services]);

    return (
        <Column maxWidth="l" gap="xl" paddingY="12" horizontal="center">
            <Column gap="8" horizontal="center" align="center">
                <Heading variant="display-strong-s" wrap="balance">
                    Noona Setup Wizard
                </Heading>
                <Text onBackground="neutral-weak" wrap="balance">
                    Configure environment variables, then pull and install the remaining Noona services via Warden.
                </Text>
            </Column>

            {catalogError && (
                <Card fillWidth background={BG_SURFACE} border="danger-alpha-weak" padding="l" radius="l">
                    <Column gap="8">
                        <Row gap="8" vertical="center">
                            <Badge background={BG_DANGER_ALPHA_WEAK} onBackground="neutral-strong">
                                Backend unavailable
                            </Badge>
                            <Text onBackground="neutral-weak">Moon could not reach Warden/Sage.</Text>
                        </Row>
                        <Text>{catalogError}</Text>
                        <Text onBackground="neutral-weak">
                            Ensure `noona-warden` and `noona-sage` are running, then refresh this page.
                        </Text>
                    </Column>
                </Card>
            )}

            {!catalog && !catalogError && (
                <Row fillWidth horizontal="center" paddingY="64">
                    <Spinner/>
                </Row>
            )}

            {catalog && (
                <Row fillWidth gap="24" s={{direction: "column"}}>
                    <Column flex={1} gap="16">
                        <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="16">
                                <Row horizontal="between" vertical="center" gap="12">
                                    <Heading as="h2" variant="heading-strong-l">
                                        Services
                                    </Heading>
                                    <Button
                                        size="s"
                                        variant="secondary"
                                        onClick={() => setShowAdvanced((prev) => !prev)}
                                    >
                                        {showAdvanced ? "Hide advanced" : "Show advanced"}
                                    </Button>
                                </Row>
                                <Column gap="8">
                                    {sorted.map((service) => {
                                        const name = service.name;
                                        const isChecked = selected.has(name);
                                        const installed = service.installed === true;
                                        const disabled = ALWAYS_RUNNING.has(name) || service.required === true;

                                        return (
                                            <Row
                                                key={name}
                                                fillWidth
                                                vertical="center"
                                                horizontal="between"
                                                gap="12"
                                                paddingY="8"
                                            >
                                                <Column gap="4" style={{minWidth: 0}}>
                                                    <Row gap="8" vertical="center">
                                                        <Text variant="heading-default-s">{name}</Text>
                                                        {service.required && (
                                                            <Badge background={BG_BRAND_ALPHA_WEAK}
                                                                   onBackground="neutral-strong">
                                                                required
                                                            </Badge>
                                                        )}
                                                        {installed && (
                                                            <Badge background={BG_SUCCESS_ALPHA_WEAK}
                                                                   onBackground="neutral-strong">
                                                                installed
                                                            </Badge>
                                                        )}
                                                    </Row>
                                                    {service.description && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {service.description}
                                                        </Text>
                                                    )}
                                                    {service.image && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            Pulls: {service.image}
                                                        </Text>
                                                    )}
                                                </Column>

                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    disabled={disabled}
                                                    onChange={() => toggleSelected(name)}
                                                    aria-label={`Select ${name}`}
                                                />
                                            </Row>
                                        );
                                    })}
                                </Column>
                            </Column>
                        </Card>

                        <Card fillWidth background={BG_SURFACE} border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Install
                                </Heading>

                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button size="s" variant="secondary" onClick={() => downloadConfigFile()}>
                                        Download JSON
                                    </Button>
                                    <Button size="s" variant="secondary" onClick={() => openConfigFilePicker()}>
                                        Upload JSON
                                    </Button>
                                    <input
                                        ref={configInputRef}
                                        type="file"
                                        accept="application/json,.json"
                                        onChange={(event) => void loadConfigFromFile(event)}
                                        style={{display: "none"}}
                                        aria-label="Upload setup JSON file"
                                    />
                                </Row>

                                {configMessage && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        {configMessage}
                                    </Text>
                                )}

                                {configError && (
                                    <Text onBackground="danger-strong" variant="body-default-xs">
                                        {configError}
                                    </Text>
                                )}

                                {missingPortalKeys.length > 0 && (
                                    <Column gap="8">
                                        <Text onBackground="neutral-weak">
                                            Portal requires:
                                        </Text>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {missingPortalKeys.map((entry) => (
                                                <Badge
                                                    key={`${entry.service}:${entry.key}`}
                                                    background={BG_DANGER_ALPHA_WEAK}
                                                    onBackground="neutral-strong"
                                                >
                                                    {entry.key}
                                                </Badge>
                                            ))}
                                        </Row>
                                    </Column>
                                )}

                                <Button
                                    size="m"
                                    variant="primary"
                                    disabled={installing || missingPortalKeys.length > 0}
                                    onClick={() => void install()}
                                >
                                    {installing
                                        ? installProgress?.items?.some((item) => item.status?.trim().toLowerCase() === "downloading")
                                            ? "Downloading..."
                                            : "Installing..."
                                        : "Install selected services"}
                                </Button>

                                {installError && (
                                    <Text onBackground="danger-strong">{installError}</Text>
                                )}

                                {installProgress && (
                                    <Column gap="8">
                                        <Row horizontal="between" vertical="center">
                                            <Text onBackground="neutral-weak">
                                                Status: {formatInstallStatusLabel(installProgress.status)}
                                            </Text>
                                            <Text onBackground="neutral-weak">
                                                {installProgress.percent != null ? `${installProgress.percent}%` : ""}
                                            </Text>
                                        </Row>
                                        <ProgressBar
                                            value={installProgress.percent ?? 0}
                                            indeterminate={installProgress.percent == null && installProgress.status !== "idle"}
                                            tone="brand-alpha-medium"
                                        />
                                        <Line background={BG_NEUTRAL_ALPHA_WEAK}/>
                                        <Column gap="8">
                                            {installProgress.items.map((item) => {
                                                const normalized = item.status?.trim().toLowerCase() ?? "";
                                                const isInstalled = normalized === "installed";
                                                const isError = normalized === "error";
                                                const isPending = normalized === "pending";
                                                const detail = formatInstallDetail(item.detail);
                                                const progressValue = isInstalled ? 100 : isError ? 100 : isPending ? 0 : null;
                                                const tone: ProgressTone = isInstalled
                                                    ? "success-alpha-medium"
                                                    : isError
                                                        ? "danger-alpha-medium"
                                                        : isPending
                                                            ? "neutral-alpha-medium"
                                                            : "brand-alpha-medium";

                                                return (
                                                    <Column key={item.name} gap="8">
                                                        <Row horizontal="between" gap="12" vertical="center">
                                                            <Text>{item.label ?? item.name}</Text>
                                                            <Text
                                                                onBackground="neutral-weak">{formatInstallStatusLabel(item.status)}</Text>
                                                        </Row>
                                                        <ProgressBar
                                                            value={progressValue}
                                                            indeterminate={progressValue == null}
                                                            tone={tone}
                                                        />
                                                        {detail && (
                                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                                {detail}
                                                            </Text>
                                                        )}
                                                    </Column>
                                                );
                                            })}
                                        </Column>
                                    </Column>
                                )}

                                {installResult !== null && (
                                    <Column gap="12">
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Install completed. Open setup summary to finalize setup and continue.
                                        </Text>
                                        <Button size="m" variant="primary" onClick={() => setSummaryOpen(true)}>
                                            Open setup summary
                                        </Button>
                                    </Column>
                                )}
                            </Column>
                        </Card>
                    </Column>

                    <Column flex={2} gap="16">
                        {Array.from(selected)
                            .sort((a, b) => a.localeCompare(b))
                            .map((name) => {
                                const service = servicesByName.get(name);
                                if (!service) return null;

                                const envConfig = Array.isArray(service.envConfig) ? service.envConfig : [];

                                const visibleFields = envConfig.filter((field) => {
                                    if (!field?.key) return false;
                                    if (showAdvanced) return true;
                                    return !ADVANCED_KEYS.has(field.key);
                                });

                                if (visibleFields.length === 0) {
                                    return (
                                        <Card
                                            key={name}
                                            fillWidth
                                            background={BG_SURFACE}
                                            border="neutral-alpha-weak"
                                            padding="l"
                                            radius="l"
                                        >
                                            <Column gap="8">
                                                <Heading as="h3" variant="heading-strong-l">
                                                    {name}
                                                </Heading>
                                                {service.description && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">
                                                        {service.description}
                                                    </Text>
                                                )}
                                                {service.image && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        Pulls: {service.image}
                                                    </Text>
                                                )}
                                                <Text onBackground="neutral-weak">No configurable environment
                                                    fields.</Text>
                                            </Column>
                                        </Card>
                                    );
                                }

                                return (
                                    <Card
                                        key={name}
                                        fillWidth
                                        background={BG_SURFACE}
                                        border="neutral-alpha-weak"
                                        padding="l"
                                        radius="l"
                                    >
                                        <Column gap="16">
                                            <Row horizontal="between" vertical="center" gap="12">
                                                <Column gap="4" style={{minWidth: 0}}>
                                                    <Heading as="h3" variant="heading-strong-l">
                                                        {name}
                                                    </Heading>
                                                    {service.description && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {service.description}
                                                        </Text>
                                                    )}
                                                    {service.image && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            Pulls: {service.image}
                                                        </Text>
                                                    )}
                                                    {service.hostServiceUrl && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {service.hostServiceUrl}
                                                        </Text>
                                                    )}
                                                </Column>
                                                {ALWAYS_RUNNING.has(name) && (
                                                    <Badge background={BG_BRAND_ALPHA_WEAK}
                                                           onBackground="neutral-strong">
                                                        running
                                                    </Badge>
                                                )}
                                            </Row>

                                            <Column gap="12">
                                                {visibleFields.map((field) => {
                                                    const key = field.key;
                                                    const current = values[name]?.[key] ?? "";
                                                    const required =
                                                        name === "noona-portal" && portalRequiredKeys.includes(key)
                                                            ? true
                                                            : field.required === true;

                                                    const isMissing =
                                                        required &&
                                                        !field.readOnly &&
                                                        (!current || current.trim().length === 0) &&
                                                        !(name === "noona-portal" && key === "VAULT_ACCESS_TOKEN");

                                                    return (
                                                        <Column key={key} gap="8">
                                                            <Row gap="8" vertical="center">
                                                                <Text
                                                                    variant="label-default-s">{field.label || key}</Text>
                                                                {required && (
                                                                    <Badge background={BG_BRAND_ALPHA_WEAK}
                                                                           onBackground="neutral-strong">
                                                                        required
                                                                    </Badge>
                                                                )}
                                                                {field.readOnly && (
                                                                    <Badge background={BG_NEUTRAL_ALPHA_WEAK}
                                                                           onBackground="neutral-strong">
                                                                        read-only
                                                                    </Badge>
                                                                )}
                                                            </Row>

                                                            <Input
                                                                id={`${name}:${key}`}
                                                                name={key}
                                                                type={isSecretKey(key) ? "password" : isUrlKey(key) ? "url" : "text"}
                                                                placeholder={key}
                                                                value={current}
                                                                disabled={field.readOnly === true}
                                                                required={required}
                                                                errorMessage={isMissing ? "Required value missing." : undefined}
                                                                onChange={(e) => updateEnv(name, key, e.target.value)}
                                                            />

                                                            {(field.description || field.warning) && (
                                                                <Column gap="4">
                                                                    {field.description && (
                                                                        <Text onBackground="neutral-weak"
                                                                              variant="body-default-xs">
                                                                            {field.description}
                                                                        </Text>
                                                                    )}
                                                                    {field.warning && (
                                                                        <Text onBackground="danger-strong"
                                                                              variant="body-default-xs">
                                                                            {field.warning}
                                                                        </Text>
                                                                    )}
                                                                </Column>
                                                            )}
                                                        </Column>
                                                    );
                                                })}
                                            </Column>
                                        </Column>
                                    </Card>
                                );
                            })}
                    </Column>
                </Row>
            )}

            {installResult !== null && summaryOpen && (
                <div className={styles.summaryOverlay}>
                    <Card background={BG_SURFACE} border="neutral-alpha-weak" radius="l" padding="l"
                          className={styles.summaryModal}>
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Setup summary
                                </Heading>
                                <Button size="s" variant="secondary" onClick={() => setSummaryOpen(false)}>
                                    Close
                                </Button>
                            </Row>

                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Final step: mark setup complete and return to the main app.
                            </Text>

                            <Line background={BG_NEUTRAL_ALPHA_WEAK}/>

                            <Column gap="12">
                                <Row gap="8" vertical="center">
                                    <Badge background={BG_BRAND_ALPHA_WEAK} onBackground="neutral-strong">
                                        Finalize
                                    </Badge>
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Admin account is already handled before setup. This only closes setup mode.
                                    </Text>
                                </Row>
                            </Column>

                            <Button
                                size="m"
                                variant="primary"
                                disabled={finishing}
                                onClick={() => void finishSetup()}
                            >
                                {finishing ? "Finishing..." : "Finish setup and continue"}
                            </Button>
                            {finishError && (
                                <Text onBackground="danger-strong" variant="body-default-xs">
                                    {finishError}
                                </Text>
                            )}
                        </Column>
                    </Card>
                </div>
            )}
        </Column>
    );
}
