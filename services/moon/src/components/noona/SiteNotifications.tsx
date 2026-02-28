"use client";

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Badge, Button, Card, Column, Row, Text} from "@once-ui-system/core";

export type SiteNotificationVariant = "info" | "success" | "warning" | "danger";

type SiteNotificationInput = {
    title?: string | null;
    message: string;
    variant?: SiteNotificationVariant;
    durationMs?: number;
    dedupeKey?: string | null;
};

type SiteNotification = {
    id: string;
    title: string;
    message: string;
    variant: SiteNotificationVariant;
    durationMs: number;
    createdAt: number;
    dedupeKey: string | null;
};

type SiteNotificationContextValue = {
    notify: (input: SiteNotificationInput) => void;
    dismiss: (id: string) => void;
};

type ServiceUpdateSnapshot = {
    service?: string | null;
    checkedAt?: string | null;
    updateAvailable?: boolean;
    installed?: boolean;
    supported?: boolean;
};

const SITE_NOTIFICATION_EVENT = "noona:site-notification";
const UPDATE_POLL_INTERVAL_MS = 60_000;
const MAX_SITE_NOTIFICATIONS = 4;
const DEFAULT_NOTIFICATION_DURATION_MS = 7000;

const SiteNotificationContext = createContext<SiteNotificationContextValue | null>(null);

const BORDER_BY_VARIANT = {
    info: "neutral-alpha-weak",
    success: "success-alpha-weak",
    warning: "warning-alpha-weak",
    danger: "danger-alpha-weak",
} as const;

const BADGE_BACKGROUND_BY_VARIANT = {
    info: "neutral-alpha-weak",
    success: "success-alpha-weak",
    warning: "warning-alpha-weak",
    danger: "danger-alpha-weak",
} as const;

const TITLE_COLOR_BY_VARIANT = {
    info: "neutral-strong",
    success: "success-strong",
    warning: "warning-strong",
    danger: "danger-strong",
} as const;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const buildNotificationId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const defaultTitleForVariant = (variant: SiteNotificationVariant): string => {
    if (variant === "success") return "Success";
    if (variant === "warning") return "Warning";
    if (variant === "danger") return "Error";
    return "Notice";
};

const toServiceUpdateSnapshots = (value: unknown): ServiceUpdateSnapshot[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((entry) => entry && typeof entry === "object") as ServiceUpdateSnapshot[];
};

const formatUpdateFoundMessage = (services: string[]): string => {
    if (services.length === 1) {
        return `${services[0]} has a new image update available.`;
    }
    return `${services.length} services have new image updates available.`;
};

export const emitNoonaSiteNotification = (input: SiteNotificationInput): void => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<SiteNotificationInput>(SITE_NOTIFICATION_EVENT, {detail: input}));
};

export const useSiteNotifications = (): SiteNotificationContextValue => {
    const context = useContext(SiteNotificationContext);
    if (!context) {
        throw new Error("useSiteNotifications must be used inside NoonaSiteNotificationsProvider.");
    }
    return context;
};

