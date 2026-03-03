"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, Text} from "@once-ui-system/core";
import styles from "./RebootingPage.module.scss";

type ServiceCatalogEntry = {
    name?: string | null;
    description?: string | null;
    installed?: boolean | null;
};

type ServiceCatalogResponse = {
    services?: ServiceCatalogEntry[] | null;
    error?: string;
};

type ServiceHealthResponse = {
    success?: boolean | null;
    supported?: boolean | null;
    status?: string | number | null;
    detail?: string | null;
    error?: string | null;
    body?: unknown;
};

type MonitorPhase = "preparing" | "updating" | "waiting" | "verifying" | "complete" | "failed";
type ServiceStep = "monitoring" | "queued" | "updating" | "current" | "updated" | "waiting" | "healthy" | "failed";
type BadgeBackground =
    | "neutral-alpha-weak"
    | "brand-alpha-weak"
    | "warning-alpha-weak"
    | "success-alpha-weak"
    | "danger-alpha-weak";
type ProgressBackground = "brand-alpha-medium" | "success-alpha-medium" | "danger-alpha-medium";
type SectionTone = "neutral" | "success" | "warning";

type HealthSnapshot = {
    success: boolean | null;
    supported: boolean | null;
    detail: string;
    status: string;
    checkedAt: number | null;
};

type ServiceMonitorEntry = {
    service: string;
    target: boolean;
    step: ServiceStep;
    detail: string;
    updated: boolean;
    restarted: boolean;
    error: string | null;
    attempts: number;
    health: HealthSnapshot | null;
};

const POLL_INTERVAL_MS = 2500;
const REBOOT_TIMEOUT_MS = 12 * 60 * 1000;
const STABILITY_POLLS_REQUIRED = 2;
const RETURN_TO_DEFAULT = "/settings/warden";
const CORE_SERVICES = ["noona-warden", "noona-vault", "noona-moon", "noona-sage"] as const;
const CORE_SERVICE_SET = new Set<string>(CORE_SERVICES);
const DETAIL_PREVIEW_LIMIT = 180;
const UPDATE_PRIORITY = [
    "noona-portal",
    "noona-raven",
    "noona-kavita",
    "noona-komf",
    "noona-mongo",
    "noona-redis",
    "noona-vault",
    "noona-moon",
    "noona-sage",
] as const;
const UPDATE_PRIORITY_INDEX = new Map<string, number>(
    UPDATE_PRIORITY.map((service, index) => [service, index]),
);
const SERVICE_LABELS: Record<string, string> = {
    "noona-warden": "Warden",
    "noona-moon": "Moon",
    "noona-sage": "Sage",
    "noona-vault": "Vault",
    "noona-redis": "Redis",
    "noona-mongo": "Mongo",
    "noona-portal": "Portal",
    "noona-raven": "Raven",
    "noona-kavita": "Kavita",
    "noona-komf": "Komf",
};
const SERVICE_DESCRIPTIONS: Record<string, string> = {
    "noona-warden": "Orchestrator and health source for the managed stack.",
    "noona-vault": "Shared storage and settings layer.",
    "noona-moon": "Primary web console. If this disappears, the monitor waits for the UI to return.",
    "noona-sage": "Auth, setup, and settings proxy layer.",
    "noona-redis": "Session and live-state store.",
    "noona-mongo": "Document database for Noona state.",
    "noona-portal": "Discord bridge and metadata helpers.",
    "noona-raven": "Downloader and library worker.",
    "noona-kavita": "Reader and library server.",
    "noona-komf": "Metadata enrichment helper.",
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const clampPercent = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const looksLikeHtml = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith("<!doctype html")
        || normalized.includes("<html")
        || normalized.includes("<head")
        || normalized.includes("<body")
        || normalized.includes("<script");
};

const summarizeDetail = (
    value: unknown,
    options: { success?: boolean | null; supported?: boolean | null } = {},
): string => {
    const normalized = collapseWhitespace(normalizeString(value));
    if (!normalized) {
        if (options.supported === false) {
            return "No health endpoint is defined for this service.";
        }
        return options.success === true ? "Healthy." : "Waiting for a healthy response.";
    }
    if (looksLikeHtml(normalized)) {
        return options.success === true
            ? "Service responded, but the probe returned an HTML page instead of a compact health payload."
            : "Health probe returned an HTML page instead of a compact error response.";
    }
    if (normalized.length <= DETAIL_PREVIEW_LIMIT) {
        return normalized;
    }
    return `${normalized.slice(0, DETAIL_PREVIEW_LIMIT - 3).trimEnd()}...`;
};

