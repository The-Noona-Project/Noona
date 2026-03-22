import {normalizeRebootMonitorOperation} from "./rebootMonitorOperations.mjs";

const REBOOT_MONITOR_SESSION_STORAGE_KEY = "noona:reboot-monitor";
const REBOOT_MONITOR_UPDATE_PRIORITY = [
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
const REBOOT_MONITOR_UPDATE_PRIORITY_INDEX = new Map<string, number>(
    REBOOT_MONITOR_UPDATE_PRIORITY.map((service, index) => [service, index]),
);

type RebootMonitorPersistedSessionInput = {
    operation?: string;
    targetServices: string[];
    returnTo: string;
    targetKey: string;
    requestMetadata?: Record<string, unknown> | null;
    requestStarted?: boolean;
    phase?: string;
    phaseDetail?: string;
    currentIndex?: number;
    pageError?: string | null;
    lastReachableAt?: number | null;
    stableSuccessCount?: number;
    serviceStates?: Record<string, unknown>;
    monitorStartedAt?: number;
    updatedAt?: number;
};

export type RebootMonitorPersistedSession = {
    operation: string;
    targetServices: string[];
    returnTo: string;
    targetKey: string;
    requestMetadata: Record<string, unknown> | null;
    requestStarted: boolean;
    phase: string;
    phaseDetail: string;
    currentIndex: number;
    pageError: string | null;
    lastReachableAt: number | null;
    stableSuccessCount: number;
    serviceStates: Record<string, unknown>;
    monitorStartedAt: number;
    updatedAt: number;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeNumber = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};
const normalizeRequestMetadata = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

const normalizeServiceList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of value) {
        const normalized = normalizeString(entry);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        out.push(normalized);
    }

    return out;
};

export const prioritizeRebootMonitorServices = (services: string[]): string[] =>
    normalizeServiceList(services).sort((left, right) => {
        const leftPriority = REBOOT_MONITOR_UPDATE_PRIORITY_INDEX.get(left);
        const rightPriority = REBOOT_MONITOR_UPDATE_PRIORITY_INDEX.get(right);
        if (leftPriority != null && rightPriority != null) {
            return leftPriority - rightPriority;
        }
        if (leftPriority != null) return -1;
        if (rightPriority != null) return 1;
        return left.localeCompare(right);
    });

const orderRebootMonitorServices = (operation: string, services: string[]): string[] =>
    normalizeRebootMonitorOperation(operation) === "update-services"
        ? prioritizeRebootMonitorServices(services)
        : normalizeServiceList(services);

export const buildRebootMonitorTargetKey = (
    operation: string,
    targetServices: string[],
    returnTo: string,
    requestMetadata: Record<string, unknown> | null = null,
): string => {
    const services = orderRebootMonitorServices(operation, targetServices);
    const requestKey = requestMetadata ? JSON.stringify(requestMetadata) : "";
    return [
        normalizeRebootMonitorOperation(operation),
        services.join(","),
        normalizeString(returnTo) || "/settings/warden",
        requestKey,
    ].join("::");
};

const isBrowser = (): boolean => typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

export const readRebootMonitorSession = (): RebootMonitorPersistedSession | null => {
    if (!isBrowser()) {
        return null;
    }

    try {
        const raw = window.sessionStorage.getItem(REBOOT_MONITOR_SESSION_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as RebootMonitorPersistedSessionInput | null;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        const operation = normalizeRebootMonitorOperation(parsed.operation);
        const targetServices = orderRebootMonitorServices(operation, parsed.targetServices);
        const returnTo = normalizeString(parsed.returnTo) || "/settings/warden";
        const requestMetadata = normalizeRequestMetadata(parsed.requestMetadata);
        const targetKey =
            normalizeString(parsed.targetKey)
            || buildRebootMonitorTargetKey(operation, targetServices, returnTo, requestMetadata);
        if (targetServices.length === 0 || !targetKey) {
            return null;
        }

        const currentIndex = normalizeNumber(parsed.currentIndex);
        const lastReachableAt = normalizeNumber(parsed.lastReachableAt);
        const stableSuccessCount = normalizeNumber(parsed.stableSuccessCount);
        const monitorStartedAt = normalizeNumber(parsed.monitorStartedAt);
        const updatedAt = normalizeNumber(parsed.updatedAt);
        const serviceStates =
            parsed.serviceStates && typeof parsed.serviceStates === "object"
                ? parsed.serviceStates
                : {};

        return {
            operation,
            targetServices,
            returnTo,
            targetKey,
            requestMetadata,
            requestStarted: parsed.requestStarted === true,
            phase: normalizeString(parsed.phase) || "preparing",
            phaseDetail: normalizeString(parsed.phaseDetail) || "Preparing reboot monitor...",
            currentIndex: Math.max(0, Math.floor(currentIndex ?? 0)),
            pageError: normalizeString(parsed.pageError) || null,
            lastReachableAt: lastReachableAt != null ? lastReachableAt : null,
            stableSuccessCount: Math.max(0, Math.floor(stableSuccessCount ?? 0)),
            serviceStates,
            monitorStartedAt: monitorStartedAt ?? Date.now(),
            updatedAt: updatedAt ?? Date.now(),
        };
    } catch {
        return null;
    }
};

export const writeRebootMonitorSession = (session: RebootMonitorPersistedSessionInput): void => {
    if (!isBrowser()) {
        return;
    }

    const operation = normalizeRebootMonitorOperation(session.operation);
    const targetServices = orderRebootMonitorServices(operation, session.targetServices);
    const returnTo = normalizeString(session.returnTo) || "/settings/warden";
    if (targetServices.length === 0) {
        clearRebootMonitorSession();
        return;
    }

    const requestMetadata = normalizeRequestMetadata(session.requestMetadata);
    const targetKey =
        normalizeString(session.targetKey)
        || buildRebootMonitorTargetKey(operation, targetServices, returnTo, requestMetadata);
    const payload: RebootMonitorPersistedSession = {
        operation,
        targetServices,
        returnTo,
        targetKey,
        requestMetadata,
        requestStarted: session.requestStarted === true,
        phase: normalizeString(session.phase) || "preparing",
        phaseDetail: normalizeString(session.phaseDetail) || "Preparing reboot monitor...",
        currentIndex: Math.max(0, Math.floor(normalizeNumber(session.currentIndex) ?? 0)),
        pageError: normalizeString(session.pageError) || null,
        lastReachableAt: normalizeNumber(session.lastReachableAt),
        stableSuccessCount: Math.max(0, Math.floor(normalizeNumber(session.stableSuccessCount) ?? 0)),
        serviceStates:
            session.serviceStates && typeof session.serviceStates === "object"
                ? session.serviceStates
                : {},
        monitorStartedAt: normalizeNumber(session.monitorStartedAt) ?? Date.now(),
        updatedAt: normalizeNumber(session.updatedAt) ?? Date.now(),
    };

    try {
        window.sessionStorage.setItem(REBOOT_MONITOR_SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage write failures so the reboot monitor can continue in-memory.
    }
};

export const clearRebootMonitorSession = (): void => {
    if (!isBrowser()) {
        return;
    }

    try {
        window.sessionStorage.removeItem(REBOOT_MONITOR_SESSION_STORAGE_KEY);
    } catch {
        // Ignore storage cleanup failures.
    }
};
