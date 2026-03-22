"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";
import {
    REBOOT_MONITOR_OPERATION_BOOT_START,
    resolveRebootMonitorRequiredServices,
} from "./rebootMonitorOperations.mjs";
import {buildRebootMonitorTargetKey, writeRebootMonitorSession,} from "./rebootMonitorSession";
import {describeReturnTarget} from "./rebootMonitorUi.mjs";
import {normalizeBootScreenReturnTo, normalizeSetupStatus,} from "./setupStatus.mjs";

type SetupStatus = {
    completed: boolean;
    manualBootRequired: boolean;
    lifecycleServices: string[];
    selectionMode: string;
    error?: string;
};

const SERVICE_LABELS: Record<string, string> = {
    "noona-warden": "Warden",
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
    const returnTargetLabel = describeReturnTarget(returnTo);
    const lifecycleServices = status?.lifecycleServices ?? [];
    const requiredServices = resolveRebootMonitorRequiredServices(lifecycleServices);
    const requiredServiceSet = new Set(requiredServices);
    const selectedServices = lifecycleServices.filter((serviceName) => !requiredServiceSet.has(serviceName));

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
        <Column fillWidth horizontal="center" gap="20" paddingY="32" paddingX="20" style={{width: "100%"}}>
            <Card
                fillWidth
                background="surface"
                border="neutral-alpha-weak"
                padding="l"
                radius="l"
                style={{
                    maxWidth: "80rem",
                    background: "linear-gradient(145deg, rgba(8,16,36,0.97) 0%, rgba(15,30,68,0.93) 60%, rgba(28,48,96,0.88) 100%)",
                }}
            >
                <Column gap="24">
                    <Row
                        gap="20"
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))",
                            alignItems: "stretch",
                        }}
                    >
                        <Column gap="12">
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
                                managed stack to bring the rest of your services back online.
                            </Text>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Moon will open the shared lifecycle monitor, watch the control plane recover, and then
                                send you back to {returnTargetLabel}.
                            </Text>

                            {!loading && status ? (
                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                    <Button variant="primary" disabled={starting} onClick={() => void startEcosystem()}>
                                        {starting ? "Preparing..." : "Start saved ecosystem"}
                                    </Button>
                                    <Button variant="secondary" onClick={() => window.location.reload()}>
                                        Refresh status
                                    </Button>
                                </Row>
                            ) : null}
                        </Column>

                        <Card background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Startup snapshot
                                </Text>
                                <Heading as="h2" variant="heading-strong-l">{returnTargetLabel}</Heading>
                                <Text onBackground="neutral-weak" variant="body-default-s">
                                    {loading
                                        ? "Checking the saved lifecycle selection now."
                                        : `${lifecycleServices.length} saved services are queued for recovery through the shared reboot monitor.`}
                                </Text>
                                {!loading && status ? (
                                    <Row
                                        gap="12"
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
                                        }}
                                    >
                                        <Card background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                            <Column gap={4}>
                                                <Text onBackground="neutral-weak"
                                                      variant="label-default-xs">Selection</Text>
                                                <Heading as="h3" variant="heading-strong-m">
                                                    {status.selectionMode === "selected" ? "Saved set" : "Minimal"}
                                                </Heading>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">Persisted
                                                    boot profile.</Text>
                                            </Column>
                                        </Card>
                                        <Card background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                            <Column gap={4}>
                                                <Text onBackground="neutral-weak"
                                                      variant="label-default-xs">Targets</Text>
                                                <Heading as="h3"
                                                         variant="heading-strong-m">{String(lifecycleServices.length)}</Heading>
                                                <Text onBackground="neutral-weak" variant="body-default-xs">Services in
                                                    this startup.</Text>
                                            </Column>
                                        </Card>
                                    </Row>
                                ) : null}
                            </Column>
                        </Card>
                    </Row>

                    {loading ? (
                        <Column gap={10}>
                            <Row fillWidth horizontal="center" paddingY="20">
                                <Spinner/>
                            </Row>
                            <Text onBackground="neutral-weak" variant="body-default-xs" style={{textAlign: "center"}}>
                                Loading the saved lifecycle target and boot requirements.
                            </Text>
                        </Column>
                    ) : null}

                    {!loading && status ? (
                        <>
                            <Row
                                gap="12"
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
                                }}
                            >
                                <Card background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                    <Column gap={6}>
                                        <Text onBackground="neutral-weak" variant="label-default-xs">Step 1</Text>
                                        <Heading as="h3" variant="heading-strong-m">Send start request</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Moon asks Sage and Warden to start the saved ecosystem.
                                        </Text>
                                    </Column>
                                </Card>
                                <Card background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                    <Column gap={6}>
                                        <Text onBackground="neutral-weak" variant="label-default-xs">Step 2</Text>
                                        <Heading as="h3" variant="heading-strong-m">Watch recovery</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            The reboot monitor waits for Warden, Sage, Moon, and the selected services
                                            to stabilize.
                                        </Text>
                                    </Column>
                                </Card>
                                <Card background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                                    <Column gap={6}>
                                        <Text onBackground="neutral-weak" variant="label-default-xs">Step 3</Text>
                                        <Heading as="h3" variant="heading-strong-m">Return you</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Once the stack is stable, continue back to {returnTargetLabel}.
                                        </Text>
                                    </Column>
                                </Card>
                            </Row>

                            <Row
                                gap="20"
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))",
                                }}
                            >
                                <Card background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                    <Column gap={10}>
                                        <Heading as="h2" variant="heading-strong-l">Returns first</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-s">
                                            These services are required before the rest of the saved stack can be
                                            considered healthy.
                                        </Text>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            {requiredServices.map((serviceName) => (
                                                <Badge key={serviceName} background="neutral-alpha-weak"
                                                       onBackground="neutral-strong">
                                                    {serviceLabel(serviceName)}
                                                </Badge>
                                            ))}
                                        </Row>
                                    </Column>
                                </Card>

                                <Card background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                    <Column gap={10}>
                                        <Heading as="h2" variant="heading-strong-l">Saved target</Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-s">
                                            These are the additional services from your saved setup selection that Moon
                                            will wait on.
                                        </Text>
                                        {selectedServices.length > 0 ? (
                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                {selectedServices.map((serviceName) => (
                                                    <Badge key={serviceName} background="brand-alpha-weak"
                                                           onBackground="neutral-strong">
                                                        {serviceLabel(serviceName)}
                                                    </Badge>
                                                ))}
                                            </Row>
                                        ) : (
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                No extra managed services are pending beyond the required recovery set.
                                            </Text>
                                        )}
                                    </Column>
                                </Card>
                            </Row>
                        </>
                    ) : null}

                    {error ? (
                        <Text onBackground="danger-strong" variant="body-default-xs">
                            {error}
                        </Text>
                    ) : null}
                </Column>
            </Card>
        </Column>
    );
}