const parseServicesParam = (raw: string | null): string[] => {
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

const normalizeReturnTo = (raw: string | null): string => {
    const value = normalizeString(raw).trim();
    if (!value.startsWith("/")) {
        return RETURN_TO_DEFAULT;
    }
    return value;
};

const parseApiError = (payload: { error?: unknown } | null | undefined, fallback: string): string => {
    const message = typeof payload?.error === "string" ? payload.error.trim() : "";
    return message || fallback;
};

const shouldPauseForRecovery = (message: string): boolean => {
    const normalized = normalizeString(message).toLowerCase();
    if (!normalized) return false;
    return normalized.includes("failed to fetch")
        || normalized.includes("networkerror")
        || normalized.includes("load failed")
        || normalized.includes("all backends failed")
        || normalized.includes("fetch failed")
        || normalized.includes("operation was aborted")
        || normalized.includes("http 502")
        || normalized.includes("http 503")
        || normalized.includes("http 504");
};

const serviceLabel = (serviceName: string): string =>
    SERVICE_LABELS[serviceName] || serviceName.replace(/^noona-/, "").replace(/-/g, " ");

const serviceDescription = (serviceName: string, catalogByName: Record<string, ServiceCatalogEntry>): string =>
    normalizeString(catalogByName[serviceName]?.description).trim()
    || SERVICE_DESCRIPTIONS[serviceName]
    || "Monitoring service health.";

const prioritizeServices = (services: string[]): string[] =>
    [...services].sort((left, right) => {
        const leftPriority = UPDATE_PRIORITY_INDEX.get(left);
        const rightPriority = UPDATE_PRIORITY_INDEX.get(right);
        if (leftPriority != null && rightPriority != null) {
            return leftPriority - rightPriority;
        }
        if (leftPriority != null) return -1;
        if (rightPriority != null) return 1;
        return left.localeCompare(right);
    });

const buildMonitorEntry = (service: string, target: boolean): ServiceMonitorEntry => ({
    service,
    target,
    step: target ? "queued" : "monitoring",
    detail: target ? "Queued for update orchestration." : "Watching service health.",
    updated: false,
    restarted: false,
    error: null,
    attempts: 0,
    health: null,
});

const buildInitialMonitorState = (
    monitoredServices: string[],
    targetSet: Set<string>,
): Record<string, ServiceMonitorEntry> => {
    const out: Record<string, ServiceMonitorEntry> = {};
    for (const service of monitoredServices) {
        out[service] = buildMonitorEntry(service, targetSet.has(service));
    }
    return out;
};

const normalizeHealthStatus = (value: unknown): string => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return `HTTP ${Math.floor(value)}`;
    }
    const text = normalizeString(value).trim();
    return text || "Unknown";
};

const extractHealthDetail = (payload: ServiceHealthResponse | null | undefined): string => {
    if (typeof payload?.detail === "string" && payload.detail.trim()) {
        return summarizeDetail(payload.detail, {
            success: payload.success,
            supported: payload.supported,
        });
    }
    if (typeof payload?.error === "string" && payload.error.trim()) {
        return summarizeDetail(payload.error, {
            success: payload.success,
            supported: payload.supported,
        });
    }
    if (payload?.body && typeof payload.body === "object") {
        const record = payload.body as Record<string, unknown>;
        const detail = normalizeString(record.message).trim() || normalizeString(record.detail).trim();
        if (detail) {
            return summarizeDetail(detail, {
                success: payload.success,
                supported: payload.supported,
            });
        }
    }
    if (typeof payload?.body === "string" && payload.body.trim()) {
        return summarizeDetail(payload.body, {
            success: payload.success,
            supported: payload.supported,
        });
    }
    if (payload?.success === true) {
        return summarizeDetail("Healthy.", {success: true, supported: payload.supported});
    }
    if (payload?.supported === false) {
        return summarizeDetail("No health endpoint is defined for this service.", {
            success: payload.success,
            supported: false,
        });
    }
    return summarizeDetail("Waiting for a healthy response.", {
        success: payload?.success,
        supported: payload?.supported,
    });
};

