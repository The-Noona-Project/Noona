"use client";

import {usePathname, useRouter} from "next/navigation";
import {
    createContext,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {Badge, Button, Card, Column, Row, Text} from "@once-ui-system/core";
import {hasMoonPermission} from "@/utils/moonPermissions";
import {isMoonSignedInAppPath} from "./moonShellRoutes.mjs";
import {
    buildLiveNotificationStorageKey,
    buildRecommendationDecisionToast,
    buildSubscriptionUpdateToast,
    collectRecommendationDecisionChanges,
    collectSubscriptionNotificationChanges,
    createEmptyLiveNotificationSeenState,
    NOONA_OPEN_MUSIC_CONTROLS_EVENT,
    parseLiveNotificationSeenState,
} from "./siteNotificationLive.mjs";

export type SiteNotificationVariant = "info" | "success" | "warning" | "danger";
export type SiteNotificationAction =
    | { type: "href"; href: string }
    | { type: "event"; eventName: "noona:open-music-controls" };

type SiteNotificationInput = {
    title?: string | null;
    message: string;
    variant?: SiteNotificationVariant;
    durationMs?: number;
    dedupeKey?: string | null;
    action?: SiteNotificationAction | null;
    clickLabel?: string | null;
};

type SiteNotification = {
    id: string;
    title: string;
    message: string;
    variant: SiteNotificationVariant;
    durationMs: number;
    createdAt: number;
    dedupeKey: string | null;
    action: SiteNotificationAction | null;
    clickLabel: string | null;
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

type AuthStatusUser = {
    username?: string | null;
    discordUserId?: string | null;
    permissions?: string[] | null;
};

type AuthStatusResponse = {
    user?: AuthStatusUser | null;
    error?: string;
};

type RecommendationRecord = {
    id?: string | null;
    status?: string | null;
    title?: string | null;
    query?: string | null;
    approvedAt?: string | null;
    deniedAt?: string | null;
    lastActivityAt?: string | null;
};

type RecommendationsResponse = {
    recommendations?: RecommendationRecord[] | null;
    error?: string;
};

type SubscriptionRecord = {
    id?: string | null;
    title?: string | null;
    titleQuery?: string | null;
    titleUuid?: string | null;
    notifications?: {
        chapterDmCount?: number | null;
        lastChapterDmAt?: string | null;
    } | null;
};

type MySubscriptionsResponse = {
    subscriptions?: SubscriptionRecord[] | null;
    error?: string;
};

type LiveNotificationSeenState = {
    version: number;
    recommendations: {
        seeded: boolean;
        items: Record<string, string>;
    };
    subscriptions: {
        seeded: boolean;
        items: Record<string, { chapterDmCount: number; lastChapterDmAt: string }>;
    };
};

const SITE_NOTIFICATION_EVENT = "noona:site-notification";
const SITE_NOTIFICATION_POLL_INTERVAL_MS = 60_000;
const MAX_SITE_NOTIFICATIONS = 4;
const DEFAULT_NOTIFICATION_DURATION_MS = 7000;
const DECISION_NOTIFICATION_DURATION_MS = 9000;

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

const normalizeNotificationAction = (value: SiteNotificationInput["action"]): SiteNotificationAction | null => {
    if (!value || typeof value !== "object") {
        return null;
    }

    if (value.type === "href") {
        const href = normalizeString(value.href).trim();
        if (!href) {
            return null;
        }
        return {type: "href", href};
    }

    if (value.type === "event") {
        const eventName = normalizeString(value.eventName).trim();
        if (eventName !== NOONA_OPEN_MUSIC_CONTROLS_EVENT) {
            return null;
        }
        return {type: "event", eventName: NOONA_OPEN_MUSIC_CONTROLS_EVENT};
    }

    return null;
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
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [notifications, setNotifications] = useState<SiteNotification[]>([]);
    const timersRef = useRef<Map<string, number>>(new Map());
    const latestUpdateStateRef = useRef<Map<string, { updateAvailable: boolean; checkedAt: string }>>(new Map());
    const hasUpdateBaselineRef = useRef(false);
    const updatePollingBlockedRef = useRef(false);
    const updatePollInFlightRef = useRef(false);
    const livePollInFlightRef = useRef(false);
    const liveSeenStateMemoryRef = useRef<Map<string, LiveNotificationSeenState>>(new Map());
    const shouldRunSignedInPolling = isMoonSignedInAppPath(pathname);

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
        const action = normalizeNotificationAction(input?.action ?? null);
        const clickLabel = normalizeString(input?.clickLabel).trim() || null;

        const notification: SiteNotification = {
            id: buildNotificationId(),
            title,
            message,
            variant,
            durationMs,
            createdAt: Date.now(),
            dedupeKey,
            action,
            clickLabel,
        };

        setNotifications((current) => {
            if (dedupeKey && current.some((entry) => entry.dedupeKey === dedupeKey)) {
                return current;
            }
            return [...current, notification].slice(-MAX_SITE_NOTIFICATIONS);
        });
    }, []);

    const readLiveNotificationSeenState = useCallback((storageKey: string): LiveNotificationSeenState => {
        const inMemory = liveSeenStateMemoryRef.current.get(storageKey) ?? createEmptyLiveNotificationSeenState();

        try {
            const rawValue = window.localStorage.getItem(storageKey);
            const parsed = parseLiveNotificationSeenState(rawValue ?? inMemory) as LiveNotificationSeenState;
            liveSeenStateMemoryRef.current.set(storageKey, parsed);
            return parsed;
        } catch {
            const parsed = parseLiveNotificationSeenState(inMemory) as LiveNotificationSeenState;
            liveSeenStateMemoryRef.current.set(storageKey, parsed);
            return parsed;
        }
    }, []);

    const persistLiveNotificationSeenState = useCallback((storageKey: string, state: LiveNotificationSeenState) => {
        const normalized = parseLiveNotificationSeenState(state) as LiveNotificationSeenState;
        liveSeenStateMemoryRef.current.set(storageKey, normalized);

        try {
            window.localStorage.setItem(storageKey, JSON.stringify(normalized));
        } catch {
            // Keep the in-memory fallback for this session when localStorage is unavailable.
        }
    }, []);

    const runNotificationAction = useCallback((notification: SiteNotification) => {
        if (!notification.action) {
            return;
        }

        if (notification.action.type === "href") {
            router.push(notification.action.href);
        } else if (typeof window !== "undefined") {
            window.dispatchEvent(new Event(notification.action.eventName));
        }

        dismiss(notification.id);
    }, [dismiss, router]);

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
            if (
                disposed
                || updatePollInFlightRef.current
                || updatePollingBlockedRef.current
                || document.visibilityState !== "visible"
            ) {
                return;
            }

            updatePollInFlightRef.current = true;
            try {
                const response = await fetch("/api/noona/settings/services/updates", {cache: "no-store"});
                if (disposed) {
                    return;
                }

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

        if (!shouldRunSignedInPolling) {
            return () => {
                disposed = true;
            };
        }

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                void pollServiceUpdates();
            }
        };

        if (document.visibilityState === "visible") {
            void pollServiceUpdates();
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            void pollServiceUpdates();
        }, SITE_NOTIFICATION_POLL_INTERVAL_MS);

        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            disposed = true;
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [notify, shouldRunSignedInPolling]);

    useEffect(() => {
        let disposed = false;

        const pollLiveNotifications = async () => {
            if (disposed || livePollInFlightRef.current || document.visibilityState !== "visible") {
                return;
            }

            livePollInFlightRef.current = true;
            try {
                const authResponse = await fetch("/api/noona/auth/status", {cache: "no-store"});
                const authPayload = (await authResponse.json().catch(() => null)) as AuthStatusResponse | null;
                if (disposed || !authResponse.ok) {
                    return;
                }

                const user = authPayload?.user ?? null;
                const storageKey = buildLiveNotificationStorageKey({
                    discordUserId: normalizeString(user?.discordUserId),
                    username: normalizeString(user?.username),
                });
                if (!storageKey) {
                    return;
                }

                const canWatchRecommendations =
                    hasMoonPermission(user?.permissions, "myRecommendations")
                    || hasMoonPermission(user?.permissions, "manageRecommendations");
                const canWatchSubscriptions = hasMoonPermission(user?.permissions, "mySubscriptions");

                const [recommendationsResult, subscriptionsResult] = await Promise.all([
                    canWatchRecommendations
                        ? fetch("/api/noona/myrecommendations?limit=200", {cache: "no-store"})
                            .then(async (response) => ({
                                ok: response.ok,
                                payload: (await response.json().catch(() => null)) as RecommendationsResponse | null,
                            }))
                        : Promise.resolve(null),
                    canWatchSubscriptions
                        ? fetch("/api/noona/mysubscriptions?limit=200", {cache: "no-store"})
                            .then(async (response) => ({
                                ok: response.ok,
                                payload: (await response.json().catch(() => null)) as MySubscriptionsResponse | null,
                            }))
                        : Promise.resolve(null),
                ]);

                if (disposed) {
                    return;
                }

                const previousState = readLiveNotificationSeenState(storageKey);
                let nextState: LiveNotificationSeenState = {
                    version: previousState.version,
                    recommendations: {
                        seeded: previousState.recommendations.seeded,
                        items: {...previousState.recommendations.items},
                    },
                    subscriptions: {
                        seeded: previousState.subscriptions.seeded,
                        items: {...previousState.subscriptions.items},
                    },
                };
                let shouldPersist = false;

                if (recommendationsResult?.ok) {
                    const entries = Array.isArray(recommendationsResult.payload?.recommendations)
                        ? recommendationsResult.payload.recommendations
                        : [];
                    const {changes, nextItems} = collectRecommendationDecisionChanges(
                        entries,
                        previousState.recommendations.items,
                    ) as {
                        changes: Array<{ entry: RecommendationRecord }>;
                        nextItems: Record<string, string>;
                    };

                    if (previousState.recommendations.seeded) {
                        for (const change of changes) {
                            const toast = buildRecommendationDecisionToast(change.entry) as SiteNotificationInput | null;
                            if (!toast) {
                                continue;
                            }
                            notify({
                                ...toast,
                                durationMs: DECISION_NOTIFICATION_DURATION_MS,
                            });
                        }
                    }

                    nextState = {
                        ...nextState,
                        recommendations: {
                            seeded: true,
                            items: nextItems,
                        },
                    };
                    shouldPersist = true;
                }

                if (subscriptionsResult?.ok) {
                    const entries = Array.isArray(subscriptionsResult.payload?.subscriptions)
                        ? subscriptionsResult.payload.subscriptions
                        : [];
                    const {changes, nextItems} = collectSubscriptionNotificationChanges(
                        entries,
                        previousState.subscriptions.items,
                    ) as {
                        changes: Array<{ entry: SubscriptionRecord; deltaCount: number }>;
                        nextItems: Record<string, { chapterDmCount: number; lastChapterDmAt: string }>;
                    };

                    if (previousState.subscriptions.seeded) {
                        for (const change of changes) {
                            const toast = buildSubscriptionUpdateToast(
                                change.entry,
                                change.deltaCount,
                            ) as SiteNotificationInput | null;
                            if (!toast) {
                                continue;
                            }
                            notify(toast);
                        }
                    }

                    nextState = {
                        ...nextState,
                        subscriptions: {
                            seeded: true,
                            items: nextItems,
                        },
                    };
                    shouldPersist = true;
                }

                if (shouldPersist) {
                    persistLiveNotificationSeenState(storageKey, nextState);
                }
            } catch {
                // Ignore background polling errors; live notifications are best-effort.
            } finally {
                livePollInFlightRef.current = false;
            }
        };

        if (!shouldRunSignedInPolling) {
            return () => {
                disposed = true;
            };
        }

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                void pollLiveNotifications();
            }
        };

        if (document.visibilityState === "visible") {
            void pollLiveNotifications();
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            void pollLiveNotifications();
        }, SITE_NOTIFICATION_POLL_INTERVAL_MS);

        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            disposed = true;
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [
        notify,
        persistLiveNotificationSeenState,
        readLiveNotificationSeenState,
        shouldRunSignedInPolling,
    ]);

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
                {notifications.map((notification) => {
                    const interactive = notification.action != null;
                    const titleId = `site-notification-${notification.id}-title`;
                    const messageId = `site-notification-${notification.id}-message`;

                    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
                        if (!interactive) {
                            return;
                        }
                        if (event.key !== "Enter" && event.key !== " ") {
                            return;
                        }
                        event.preventDefault();
                        runNotificationAction(notification);
                    };

                    return (
                        <div
                            key={notification.id}
                            role={interactive ? "button" : "status"}
                            tabIndex={interactive ? 0 : undefined}
                            aria-label={interactive ? notification.clickLabel ?? undefined : undefined}
                            aria-describedby={interactive ? `${titleId} ${messageId}` : undefined}
                            aria-live={interactive ? undefined : "polite"}
                            onClick={interactive ? () => runNotificationAction(notification) : undefined}
                            onKeyDown={interactive ? handleKeyDown : undefined}
                            style={{
                                pointerEvents: "auto",
                                cursor: interactive ? "pointer" : "default",
                                outline: "none",
                            }}
                        >
                            <Card
                                fillWidth
                                background="surface"
                                border={BORDER_BY_VARIANT[notification.variant]}
                                padding="m"
                                radius="l"
                                style={{
                                    boxShadow: "0 0.5rem 1.25rem rgba(0, 0, 0, 0.18)",
                                }}
                            >
                                <Column gap="8">
                                    <Row horizontal="between" vertical="center" gap="8" style={{flexWrap: "wrap"}}>
                                        <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                            <Text
                                                id={titleId}
                                                variant="label-default-s"
                                                onBackground={TITLE_COLOR_BY_VARIANT[notification.variant]}
                                            >
                                                {notification.title}
                                            </Text>
                                            <Badge
                                                background={BADGE_BACKGROUND_BY_VARIANT[notification.variant]}
                                                onBackground="neutral-strong"
                                            >
                                                {notification.variant}
                                            </Badge>
                                        </Row>
                                        <Button
                                            size="s"
                                            variant="secondary"
                                            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                                                event.stopPropagation();
                                                dismiss(notification.id);
                                            }}
                                        >
                                            Dismiss
                                        </Button>
                                    </Row>
                                    <Text
                                        id={messageId}
                                        variant="body-default-xs"
                                        onBackground="neutral-weak"
                                        style={{whiteSpace: "pre-line"}}
                                    >
                                        {notification.message}
                                    </Text>
                                </Column>
                            </Card>
                        </div>
                    );
                })}
            </Column>
        </SiteNotificationContext.Provider>
    );
}