export function NoonaSiteNotificationsProvider({children}: { children: React.ReactNode }) {
    const [notifications, setNotifications] = useState<SiteNotification[]>([]);
    const timersRef = useRef<Map<string, number>>(new Map());
    const latestUpdateStateRef = useRef<Map<string, { updateAvailable: boolean; checkedAt: string }>>(new Map());
    const hasUpdateBaselineRef = useRef(false);
    const updatePollingBlockedRef = useRef(false);
    const updatePollInFlightRef = useRef(false);

    const dismiss = useCallback((id: string) => {
        setNotifications((current) => current.filter((entry) => entry.id !== id));
        const timeoutId = timersRef.current.get(id);
        if (timeoutId != null) {
            window.clearTimeout(timeoutId);
            timersRef.current.delete(id);
        }
    }, []);

    const notify = useCallback((input: SiteNotificationInput) => {
        const message = normalizeString(input?.message).trim();
        if (!message) return;

        const rawVariant = normalizeString(input?.variant).trim();
        const variant: SiteNotificationVariant =
            rawVariant === "success" || rawVariant === "warning" || rawVariant === "danger"
                ? rawVariant
                : "info";
        const title = normalizeString(input?.title).trim() || defaultTitleForVariant(variant);
        const rawDuration = Number(input?.durationMs);
        const durationMs =
            Number.isFinite(rawDuration) && rawDuration >= 1000
                ? Math.floor(rawDuration)
                : DEFAULT_NOTIFICATION_DURATION_MS;
        const dedupeKey = normalizeString(input?.dedupeKey).trim() || null;

        const notification: SiteNotification = {
            id: buildNotificationId(),
            title,
            message,
            variant,
            durationMs,
            createdAt: Date.now(),
            dedupeKey,
        };

        setNotifications((current) => {
            if (dedupeKey && current.some((entry) => entry.dedupeKey === dedupeKey)) {
                return current;
            }
            return [...current, notification].slice(-MAX_SITE_NOTIFICATIONS);
        });
    }, []);

    useEffect(() => {
        const activeIds = new Set(notifications.map((entry) => entry.id));

        for (const notification of notifications) {
            if (timersRef.current.has(notification.id)) {
                continue;
            }

            const timeoutId = window.setTimeout(() => {
                dismiss(notification.id);
            }, notification.durationMs);

            timersRef.current.set(notification.id, timeoutId);
        }

        for (const [id, timeoutId] of timersRef.current.entries()) {
            if (activeIds.has(id)) {
                continue;
            }
            window.clearTimeout(timeoutId);
            timersRef.current.delete(id);
        }
    }, [notifications, dismiss]);

    useEffect(() => () => {
        for (const timeoutId of timersRef.current.values()) {
            window.clearTimeout(timeoutId);
        }
        timersRef.current.clear();
    }, []);

    useEffect(() => {
        const handleNotification = (event: Event) => {
            const custom = event as CustomEvent<SiteNotificationInput>;
            if (!custom.detail || typeof custom.detail !== "object") {
                return;
            }
            notify(custom.detail);
        };

        window.addEventListener(SITE_NOTIFICATION_EVENT, handleNotification as EventListener);
        return () => {
            window.removeEventListener(SITE_NOTIFICATION_EVENT, handleNotification as EventListener);
        };
    }, [notify]);

    useEffect(() => {
        let disposed = false;

        const pollServiceUpdates = async () => {
            if (disposed || updatePollInFlightRef.current || updatePollingBlockedRef.current) {
                return;
            }

            updatePollInFlightRef.current = true;
            try {
                const response = await fetch("/api/noona/settings/services/updates", {cache: "no-store"});

                if (response.status === 401 || response.status === 403) {
                    updatePollingBlockedRef.current = true;
                    return;
                }

                if (!response.ok) {
                    return;
                }

                const payload = (await response.json().catch(() => null)) as { updates?: unknown } | null;
                const snapshots = toServiceUpdateSnapshots(payload?.updates);
                const nextState = new Map<string, { updateAvailable: boolean; checkedAt: string }>();
                const newlyAvailable = new Set<string>();

                for (const snapshot of snapshots) {
                    const service = normalizeString(snapshot.service).trim();
                    if (!service) continue;

                    const checkedAt = normalizeString(snapshot.checkedAt).trim();
                    const updateAvailable =
                        snapshot.installed === true &&
                        snapshot.supported !== false &&
                        snapshot.updateAvailable === true;
                    nextState.set(service, {updateAvailable, checkedAt});

                    if (!hasUpdateBaselineRef.current) {
                        continue;
                    }

                    const previous = latestUpdateStateRef.current.get(service);
                    if (!previous) {
                        if (updateAvailable && checkedAt) {
                            newlyAvailable.add(service);
                        }
                        continue;
                    }

                    const hasNewCheck = checkedAt.length > 0 && checkedAt !== previous.checkedAt;
                    if (hasNewCheck && !previous.updateAvailable && updateAvailable) {
                        newlyAvailable.add(service);
                    }
                }

                latestUpdateStateRef.current = nextState;

                if (!hasUpdateBaselineRef.current) {
                    hasUpdateBaselineRef.current = true;
                    return;
                }

                if (newlyAvailable.size > 0) {
                    const services = Array.from(newlyAvailable).sort((left, right) => left.localeCompare(right));
                    const signature = services
                        .map((service) => `${service}:${nextState.get(service)?.checkedAt ?? ""}`)
                        .join("|");

                    notify({
                        variant: "warning",
                        title: "Update available",
                        message: formatUpdateFoundMessage(services),
                        durationMs: 9000,
                        dedupeKey: `update-found:${signature}`,
                    });
                }
            } catch {
                // Ignore background polling errors; updater notifications are best-effort.
            } finally {
                updatePollInFlightRef.current = false;
            }
        };

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                void pollServiceUpdates();
            }
        };

        void pollServiceUpdates();
        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            void pollServiceUpdates();
        }, UPDATE_POLL_INTERVAL_MS);

        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            disposed = true;
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [notify]);

    const contextValue = useMemo(() => ({notify, dismiss}), [notify, dismiss]);

    return (
        <SiteNotificationContext.Provider value={contextValue}>
            {children}
            <Column
                position="fixed"
                top="16"
                right="16"
                zIndex={10}
                gap="8"
                style={{
                    width: "min(24rem, calc(100vw - 2rem))",
                    pointerEvents: "none",
                }}
                aria-live="polite"
            >
                {notifications.map((notification) => (
                    <Card
                        key={notification.id}
                        fillWidth
                        background="surface"
                        border={BORDER_BY_VARIANT[notification.variant]}
                        padding="m"
                        radius="l"
                        style={{
                            pointerEvents: "auto",
                            boxShadow: "0 0.5rem 1.25rem rgba(0, 0, 0, 0.18)",
                        }}
                        role="status"
                        aria-live="polite"
                    >
                        <Column gap="8">
                            <Row horizontal="between" vertical="center" gap="8" style={{flexWrap: "wrap"}}>
                                <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                    <Text variant="label-default-s"
                                          onBackground={TITLE_COLOR_BY_VARIANT[notification.variant]}>
                                        {notification.title}
                                    </Text>
                                    <Badge
                                        background={BADGE_BACKGROUND_BY_VARIANT[notification.variant]}
                                        onBackground="neutral-strong"
                                    >
                                        {notification.variant}
                                    </Badge>
                                </Row>
                                <Button size="s" variant="secondary" onClick={() => dismiss(notification.id)}>
                                    Dismiss
                                </Button>
                            </Row>
                            <Text variant="body-default-xs" onBackground="neutral-weak">
                                {notification.message}
                            </Text>
                        </Column>
                    </Card>
                ))}
            </Column>
        </SiteNotificationContext.Provider>
    );
}