const sectionBadge = (tone: SectionTone): BadgeBackground => {
    switch (tone) {
        case "success":
            return "success-alpha-weak";
        case "warning":
            return "warning-alpha-weak";
        default:
            return "neutral-alpha-weak";
    }
};

const sectionBorder = (tone: SectionTone): BadgeBackground => {
    switch (tone) {
        case "success":
            return "success-alpha-weak";
        case "warning":
            return "warning-alpha-weak";
        default:
            return "neutral-alpha-weak";
    }
};

const isControlPlaneReady = (states: Record<string, ServiceMonitorEntry>): boolean =>
    CORE_SERVICES.every((service) => states[service]?.health?.success === true);

const isTargetStable = (entry: ServiceMonitorEntry | undefined): boolean => {
    if (!entry || !entry.target) return true;
    if (entry.step === "failed") return true;
    if (entry.health?.success === true) return true;
    if (entry.health?.supported === false) {
        return entry.step === "current" || entry.step === "updated" || entry.step === "healthy";
    }
    return !entry.restarted && (entry.step === "current" || entry.step === "updated" || entry.step === "healthy");
};

const countTargetFailures = (states: Record<string, ServiceMonitorEntry>, services: string[]): number =>
    services.filter((service) => states[service]?.step === "failed").length;

const formatTimestamp = (value: number | null): string => {
    if (!value || !Number.isFinite(value)) return "Not yet";
    return new Date(value).toLocaleTimeString();
};

const phaseBadgeBackground = (phase: MonitorPhase): BadgeBackground => {
    switch (phase) {
        case "complete":
            return "success-alpha-weak";
        case "failed":
            return "danger-alpha-weak";
        case "waiting":
            return "warning-alpha-weak";
        default:
            return "brand-alpha-weak";
    }
};

const stepBadge = (entry: ServiceMonitorEntry): { label: string; background: BadgeBackground } => {
    switch (entry.step) {
        case "monitoring":
            return {label: "Watching", background: "neutral-alpha-weak"};
        case "queued":
            return {label: "Queued", background: "neutral-alpha-weak"};
        case "updating":
            return {label: "Updating", background: "brand-alpha-weak"};
        case "current":
            return {label: "Current", background: "neutral-alpha-weak"};
        case "updated":
            return {label: "Restarted", background: "brand-alpha-weak"};
        case "waiting":
            return {label: "Waiting", background: "warning-alpha-weak"};
        case "healthy":
            return {label: "Healthy", background: "success-alpha-weak"};
        case "failed":
            return {label: "Error", background: "danger-alpha-weak"};
        default:
            return {label: "Pending", background: "neutral-alpha-weak"};
    }
};

const healthBadge = (entry: ServiceMonitorEntry): { label: string; background: BadgeBackground } => {
    if (!entry.health) {
        return {label: "No probe yet", background: "neutral-alpha-weak"};
    }
    if (entry.health.success === true) {
        return {label: "Healthy", background: "success-alpha-weak"};
    }
    if (entry.health.supported === false) {
        return {label: "No probe", background: "neutral-alpha-weak"};
    }
    if (entry.health.success === false) {
        return {label: entry.target ? "Starting up" : "Unavailable", background: "warning-alpha-weak"};
    }
    return {label: "Checking", background: "neutral-alpha-weak"};
};

type RebootingPageProps = {
    servicesParam?: string | null;
    returnToParam?: string | null;
};

