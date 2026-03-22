"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";
import {REBOOT_MONITOR_OPERATION_BOOT_START,} from "./rebootMonitorOperations.mjs";
import {buildRebootMonitorTargetKey, writeRebootMonitorSession,} from "./rebootMonitorSession";
import {normalizeBootScreenReturnTo, normalizeSetupStatus,} from "./setupStatus.mjs";

type SetupStatus = {
    completed: boolean;
    manualBootRequired: boolean;
    lifecycleServices: string[];
    selectionMode: string;
    error?: string;
};

const SERVICE_LABELS: Record<string, string> = {
    "noona-moon": "Moon",
    "noona-sage": "Sage",
    "noona-mongo": "Mongo",
    "noona-redis": "Redis",
    "noona-vault": "Vault",
    "noona-portal": "Portal",
    "noona-raven": "Raven",
    "noona-kavita": "Kavita",
    "noona-komf": "Komf",
};

const serviceLabel = (serviceName: string): string =>
    SERVICE_LABELS[serviceName] || serviceName.replace(/^noona-/, "").replace(/-/g, " ");

type Props = {
    returnToParam?: string | null;
};

export function BootScreenPage({returnToParam}: Props) {
    const router = useRouter();
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const returnTo = normalizeBootScreenReturnTo(returnToParam ?? null, "/");

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const payload = normalizeSetupStatus(await response.json().catch(() => null)) as SetupStatus;
                if (cancelled) return;

                if (!payload.completed) {
                    router.replace("/setupwizard");
                    return;
                }

                if (payload.manualBootRequired !== true) {
                    window.location.replace(new URL(returnTo, window.location.origin).toString());
                    return;
                }

                setStatus(payload);
            } catch (error_) {
                if (cancelled) return;
                const message = error_ instanceof Error ? error_.message : String(error_);
                setError(message || "Unable to load manual boot status.");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [returnTo, router]);

    const startEcosystem = async () => {
        if (starting || !status) {
            return;
        }

        setStarting(true);
        setError(null);

        try {
            const requestMetadata = {body: {}};
            const targetServices = status.lifecycleServices;
            const targetKey = buildRebootMonitorTargetKey(
                REBOOT_MONITOR_OPERATION_BOOT_START,
                targetServices,
                returnTo,
                requestMetadata,
            );

            writeRebootMonitorSession({
                operation: REBOOT_MONITOR_OPERATION_BOOT_START,
                targetServices,
                returnTo,
                requestMetadata,
                targetKey,
                phase: "preparing",
                phaseDetail: "Preparing lifecycle monitor...",
                currentIndex: 0,
                stableSuccessCount: 0,
                serviceStates: {},
                monitorStartedAt: Date.now(),
                updatedAt: Date.now(),
            });

            const params = new URLSearchParams({
                operation: REBOOT_MONITOR_OPERATION_BOOT_START,
                services: targetServices.join(","),
                returnTo,
            });
            window.location.assign(`/rebooting?${params.toString()}`);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message || "Unable to prepare the boot monitor.");
            setStarting(false);
        }
    };

    return (
        <Column maxWidth="m" horizontal="center" gap="20" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                Manual boot
                            </Badge>
                            <Heading as="h1" variant="heading-strong-l">
                                Start the saved ecosystem
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-s">
                            Setup is complete, but the saved Noona ecosystem is still in minimal mode. Start the
                            managed stack to continue.
                        </Text>
                    </Column>

                    {loading && (
                        <Row fillWidth horizontal="center" paddingY="20">
                            <Spinner/>
                        </Row>
                    )}

                    {!loading && status && (
                        <Column gap="16">
                            <Column gap="8">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Saved lifecycle target
                                </Text>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    {status.lifecycleServices.map((serviceName) => (
                                        <Badge key={serviceName} background="neutral-alpha-weak"
                                               onBackground="neutral-strong">
                                            {serviceLabel(serviceName)}
                                        </Badge>
                                    ))}
                                </Row>
                            </Column>

                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Moon will open the shared lifecycle monitor and wait for the selected services to come
                                back before returning to {returnTo}.
                            </Text>

                            <Row gap="12" style={{flexWrap: "wrap"}}>
                                <Button variant="primary" disabled={starting} onClick={() => void startEcosystem()}>
                                    {starting ? "Preparing..." : "Start ecosystem"}
                                </Button>
                                <Button variant="secondary" onClick={() => window.location.reload()}>
                                    Refresh status
                                </Button>
                            </Row>
                        </Column>
                    )}

                    {error && (
                        <Text onBackground="danger-strong" variant="body-default-xs">
                            {error}
                        </Text>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
