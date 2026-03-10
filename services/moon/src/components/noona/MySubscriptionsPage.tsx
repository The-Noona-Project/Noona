"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {AuthGate} from "./AuthGate";
import {SetupModeGate} from "./SetupModeGate";

type SubscriptionRecord = {
    id?: string | null;
    title?: string | null;
    titleQuery?: string | null;
    status?: string | null;
    subscribedAt?: string | null;
    unsubscribedAt?: string | null;
    sourceUrl?: string | null;
    subscriber?: {
        discordId?: string | null;
        tag?: string | null;
    } | null;
    notifications?: {
        chapterDmCount?: number | null;
        lastChapterDmAt?: string | null;
    } | null;
};

type MySubscriptionsResponse = {
    subscriptions?: SubscriptionRecord[] | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const parseErrorMessage = (payload: MySubscriptionsResponse | null, fallback: string): string => {
    const message = normalizeString(payload?.error);
    return message || fallback;
};

const normalizeStatus = (value: unknown): string => {
    const status = normalizeString(value).toLowerCase();
    return status || "unknown";
};

const statusBadgeBackground = (status: string) => {
    const normalized = normalizeStatus(status);
    if (normalized === "active") {
        return "success-alpha-medium" as const;
    }
    if (normalized === "inactive") {
        return "neutral-alpha-medium" as const;
    }
    return "neutral-alpha-weak" as const;
};

const formatTimestamp = (value: unknown): string | null => {
    const text = normalizeString(value);
    if (!text) {
        return null;
    }

    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) {
        return text;
    }

    return new Date(parsed).toLocaleString();
};

const resolveSubscriptionKey = (entry: SubscriptionRecord, index: number): string => {
    const id = normalizeString(entry.id);
    if (id) {
        return id;
    }
    const title = normalizeString(entry.title) || normalizeString(entry.titleQuery);
    return title ? `${title}:${index}` : `subscription:${index}`;
};

const resolveSortTimestamp = (value: unknown): number => {
    const iso = normalizeString(value);
    if (!iso) {
        return 0;
    }
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : 0;
};

const sortSubscriptions = (entries: SubscriptionRecord[]): SubscriptionRecord[] =>
    [...entries].sort((left, right) => {
        const leftActive = normalizeStatus(left.status) === "active";
        const rightActive = normalizeStatus(right.status) === "active";
        if (leftActive !== rightActive) {
            return leftActive ? -1 : 1;
        }

        const leftTimestamp = resolveSortTimestamp(left.subscribedAt);
        const rightTimestamp = resolveSortTimestamp(right.subscribedAt);
        if (leftTimestamp !== rightTimestamp) {
            return rightTimestamp - leftTimestamp;
        }

        const leftTitle = normalizeString(left.title) || normalizeString(left.titleQuery);
        const rightTitle = normalizeString(right.title) || normalizeString(right.titleQuery);
        return leftTitle.localeCompare(rightTitle);
    });