export function RebootingPage({servicesParam, returnToParam}: RebootingPageProps) {
    const targetServices = useMemo(
        () => prioritizeServices(parseServicesParam(servicesParam ?? null)),
        [servicesParam],
    );
    const targetSet = useMemo(() => new Set(targetServices), [targetServices]);
    const monitoredServices = useMemo(
        () => [...new Set<string>([...CORE_SERVICES, ...targetServices])],
        [targetServices],
    );
    const queueServices = useMemo(
        () => targetServices.filter((service) => !CORE_SERVICE_SET.has(service)),
        [targetServices],
    );
    const hasCoreTargets = useMemo(
        () => targetServices.some((service) => CORE_SERVICE_SET.has(service)),
        [targetServices],
    );
    const returnTo = useMemo(
        () => normalizeReturnTo(returnToParam ?? null),
        [returnToParam],
    );

    const [phase, setPhase] = useState<MonitorPhase>("preparing");
    const [phaseDetail, setPhaseDetail] = useState("Preparing reboot monitor...");
    const [catalogByName, setCatalogByName] = useState<Record<string, ServiceCatalogEntry>>({});
    const [serviceStates, setServiceStates] = useState<Record<string, ServiceMonitorEntry>>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [pageError, setPageError] = useState<string | null>(null);
    const [lastReachableAt, setLastReachableAt] = useState<number | null>(null);
    const [stableSuccessCount, setStableSuccessCount] = useState(0);

    const phaseRef = useRef<MonitorPhase>("preparing");
    const currentIndexRef = useRef(0);
    const stableSuccessCountRef = useRef(0);
    const runnerActiveRef = useRef(false);
    const startedRef = useRef(false);
    const serviceStatesRef = useRef<Record<string, ServiceMonitorEntry>>({});
    const monitorStartedAtRef = useRef(Date.now());

    const setPhaseState = (nextPhase: MonitorPhase, detail?: string) => {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
        if (typeof detail === "string") {
            setPhaseDetail(detail);
        }
    };

    const setStableState = (value: number) => {
        stableSuccessCountRef.current = value;
        setStableSuccessCount(value);
    };

    const patchServiceState = (
        service: string,
        updater: Partial<ServiceMonitorEntry> | ((current: ServiceMonitorEntry) => ServiceMonitorEntry),
    ) => {
        setServiceStates((prev) => {
            const current = prev[service] ?? buildMonitorEntry(service, targetSet.has(service));
            const nextEntry = typeof updater === "function"
                ? updater(current)
                : {
                    ...current,
                    ...updater,
                };
            const next = {
                ...prev,
                [service]: nextEntry,
            };
            serviceStatesRef.current = next;
            return next;
        });
    };

    useEffect(() => {
        const nextState = buildInitialMonitorState(monitoredServices, targetSet);
        setCatalogByName({});
        serviceStatesRef.current = nextState;
        setServiceStates(nextState);
        currentIndexRef.current = 0;
        setCurrentIndex(0);
        setStableState(0);
        monitorStartedAtRef.current = Date.now();
        runnerActiveRef.current = false;
        startedRef.current = false;

        if (targetServices.length > 0) {
            setPageError(null);
            setPhaseState("preparing", "Preparing reboot monitor...");
            return;
        }

        setPageError("No services were selected for reboot monitoring.");
        setPhaseState("failed", "No services were selected for reboot monitoring.");
    }, [monitoredServices, targetServices, targetSet]);

    const probeNowRef = useRef<() => Promise<boolean>>(async () => false);
    probeNowRef.current = async () => {
        try {
            const catalogRes = await fetch("/api/noona/services", {cache: "no-store"});
            const catalogJson = (await catalogRes.json().catch(() => null)) as ServiceCatalogResponse | null;
            if (!catalogRes.ok) {
                throw new Error(parseApiError(catalogJson, `Failed to load services (HTTP ${catalogRes.status}).`));
            }

            const services = Array.isArray(catalogJson?.services) ? catalogJson.services : [];
            const nextCatalog: Record<string, ServiceCatalogEntry> = {};
            for (const entry of services) {
                const name = normalizeString(entry?.name).trim();
                if (!name) continue;
                nextCatalog[name] = entry;
            }
            setCatalogByName(nextCatalog);
            setLastReachableAt(Date.now());

            const healthResults = await Promise.all(
                monitoredServices.filter((service) => service !== "noona-warden").map(async (service) => {
                    try {
                        const res = await fetch(`/api/noona/services/${encodeURIComponent(service)}/health`, {cache: "no-store"});
                        const json = (await res.json().catch(() => null)) as ServiceHealthResponse | null;
                        if (!res.ok) {
                            return {
                                service,
                                success: false,
                                supported: true,
                                detail: parseApiError(json, `Health check failed (HTTP ${res.status}).`),
                                status: `HTTP ${res.status}`,
                            };
                        }

                        return {
                            service,
                            success: json?.success === true,
                            supported: json?.supported !== false,
                            detail: extractHealthDetail(json),
                            status: normalizeHealthStatus(json?.status),
                        };
                    } catch (error_) {
                        const message = error_ instanceof Error ? error_.message : String(error_);
                        return {
                            service,
                            success: null,
                            supported: null,
                            detail: summarizeDetail(message),
                            status: "",
                        };
                    }
                }),
            );
            const normalizedHealthResults = monitoredServices.includes("noona-warden")
                ? [
                    {
                        service: "noona-warden",
                        success: true,
                        supported: true,
                        detail: "Moon can reach Warden and load the managed service catalog.",
                        status: "Connected",
                    },
                    ...healthResults,
                ]
                : healthResults;

            setServiceStates((prev) => {
                const next = {...prev};
                for (const result of normalizedHealthResults) {
                    const current = next[result.service] ?? buildMonitorEntry(result.service, targetSet.has(result.service));
                    next[result.service] = {
                        ...current,
                        step: current.step !== "failed" && current.target && result.success === true
                            ? "healthy"
                            : current.step,
                        health: {
                            success: result.success,
                            supported: result.supported,
                            detail: result.detail,
                            status: result.status,
                            checkedAt: Date.now(),
                        },
                    };
                }
                serviceStatesRef.current = next;
                return next;
            });

            return true;
        } catch {
            return false;
        }
    };

    const runUpdateQueueRef = useRef<() => Promise<void>>(async () => undefined);
    runUpdateQueueRef.current = async () => {
        if (runnerActiveRef.current || targetServices.length === 0) {
            return;
        }

        runnerActiveRef.current = true;
        try {
            setPhaseState("updating", "Applying updates and coordinating service restarts...");

            while (currentIndexRef.current < targetServices.length) {
                const serviceName = targetServices[currentIndexRef.current];
                const label = serviceLabel(serviceName);

                patchServiceState(serviceName, (current) => ({
                    ...current,
                    step: "updating",
                    detail: current.attempts > 0 ? `Retrying ${label} image update...` : `Updating ${label} image...`,
                    attempts: current.attempts + 1,
                    error: null,
                }));
                setPhaseDetail(`Updating ${label}...`);

                try {
                    const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(serviceName)}/update-image`, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({restart: true}),
                    });
                    const json = await res.json().catch(() => null);
                    if (!res.ok) {
                        const message = parseApiError(
                            json as { error?: unknown } | null,
                            `Failed to update ${serviceName} (HTTP ${res.status}).`,
                        );
                        if (shouldPauseForRecovery(message)) {
                            patchServiceState(serviceName, (current) => ({
                                ...current,
                                step: "waiting",
                                detail: `Lost contact while updating ${label}. Will retry once the stack is reachable again.`,
                                error: null,
                            }));
                            setStableState(0);
                            setPhaseState("waiting", `Lost contact while updating ${label}. Waiting for services to come back...`);
                            return;
                        }

                        patchServiceState(serviceName, (current) => ({
                            ...current,
                            step: "failed",
                            detail: message,
                            error: message,
                        }));
                        currentIndexRef.current += 1;
                        setCurrentIndex(currentIndexRef.current);
                        continue;
                    }

                    const payload = (json ?? {}) as { updated?: boolean; restarted?: boolean };
                    const updated = payload.updated === true;
                    const restarted = payload.restarted === true;

                    patchServiceState(serviceName, (current) => ({
                        ...current,
                        step: updated || restarted ? "updated" : "current",
                        detail: updated
                            ? restarted
                                ? `${label} updated. Waiting for health checks to settle.`
                                : `${label} image updated successfully.`
                            : `${label} is already on the latest image.`,
                        updated,
                        restarted,
                        error: null,
                    }));

                    currentIndexRef.current += 1;
                    setCurrentIndex(currentIndexRef.current);
                } catch (error_) {
                    const message = error_ instanceof Error ? error_.message : String(error_);
                    if (shouldPauseForRecovery(message)) {
                        patchServiceState(serviceName, (current) => ({
                            ...current,
                            step: "waiting",
                            detail: `The web UI lost contact while updating ${label}. Will retry when Moon is reachable again.`,
                            error: null,
                        }));
                        setStableState(0);
                        setPhaseState("waiting", `Lost contact while updating ${label}. Waiting for the stack to come back...`);
                        return;
                    }

                    patchServiceState(serviceName, (current) => ({
                        ...current,
                        step: "failed",
                        detail: message,
                        error: message,
                    }));
                    currentIndexRef.current += 1;
                    setCurrentIndex(currentIndexRef.current);
                }
            }

            setPhaseState("verifying", "Updates applied. Running health checks and waiting for stable services...");
        } finally {
            runnerActiveRef.current = false;
        }
    };

    useEffect(() => {
        if (targetServices.length === 0 || startedRef.current) {
            return;
        }
        startedRef.current = true;
        void runUpdateQueueRef.current();
    }, [targetServices]);

    useEffect(() => {
        if (targetServices.length === 0) {
            return;
        }

        let cancelled = false;
        let timer: number | null = null;

        const tick = async () => {
            if (cancelled) return;

            if (Date.now() - monitorStartedAtRef.current >= REBOOT_TIMEOUT_MS) {
                setPageError("Timed out waiting for Noona to finish rebooting.");
                setPhaseState("failed", "Timed out waiting for Noona to stabilize.");
                return;
            }

            const reachable = await probeNowRef.current();
            if (cancelled) return;

            if (!reachable) {
                if (phaseRef.current !== "complete" && phaseRef.current !== "failed") {
                    setStableState(0);
                    setPhaseState("waiting", "Lost contact with Moon. Waiting for the web UI to return...");
                }
            } else {
                const states = serviceStatesRef.current;
                const queueComplete = currentIndexRef.current >= targetServices.length;
                const controlPlaneReady = isControlPlaneReady(states);
                const targetsStable = targetServices.every((service) => isTargetStable(states[service]));

                if (!queueComplete) {
                    if (phaseRef.current === "waiting" && controlPlaneReady) {
                        setPhaseState("updating", "Control plane recovered. Resuming queued updates...");
                        void runUpdateQueueRef.current();
                    }
                } else if (controlPlaneReady && targetsStable) {
                    const nextStable = stableSuccessCountRef.current + 1;
                    setStableState(nextStable);
                    if (nextStable >= STABILITY_POLLS_REQUIRED) {
                        const failureCount = countTargetFailures(states, targetServices);
                        setPhaseState(
                            "complete",
                            failureCount > 0
                                ? "Reboot finished, but some services reported update errors. Review the list below."
                                : "Noona is back online. Health checks are stable.",
                        );
                    } else {
                        setPhaseState("verifying", "Services are responding. Verifying stability...");
                    }
                } else {
                    setStableState(0);
                    if (phaseRef.current !== "complete" && phaseRef.current !== "failed") {
                        setPhaseState("verifying", "Waiting for services to report healthy...");
                    }
                }
            }

            timer = window.setTimeout(() => {
                void tick();
            }, POLL_INTERVAL_MS);
        };

        void tick();
        return () => {
            cancelled = true;
            if (timer != null) {
                window.clearTimeout(timer);
            }
        };
    }, [monitoredServices, targetServices]);

    const healthyTargets = useMemo(
        () => targetServices.filter((service) => isTargetStable(serviceStates[service])).length,
        [serviceStates, targetServices],
    );
    const failedTargets = useMemo(
        () => countTargetFailures(serviceStates, targetServices),
        [serviceStates, targetServices],
    );
    const progressPercent = useMemo(() => {
        if (phase === "complete") return 100;
        if (targetServices.length === 0) return 0;
        const updateProgress = (currentIndex / targetServices.length) * 64;
        const healthProgress = (healthyTargets / targetServices.length) * 24;
        const phaseFloor = phase === "preparing"
            ? 8
            : phase === "waiting"
                ? 22
                : phase === "verifying"
                    ? 70
                    : 16;
        return clampPercent(Math.max(phaseFloor, 8 + updateProgress + healthProgress));
    }, [currentIndex, healthyTargets, phase, targetServices.length]);
    const progressBackground: ProgressBackground = phase === "failed"
        ? "danger-alpha-medium"
        : phase === "complete"
            ? "success-alpha-medium"
            : "brand-alpha-medium";
    const controlPlaneHealthy = isControlPlaneReady(serviceStates);
    const heroTone: SectionTone = phase === "complete"
        ? "success"
        : phase === "waiting" || failedTargets > 0
            ? "warning"
            : "neutral";
    const queueTone: SectionTone = failedTargets > 0
        ? "warning"
        : currentIndex >= targetServices.length && targetServices.length > 0
            ? "success"
            : "neutral";

    const renderMetricTile = (
        label: string,
        value: string,
        detail: string,
        tone: SectionTone = "neutral",
    ) => (
        <Card
            key={label}
            background="surface"
            border={sectionBorder(tone)}
            padding="m"
            radius="l"
            className={styles.metricTile}
        >
            <Column gap="4">
                <Text onBackground="neutral-weak" variant="label-default-xs">{label}</Text>
                <Heading as="h3" variant="heading-strong-m">{value}</Heading>
                <Text onBackground="neutral-weak" variant="body-default-xs" className={styles.secondaryDetail}>
                    {detail}
                </Text>
            </Column>
        </Card>
    );

    const renderServiceCard = (serviceName: string) => {
        const entry = serviceStates[serviceName] ?? buildMonitorEntry(serviceName, targetSet.has(serviceName));
        const step = stepBadge(entry);
        const health = healthBadge(entry);
        const healthDetail = entry.health?.detail || "Waiting for the next probe.";
        const healthStatus = entry.health?.status ? ` Status: ${entry.health.status}.` : "";

        return (
            <Card
                key={serviceName}
                fillWidth
                background="surface"
                border={entry.step === "failed"
                    ? "danger-alpha-weak"
                    : entry.health?.success === true
                        ? "success-alpha-weak"
                        : "neutral-alpha-weak"}
                padding="l"
                radius="l"
                className={styles.serviceCard}
            >
                <Column gap="12">
                    <Row horizontal="between" gap="12" className={styles.serviceHeader}>
                        <Column gap="4" className={styles.serviceTitleBlock}>
                            <Heading as="h3" variant="heading-strong-m">{serviceLabel(serviceName)}</Heading>
                            <Text onBackground="neutral-weak" variant="body-default-s"
                                  className={styles.secondaryDetail}>
                                {serviceDescription(serviceName, catalogByName)}
                            </Text>
                        </Column>
                        <Row gap="8" className={styles.badgeRow}>
                            <Badge background={step.background} onBackground="neutral-strong">{step.label}</Badge>
                            <Badge background={health.background} onBackground="neutral-strong">{health.label}</Badge>
                        </Row>
                    </Row>
                    <Text variant="body-default-s" className={styles.primaryDetail}>{entry.detail}</Text>
                    <Text onBackground="neutral-weak" variant="body-default-xs" className={styles.secondaryDetail}>
                        {healthDetail}
                        {healthStatus}
                        {entry.health?.checkedAt ? ` Last checked at ${formatTimestamp(entry.health.checkedAt)}.` : ""}
                    </Text>
                </Column>
            </Card>
        );
    };

    return (
        <Column fillWidth horizontal="center" gap="20" paddingY="24" className={styles.pageShell}>
            <Card
                fillWidth
                background="surface"
                border={phase === "failed"
                    ? "danger-alpha-weak"
                    : phase === "complete"
                        ? "success-alpha-weak"
                        : "neutral-alpha-weak"}
                padding="l"
                radius="l"
                className={styles.heroCard}
            >
                <Row fillWidth gap="24" className={styles.heroLayout}>
                    <Column horizontal="center" gap="12" className={styles.heroVisual}>
                        <Row fillWidth horizontal="center" className={styles.loaderStage}>
                            <Row className={styles.orbitShell} aria-hidden="true">
                                <Row className={styles.ringOuter}/>
                                <Row className={styles.ringMiddle}/>
                                <Row className={styles.ringInner}/>
                                <Row className={styles.core}/>
                                <Row className={`${styles.orb} ${styles.orbOne}`}/>
                                <Row className={`${styles.orb} ${styles.orbTwo}`}/>
                                <Row className={`${styles.orb} ${styles.orbThree}`}/>
                            </Row>
                        </Row>
                        <Badge background={phaseBadgeBackground(phase)} onBackground="neutral-strong">
                            {phase === "complete" ? "Stable" : phase === "failed" ? "Needs attention" : "Rebooting"}
                        </Badge>
                    </Column>

                    <Column fillWidth gap="20" className={styles.heroCopy}>
                        <Column gap="8">
                            <Heading variant="display-strong-s">Rebooting</Heading>
                            <Text variant="body-default-l" onBackground="neutral-weak" wrap="balance">
                                {phaseDetail}
                            </Text>
                        </Column>

                        <Column gap="8">
                            <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Text variant="body-default-s">Progress</Text>
                                <Text variant="body-default-xs" onBackground="neutral-weak">{progressPercent}%</Text>
                            </Row>
                            <Row
                                fillWidth
                                background="neutral-alpha-weak"
                                radius="m"
                                style={{height: "0.85rem", overflow: "hidden"}}
                            >
                                <Row
                                    background={progressBackground}
                                    style={{
                                        height: "100%",
                                        width: `${progressPercent}%`,
                                        transition: "width 320ms ease",
                                    }}
                                />
                            </Row>
                        </Column>

                        <Row fillWidth gap="12" className={styles.metricsGrid}>
                            {renderMetricTile(
                                "Updated",
                                `${Math.min(currentIndex, targetServices.length)}/${targetServices.length}`,
                                currentIndex >= targetServices.length
                                    ? "Queue finished."
                                    : "Image updates still in flight.",
                                queueTone,
                            )}
                            {renderMetricTile(
                                "Healthy",
                                `${healthyTargets}/${targetServices.length}`,
                                controlPlaneHealthy ? "Control plane is reachable." : "Waiting for stable health probes.",
                                controlPlaneHealthy ? "success" : "neutral",
                            )}
                            {renderMetricTile(
                                "Failures",
                                String(failedTargets),
                                failedTargets > 0 ? "At least one target needs review." : "No failed targets yet.",
                                failedTargets > 0 ? "warning" : "neutral",
                            )}
                            {renderMetricTile(
                                "Last contact",
                                formatTimestamp(lastReachableAt),
                                lastReachableAt ? "Last successful stack probe." : "No successful probe yet.",
                                lastReachableAt ? "success" : heroTone,
                            )}
                            {renderMetricTile(
                                "Stability",
                                `${stableSuccessCount}/${STABILITY_POLLS_REQUIRED}`,
                                "Consecutive healthy polls required before exit.",
                                stableSuccessCount > 0 ? "success" : "neutral",
                            )}
                        </Row>

                        {pageError && (
                            <Text onBackground="danger-strong" variant="body-default-s">{pageError}</Text>
                        )}

                        <Row gap="12" className={styles.actionRow}>
                            <Button variant="secondary" onClick={() => window.location.assign(returnTo)}>
                                Back to settings
                            </Button>
                            <Button variant="secondary" onClick={() => window.location.reload()}>
                                Reload page
                            </Button>
                            <Button
                                variant="primary"
                                disabled={phase !== "waiting" && phase !== "verifying"}
                                onClick={() => {
                                    void probeNowRef.current();
                                }}
                            >
                                Probe now
                            </Button>
                        </Row>
                    </Column>
                </Row>
            </Card>

            <Row fillWidth gap="20" className={styles.sectionGrid}>
                <Card
                    fillWidth
                    background="surface"
                    border={sectionBorder(controlPlaneHealthy ? "success" : "neutral")}
                    padding="l"
                    radius="l"
                    className={styles.sectionCard}
                >
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" className={styles.sectionHeader}>
                            <Heading as="h2" variant="heading-strong-l">Control Plane</Heading>
                            <Badge
                                background={sectionBadge(controlPlaneHealthy ? "success" : "neutral")}
                                onBackground="neutral-strong"
                            >
                                {CORE_SERVICES.length} services
                            </Badge>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            These services need to come back cleanly before the reboot monitor can resume or finish.
                        </Text>
                        <Column gap="12" className={styles.serviceStack}>
                            {CORE_SERVICES.map((serviceName) => renderServiceCard(serviceName))}
                        </Column>
                    </Column>
                </Card>

                <Card
                    fillWidth
                    background="surface"
                    border={sectionBorder(queueTone)}
                    padding="l"
                    radius="l"
                    className={styles.sectionCard}
                >
                    <Column gap="12">
                        <Row horizontal="between" vertical="center" gap="12" className={styles.sectionHeader}>
                            <Heading as="h2" variant="heading-strong-l">Update Queue</Heading>
                            <Badge background={sectionBadge(queueTone)} onBackground="neutral-strong">
                                {queueServices.length} queued
                            </Badge>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            Targeted services are updated one at a time, then health probes wait for a stable stack.
                        </Text>
                        {hasCoreTargets && (
                            <Text onBackground="neutral-weak" variant="body-default-xs"
                                  className={styles.secondaryDetail}>
                                Core targets such as Moon, Sage, and Vault are tracked in the Control Plane panel to
                                avoid
                                duplicate cards.
                            </Text>
                        )}
                        {queueServices.length > 0 ? (
                            <Column gap="12" className={styles.serviceStack}>
                                {queueServices.map((serviceName) => renderServiceCard(serviceName))}
                            </Column>
                        ) : (
                            <Column gap="8" vertical="center" className={styles.queueEmpty}>
                                <Text variant="body-default-s">No non-core services are waiting in the queue.</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    The remaining monitored targets are already represented in the Control Plane panel.
                                </Text>
                            </Column>
                        )}
                    </Column>
                </Card>
            </Row>
        </Column>
    );
}
