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

type InstallResultEntry = {
    name: string;
    status: string;
    error?: string | null;
};

type InstallResponse = {
    results?: InstallResultEntry[];
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
const INSTALL_PROGRESS_START_TIMEOUT_MS = 60_000;
const TERMINAL_INSTALL_STATUSES = new Set(["complete", "error"]);

const clampPercent = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const normalizeInstallStatus = (value: string | null | undefined): string =>
    (typeof value === "string" ? value : "").trim().toLowerCase();

const formatInstallStatusLabel = (value: string) => {
    const normalized = normalizeInstallStatus(value);

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
            // Uploaded JSON may omit keys; treat absent/non-string values as empty.
            const trimmed = normalizeString(current[field.key]).trim();
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

type MissingRequiredField = {
    service: string;
    key: string;
};

const validateSelection = ({
                               selected,
                               values,
                               servicesByName,
                           }: {
    selected: Set<string>;
    values: Record<string, Record<string, string>>;
    servicesByName: Map<string, ServiceCatalogEntry>;
}): { ok: true } | { ok: false; message: string; missing: MissingRequiredField[] } => {
    const missing: MissingRequiredField[] = [];
    const unknownServices: string[] = [];

    if (selected.size === 0) {
        return {ok: false, message: "Select at least one service to install.", missing};
    }

    for (const serviceName of selected) {
        const service = servicesByName.get(serviceName);
        if (!service) {
            unknownServices.push(serviceName);
            continue;
        }

        const envConfig = Array.isArray(service?.envConfig) ? service.envConfig : [];
        const current = values[serviceName] ?? {};

        for (const field of envConfig) {
            if (!field?.key || field.readOnly) continue;

            const isPortalRequired = serviceName === "noona-portal" && portalRequiredKeys.includes(field.key);
            const required = isPortalRequired || field.required === true;
            if (!required) continue;

            if (serviceName === "noona-portal" && field.key === "VAULT_ACCESS_TOKEN") {
                continue;
            }

            const value = typeof current[field.key] === "string" ? current[field.key].trim() : "";
            if (!value) {
                missing.push({service: serviceName, key: field.key});
            }
        }
    }

    if (unknownServices.length > 0) {
        const labels = Array.from(new Set(unknownServices)).join(", ");
        return {
            ok: false,
            message: `Selection contains unknown services (${labels}). Refresh the page and try again.`,
            missing,
        };
    }

    if (missing.length > 0) {
        return {
            ok: false,
            message: "Fill all required settings before installing.",
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
    const [installResult, setInstallResult] = useState<InstallResponse | null>(null);
    const [summaryOpen, setSummaryOpen] = useState(false);

    const [finishing, setFinishing] = useState(false);
    const [finishError, setFinishError] = useState<string | null>(null);

    const pollRef = useRef<number | null>(null);
    const installRequestRef = useRef<AbortController | null>(null);
    const installProgressTimeoutRef = useRef<number | null>(null);
    const installTargetsRef = useRef<Set<string>>(new Set());
    const installProgressStartedRef = useRef(false);
    const finishInFlightRef = useRef(false);
    const configInputRef = useRef<HTMLInputElement | null>(null);

    const services = catalog ?? [];
    const servicesByName = useMemo(() => new Map(services.map((entry) => [entry.name, entry])), [services]);

    const missingRequiredFields = useMemo(() => {
        const result = validateSelection({selected, values, servicesByName});
        return result.ok ? [] : result.missing;
    }, [selected, servicesByName, values]);

    const installResultErrors = useMemo(() => {
        if (!Array.isArray(installResult?.results)) return [];
        return installResult.results.filter((entry) => normalizeInstallStatus(entry?.status) === "error");
    }, [installResult]);

    const clearInstallProgressTimeout = useCallback(() => {
        if (installProgressTimeoutRef.current != null) {
            window.clearTimeout(installProgressTimeoutRef.current);
            installProgressTimeoutRef.current = null;
        }
    }, []);

    const resetInstallSession = useCallback(() => {
        installTargetsRef.current = new Set();
        installProgressStartedRef.current = false;
        clearInstallProgressTimeout();
    }, [clearInstallProgressTimeout]);

    const abortInstallRequest = useCallback(() => {
        if (installRequestRef.current) {
            installRequestRef.current.abort();
            installRequestRef.current = null;
        }
    }, []);

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
                const activeTargets = installTargetsRef.current;
                const sessionActive = activeTargets.size > 0;
                const hasRelevantItems = payload.items.some((item) => activeTargets.has(item.name));

                const normalizedStatus = normalizeInstallStatus(payload.status);
                const isFinished = TERMINAL_INSTALL_STATUSES.has(normalizedStatus);

                if (sessionActive && !installProgressStartedRef.current) {
                    // Ignore stale snapshots from prior runs until we see this request's
                    // own non-terminal progress for one of the selected services.
                    if (!hasRelevantItems || isFinished) {
                        return;
                    }

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
                        setSummaryOpen(true);
                    } else {
                        setInstallError((prev) => prev ?? "Installation finished with errors. Check service statuses below.");
                    }

                    abortInstallRequest();
                }
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
            clearInstallProgressTimeout();
            abortInstallRequest();
            resetInstallSession();
        };
    }, [abortInstallRequest, clearInstallProgressTimeout, resetInstallSession, stopPolling]);

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

        const validation = validateSelection({selected, values, servicesByName});
        if (!validation.ok) {
            setInstallError(validation.message);
            return;
        }

        const payload = buildInstallPayload({services: catalog, selected, values});

        if (payload.length === 0) {
            setInstallResult({results: []});
            setSummaryOpen(true);
            setInstalling(false);
            setInstallError(null);
            return;
        }

        // Track only services that this request will actually install.
        const targetNames = new Set(payload.map((entry) => entry.name));

        setInstalling(true);
        setInstallError(null);
        setInstallResult(null);
        setInstallProgress(null);
        setSummaryOpen(false);

        stopPolling();
        abortInstallRequest();
        resetInstallSession();

        installTargetsRef.current = targetNames;
        if (targetNames.size > 0) {
            installProgressTimeoutRef.current = window.setTimeout(() => {
                if (installProgressStartedRef.current) return;

                stopPolling();
                resetInstallSession();
                setInstalling(false);
                setInstallError(
                    "Install request was sent, but Warden did not report progress. Ensure noona-warden and noona-sage are running, then retry.",
                );
                abortInstallRequest();
            }, INSTALL_PROGRESS_START_TIMEOUT_MS);
        }

        pollRef.current = window.setInterval(pollProgress, 1200);
        void pollProgress();

        const controller = new AbortController();
        installRequestRef.current = controller;

        const inspectProgressAfterInstallFailure = async (): Promise<"running" | "complete" | "error" | null> => {
            try {
                const progressRes = await fetch("/api/noona/install/progress", {cache: "no-store"});
                const progressPayload = (await progressRes.json().catch(() => null)) as InstallProgress | null;
                if (!progressPayload || !Array.isArray(progressPayload.items)) {
                    return null;
                }

                const hasRelevantItems = progressPayload.items.some((item) => targetNames.has(item.name));
                if (!hasRelevantItems) {
                    return null;
                }

                const normalizedStatus = normalizeInstallStatus(progressPayload.status);
                setInstallProgress(progressPayload);

                if (normalizedStatus === "complete") {
                    stopPolling();
                    resetInstallSession();
                    setInstalling(false);
                    setInstallError(null);
                    setInstallResult((prev) => prev ?? {results: []});
                    setSummaryOpen(true);
                    return "complete";
                }

                if (normalizedStatus === "error") {
                    stopPolling();
                    resetInstallSession();
                    setInstalling(false);
                    setInstallError((prev) => prev ?? "Installation finished with errors. Check service statuses below.");
                    return "error";
                }

                if (normalizedStatus && normalizedStatus !== "idle") {
                    installProgressStartedRef.current = true;
                    clearInstallProgressTimeout();
                    setInstallError(
                        "Install request timed out at the gateway, but Warden is still installing services. Monitoring continues automatically.",
                    );
                    return "running";
                }
            } catch {
                // Fall back to regular error handling below.
            }

            return null;
        };

        try {
            const responsePromise = fetch("/api/noona/install", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({services: payload}),
                signal: controller.signal,
            });

            const response = await responsePromise;
            const json = (await response.json().catch(() => ({}))) as InstallResponse & { error?: string };

            if (!response.ok) {
                if ([502, 503, 504, 524].includes(response.status)) {
                    const progressState = await inspectProgressAfterInstallFailure();
                    if (progressState) {
                        return;
                    }
                }

                const errorMessage =
                    typeof json?.error === "string" && json.error.trim()
                        ? json.error.trim()
                        : `Install failed (HTTP ${response.status}).`;
                stopPolling();
                resetInstallSession();
                setInstalling(false);
                setInstallError(errorMessage);
                return;
            }

            const responseEntries = Array.isArray(json?.results) ? json.results : [];
            const responseHasErrors =
                response.status === 207 ||
                responseEntries.some((entry) => normalizeInstallStatus(entry?.status) === "error");

            // 207 Multi-Status means at least one install failed.
            setInstallResult({
                ...json,
                results: responseEntries,
            });
            setSummaryOpen(!responseHasErrors);
            if (responseHasErrors) {
                setInstallError("Installation finished with errors. Check service statuses below.");
            }

            stopPolling();
            resetInstallSession();
            setInstalling(false);
            void pollProgress();
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }

            const progressState = await inspectProgressAfterInstallFailure();
            if (progressState) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            stopPolling();
            resetInstallSession();
            setInstalling(false);
            setInstallError(message);
        } finally {
            if (installRequestRef.current === controller) {
                installRequestRef.current = null;
            }
            clearInstallProgressTimeout();
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
            const knownServiceNames = new Set(catalog.map((service) => service.name));
            const ignoredServices: string[] = [];
            if (Array.isArray(payload.selected)) {
                for (const entry of payload.selected) {
                    if (typeof entry !== "string") continue;
                    const normalized = entry.trim();
                    if (!normalized) continue;
                    if (knownServiceNames.has(normalized)) {
                        nextSelected.add(normalized);
                    } else {
                        ignoredServices.push(normalized);
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
                    if (!knownServiceNames.has(serviceName)) continue;
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
            setValues((prev) => {
                if (Object.keys(nextValues).length === 0) {
                    return prev;
                }

                // Preserve catalog defaults and only replace keys provided by the uploaded config.
                const merged = {...prev};
                for (const [serviceName, envMap] of Object.entries(nextValues)) {
                    merged[serviceName] = {
                        ...(prev[serviceName] ?? {}),
                        ...envMap,
                    };
                }
                return applyDerivedEnvState(merged);
            });

            const ignoredLabel = Array.from(new Set(ignoredServices)).join(", ");
            setConfigMessage(
                ignoredLabel
                    ? `Loaded setup JSON from ${file.name}. Ignored unknown services: ${ignoredLabel}.`
                    : `Loaded setup JSON from ${file.name}.`,
            );
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

                                {missingRequiredFields.length > 0 && (
                                    <Column gap="8">
                                        <Text onBackground="neutral-weak">
                                            Required fields missing:
                                        </Text>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {missingRequiredFields.map((entry) => (
                                                <Badge
                                                    key={`${entry.service}:${entry.key}`}
                                                    background={BG_DANGER_ALPHA_WEAK}
                                                    onBackground="neutral-strong"
                                                >
                                                    {entry.service}:{entry.key}
                                                </Badge>
                                            ))}
                                        </Row>
                                    </Column>
                                )}

                                <Button
                                    size="m"
                                    variant="primary"
                                    disabled={installing}
                                    onClick={() => void install()}
                                >
                                    {installing
                                        ? installProgress?.items?.some((item) => normalizeInstallStatus(item.status) === "downloading")
                                            ? "Downloading..."
                                            : "Installing..."
                                        : "Install selected services"}
                                </Button>

                                {installing && !installProgress && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Waiting for Warden to report install progress...
                                    </Text>
                                )}

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
                                                const normalized = normalizeInstallStatus(item.status);
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

                                {installResultErrors.length > 0 && (
                                    <Column gap="8">
                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                            Some services failed to install:
                                        </Text>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {installResultErrors.map((entry) => (
                                                <Badge
                                                    key={`install-error:${entry.name}`}
                                                    background={BG_DANGER_ALPHA_WEAK}
                                                    onBackground="neutral-strong"
                                                >
                                                    {entry.name}
                                                </Badge>
                                            ))}
                                        </Row>
                                    </Column>
                                )}

                                {installResult !== null && installResultErrors.length === 0 && !installError && (
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
                                                                required={false}
                                                                aria-required={required}
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