export function MySubscriptionsPage() {
    const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [unsubscribingById, setUnsubscribingById] = useState<Record<string, boolean>>({});

    const loadSubscriptions = async () => {
        setLoadError(null);
        setActionError(null);
        setActionMessage(null);
        setSubscriptions(null);

        try {
            const response = await fetch("/api/noona/mysubscriptions?limit=200", {cache: "no-store"});
            const payload = (await response.json().catch(() => null)) as MySubscriptionsResponse | null;
            if (!response.ok) {
                throw new Error(parseErrorMessage(payload, `Failed to load subscriptions (HTTP ${response.status}).`));
            }

            const records = Array.isArray(payload?.subscriptions) ? payload.subscriptions : [];
            setSubscriptions(sortSubscriptions(records));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLoadError(message);
        }
    };

    useEffect(() => {
        void loadSubscriptions();
    }, []);

    const unsubscribe = async (subscriptionId: string, label: string) => {
        const safeId = normalizeString(subscriptionId);
        if (!safeId) {
            return;
        }

        setActionError(null);
        setActionMessage(null);
        setUnsubscribingById((prev) => ({
            ...prev,
            [safeId]: true,
        }));

        try {
            const response = await fetch(`/api/noona/mysubscriptions/${encodeURIComponent(safeId)}`, {
                method: "DELETE",
            });
            const payload = (await response.json().catch(() => null)) as {
                subscription?: SubscriptionRecord | null;
                error?: string;
            } | null;
            if (!response.ok) {
                throw new Error(
                    normalizeString(payload?.error) || `Failed to unsubscribe from ${label} (HTTP ${response.status}).`,
                );
            }

            const updated = payload?.subscription && typeof payload.subscription === "object"
                ? payload.subscription
                : null;

            setSubscriptions((prev) => {
                const current = Array.isArray(prev) ? prev : [];
                const next = current.map((entry) => {
                    if (normalizeString(entry.id) !== safeId) {
                        return entry;
                    }

                    return {
                        ...entry,
                        ...(updated ?? {}),
                        status: normalizeString(updated?.status) || "inactive",
                    };
                });
                return sortSubscriptions(next);
            });

            setActionMessage(`Unsubscribed from ${label}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(message);
        } finally {
            setUnsubscribingById((prev) => {
                const next = {...prev};
                delete next[safeId];
                return next;
            });
        }
    };

    const rows = useMemo(
        () => (Array.isArray(subscriptions) ? subscriptions : []),
        [subscriptions],
    );

    return (
        <SetupModeGate>
            <AuthGate
                requiredPermission="mySubscriptions"
                deniedMessage="Subscriptions access requires My subscriptions permission."
            >
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    paddingX="16"
                    style={{maxWidth: "var(--moon-page-max-width, 116rem)"}}
                    m={{style: {paddingInline: "24px"}}}
                >
                    <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                My Subscriptions
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Manage the titles you subscribed to in Discord and stop chapter DM updates when needed.
                            </Text>
                        </Column>
                        <Button variant="primary" onClick={() => void loadSubscriptions()}>
                            Refresh
                        </Button>
                    </Row>

                    {loadError && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Heading as="h2" variant="heading-strong-l">
                                    Subscriptions unavailable
                                </Heading>
                                <Text>{loadError}</Text>
                            </Column>
                        </Card>
                    )}

                    {actionError && (
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="m" radius="l">
                            <Text>{actionError}</Text>
                        </Card>
                    )}

                    {actionMessage && (
                        <Card fillWidth background="surface" border="success-alpha-weak" padding="m" radius="l">
                            <Text>{actionMessage}</Text>
                        </Card>
                    )}

                    {!subscriptions && !loadError && (
                        <Row fillWidth horizontal="center" paddingY="64">
                            <Spinner/>
                        </Row>
                    )}

                    {subscriptions && rows.length === 0 && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Text>You do not have any title subscriptions yet.</Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Use Discord <Text as="span" onBackground="neutral-strong">/subscribe
                                    title:&lt;name&gt;</Text> to
                                    start getting chapter update DMs.
                                </Text>
                            </Column>
                        </Card>
                    )}

                    {subscriptions && rows.length > 0 && (
                        <Column fillWidth gap="12">
                            {rows.map((entry, index) => {
                                const id = normalizeString(entry.id);
                                const status = normalizeStatus(entry.status);
                                const title = normalizeString(entry.title) || normalizeString(entry.titleQuery) || "Untitled";
                                const sourceUrl = normalizeString(entry.sourceUrl);
                                const subscribedAt = formatTimestamp(entry.subscribedAt);
                                const unsubscribedAt = formatTimestamp(entry.unsubscribedAt);
                                const chapterDmCount = Number(entry.notifications?.chapterDmCount) || 0;
                                const lastChapterDmAt = formatTimestamp(entry.notifications?.lastChapterDmAt);
                                const unsubscribing = Boolean(id && unsubscribingById[id]);

                                return (
                                    <Card
                                        key={resolveSubscriptionKey(entry, index)}
                                        fillWidth
                                        background="surface"
                                        border="neutral-alpha-weak"
                                        padding="l"
                                        radius="l"
                                    >
                                        <Column gap="12">
                                            <Row fillWidth horizontal="between" vertical="center" gap="8"
                                                 s={{direction: "column"}}>
                                                <Heading as="h2" variant="heading-strong-m" wrap="balance">
                                                    {title}
                                                </Heading>
                                                <Badge background={statusBadgeBackground(status)}>
                                                    {status}
                                                </Badge>
                                            </Row>

                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                {subscribedAt && (
                                                    <Badge background="neutral-alpha-weak">
                                                        Subscribed {subscribedAt}
                                                    </Badge>
                                                )}
                                                <Badge background="neutral-alpha-weak">
                                                    Chapter DMs sent: {chapterDmCount}
                                                </Badge>
                                                {lastChapterDmAt && (
                                                    <Badge background="neutral-alpha-weak">
                                                        Last chapter DM: {lastChapterDmAt}
                                                    </Badge>
                                                )}
                                                {status !== "active" && unsubscribedAt && (
                                                    <Badge background="neutral-alpha-weak">
                                                        Unsubscribed {unsubscribedAt}
                                                    </Badge>
                                                )}
                                            </Row>

                                            {sourceUrl && (
                                                <Text>
                                                    Source: <SmartLink href={sourceUrl}>{sourceUrl}</SmartLink>
                                                </Text>
                                            )}

                                            {status === "active" && id && (
                                                <Row gap="8">
                                                    <Button
                                                        size="s"
                                                        variant="secondary"
                                                        onClick={() => void unsubscribe(id, title)}
                                                        loading={unsubscribing}
                                                        disabled={unsubscribing}
                                                    >
                                                        Unsubscribe
                                                    </Button>
                                                </Row>
                                            )}
                                        </Column>
                                    </Card>
                                );
                            })}
                        </Column>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}

export default MySubscriptionsPage;
