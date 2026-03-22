"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, Text} from "@once-ui-system/core";
import {
    normalizeRebootMonitorOperation,
    REBOOT_MONITOR_OPERATION_UPDATE_SERVICES,
    resolveRebootMonitorMonitoredServices,
    resolveRebootMonitorRequest,
    resolveRebootMonitorRequiredServices,
} from "./rebootMonitorOperations.mjs";
import {
    buildRebootMonitorTargetKey,
    clearRebootMonitorSession,
    readRebootMonitorSession,
    writeRebootMonitorSession,
} from "./rebootMonitorSession";

type MonitorPhase = "preparing" | "updating" | "waiting" | "verifying" | "complete" | "failed";
type ServiceState = {
    service: string;
    target: boolean;
    step: "queued" | "monitoring" | "updating" | "requesting" | "waiting" | "healthy" | "current" | "updated" | "failed";
    detail: string;
    attempts: number;
    error: string | null;
    health?: {
        success: boolean | null;
        supported: boolean | null;
        running: boolean | null;
        detail: string;
        status: string;
        checkedAt: number | null
    };
};

type Props = { operationParam?: string | null; servicesParam?: string | null; returnToParam?: string | null };

const RETURN_TO_DEFAULT = "/settings/warden";
const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS = 12 * 60 * 1000;
const STABILITY_POLLS_REQUIRED = 2;
const LABELS: Record<string, string> = {
    "noona-warden": "Warden", "noona-sage": "Sage", "noona-moon": "Moon", "noona-mongo": "Mongo",
    "noona-redis": "Redis", "noona-vault": "Vault", "noona-portal": "Portal", "noona-raven": "Raven",
    "noona-kavita": "Kavita", "noona-komf": "Komf",
};

const s = (v: unknown) => typeof v === "string" ? v.trim() : "";
const list = (v: unknown) => Array.isArray(v) ? Array.from(new Set(v.map((x) => s(x)).filter(Boolean))) : [];
const parseServices = (v: string | null) => list(s(v).split(","));
const normalizeReturnTo = (v: string | null) => s(v).startsWith("/") ? s(v) : RETURN_TO_DEFAULT;
const label = (name: string) => LABELS[name] || name.replace(/^noona-/, "").replace(/-/g, " ");
const parseApiError = (payload: any, fallback: string) => s(payload?.error) || fallback;
const shouldPause = (message: string) => /failed to fetch|networkerror|load failed|all backends failed|fetch failed|http 50[234]|unauthorized/i.test(message);
const badge = (step: ServiceState["step"]) =>
    step === "healthy" ? ["Healthy", "success-alpha-weak"] as const :
        step === "failed" ? ["Error", "danger-alpha-weak"] as const :
            step === "waiting" ? ["Waiting", "warning-alpha-weak"] as const :
                step === "updating" || step === "requesting" || step === "updated" ? ["Working", "brand-alpha-weak"] as const :
                    [step === "monitoring" ? "Watching" : "Queued", "neutral-alpha-weak"] as const;

const isStable = (entry: ServiceState | undefined, operation: string) => {
    if (!entry || !entry.target) return true;
    if (entry.health?.success === true) return true;
    if (entry.health?.supported === false && entry.health?.running === true) return true;
    return normalizeRebootMonitorOperation(operation) === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES && entry.step === "failed";
};

const buildState = (services: string[], targets: Set<string>) => Object.fromEntries(
    services.map((service) => [service, {
        service,
        target: targets.has(service),
        step: targets.has(service) ? "queued" : "monitoring",
        detail: targets.has(service) ? "Waiting for lifecycle orchestration." : "Watching service health.",
        attempts: 0,
        error: null,
    } satisfies ServiceState]),
);

export function RebootingPage({operationParam, servicesParam, returnToParam}: Props) {
    const persisted = useMemo(() => readRebootMonitorSession(), []);
    const operation = useMemo(() => normalizeRebootMonitorOperation(operationParam ?? persisted?.operation ?? null), [operationParam, persisted?.operation]);
    const returnTo = useMemo(() => normalizeReturnTo(returnToParam ?? persisted?.returnTo ?? null), [persisted?.returnTo, returnToParam]);
    const targetServices = useMemo(() => {
        const fromQuery = parseServices(servicesParam ?? null);
        return fromQuery.length > 0 ? fromQuery : persisted?.targetServices ?? [];
    }, [persisted?.targetServices, servicesParam]);
    const matched = persisted
        && persisted.operation === operation
        && persisted.returnTo === returnTo
        && persisted.targetServices.join(",") === targetServices.join(",");
    const requestMetadata = matched ? persisted?.requestMetadata ?? null : null;
    const targetKey = useMemo(() => buildRebootMonitorTargetKey(operation, targetServices, returnTo, requestMetadata), [operation, requestMetadata, returnTo, targetServices]);
    const targetSet = useMemo(() => new Set(targetServices), [targetServices]);
    const requiredServices = useMemo(() => resolveRebootMonitorRequiredServices(targetServices), [targetServices]);
    const requiredSet = useMemo(() => new Set(requiredServices), [requiredServices]);
    const monitoredServices = useMemo(() => resolveRebootMonitorMonitoredServices(targetServices), [targetServices]);
    const secondaryServices = useMemo(() => targetServices.filter((name) => !requiredSet.has(name)), [requiredSet, targetServices]);
    const actionCount = operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES ? targetServices.length : 1;

    const [phase, setPhase] = useState<MonitorPhase>("preparing");
    const [phaseDetail, setPhaseDetail] = useState("Preparing lifecycle monitor...");
    const [states, setStates] = useState<Record<string, ServiceState>>({});
    const [catalog, setCatalog] = useState<Record<string, any>>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [pageError, setPageError] = useState<string | null>(null);
    const [lastReachableAt, setLastReachableAt] = useState<number | null>(null);
    const [stableCount, setStableCount] = useState(0);
    const [requestStarted, setRequestStarted] = useState(false);

    const phaseRef = useRef<MonitorPhase>("preparing");
    const statesRef = useRef<Record<string, ServiceState>>({});
    const currentIndexRef = useRef(0);
    const stableCountRef = useRef(0);
    const startedRef = useRef(false);
    const requestStartedRef = useRef(false);
    const startedAtRef = useRef(Date.now());
    const runnerRef = useRef(false);

    const patchState = (service: string, update: Partial<ServiceState>) => setStates((prev) => {
        const next = {...prev, [service]: {...(prev[service] || buildState([service], targetSet)[service]), ...update}};
        statesRef.current = next;
        return next;
    });
    const setPhaseState = (next: MonitorPhase, detail: string) => {
        phaseRef.current = next;
        setPhase(next);
        setPhaseDetail(detail);
    };

    useEffect(() => {
        const restored = matched ? persisted : null;
        const next = restored?.serviceStates && typeof restored.serviceStates === "object"
            ? restored.serviceStates as Record<string, ServiceState>
            : buildState(monitoredServices, targetSet);
        statesRef.current = next;
        setStates(next);
        currentIndexRef.current = Math.max(0, Math.min(actionCount, Number(restored?.currentIndex) || 0));
        stableCountRef.current = Math.max(0, Number(restored?.stableSuccessCount) || 0);
        requestStartedRef.current = restored?.requestStarted === true;
        startedAtRef.current = Number(restored?.monitorStartedAt) > 0 ? Number(restored?.monitorStartedAt) : Date.now();
        startedRef.current = restored?.requestStarted === true;
        runnerRef.current = false;
        phaseRef.current = (s(restored?.phase) as MonitorPhase) || "preparing";
        setPhase(phaseRef.current);
        setPhaseDetail(s(restored?.phaseDetail) || "Preparing lifecycle monitor...");
        setCurrentIndex(currentIndexRef.current);
        setStableCount(stableCountRef.current);
        setRequestStarted(requestStartedRef.current);
        setPageError(s(restored?.pageError) || (targetServices.length === 0 ? "No services were selected for lifecycle monitoring." : null));
        setLastReachableAt(Number(restored?.lastReachableAt) > 0 ? Number(restored?.lastReachableAt) : null);
    }, [actionCount, matched, monitoredServices, persisted, targetServices.length, targetSet]);

    useEffect(() => {
        if (targetServices.length === 0) return;
        writeRebootMonitorSession({
            operation, targetServices, returnTo, requestMetadata, requestStarted, targetKey, phase, phaseDetail,
            currentIndex, pageError, lastReachableAt, stableSuccessCount: stableCount, serviceStates: states,
            monitorStartedAt: startedAtRef.current, updatedAt: Date.now(),
        });
    }, [currentIndex, lastReachableAt, operation, pageError, phase, phaseDetail, requestMetadata, requestStarted, returnTo, stableCount, states, targetKey, targetServices]);

    const probeNow = async () => {
        try {
            const serviceRes = await fetch("/api/noona/services", {cache: "no-store"});
            const payload = await serviceRes.json().catch(() => null);
            if (!serviceRes.ok) throw new Error(parseApiError(payload, `Failed to load services (HTTP ${serviceRes.status}).`));
            const byName = Object.fromEntries((Array.isArray(payload?.services) ? payload.services : []).map((entry: any) => [s(entry?.name), entry]));
            setCatalog(byName);
            setLastReachableAt(Date.now());

            const results = await Promise.all(monitoredServices.filter((name) => name !== "noona-warden").map(async (name) => {
                const running = byName[name]?.running === true;
                try {
                    const res = await fetch(`/api/noona/services/${encodeURIComponent(name)}/health`, {cache: "no-store"});
                    const json = await res.json().catch(() => null);
                    if (!res.ok && res.status === 404) return {
                        name,
                        success: running,
                        supported: false,
                        running,
                        detail: running ? "Running without a dedicated health endpoint." : "No health endpoint is defined.",
                        status: running ? "Running" : "Not running"
                    };
                    if (!res.ok) return {
                        name,
                        success: false,
                        supported: true,
                        running,
                        detail: parseApiError(json, `Health check failed (HTTP ${res.status}).`),
                        status: `HTTP ${res.status}`
                    };
                    const supported = json?.supported !== false;
                    return {
                        name,
                        success: supported ? json?.success === true : running,
                        supported,
                        running,
                        detail: s(json?.detail) || (supported ? "Waiting for a healthy response." : "Running without a dedicated health endpoint."),
                        status: s(json?.status) || (running ? "Running" : "Unknown")
                    };
                } catch (error) {
                    return {
                        name,
                        success: false,
                        supported: null,
                        running,
                        detail: error instanceof Error ? error.message : String(error),
                        status: running ? "Running" : "Unknown"
                    };
                }
            }));

            const next = {...statesRef.current};
            next["noona-warden"] = {
                ...(next["noona-warden"] || buildState(["noona-warden"], targetSet)["noona-warden"]),
                health: {
                    success: true,
                    supported: true,
                    running: true,
                    detail: "Warden is reachable through Moon.",
                    status: "Connected",
                    checkedAt: Date.now()
                },
                step: next["noona-warden"]?.target ? "healthy" : next["noona-warden"]?.step || "monitoring"
            };
            for (const result of results) {
                const current = next[result.name] || buildState([result.name], targetSet)[result.name];
                next[result.name] = {
                    ...current,
                    health: {...result, checkedAt: Date.now()},
                    step: current.step !== "failed" && current.target && result.success ? "healthy" : current.step
                };
            }
            statesRef.current = next;
            setStates(next);
            return true;
        } catch {
            return false;
        }
    };

    const runMonitorAction = async () => {
        if (runnerRef.current || targetServices.length === 0) return;
        runnerRef.current = true;
        try {
            if (operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES) {
                setPhaseState("updating", "Applying updates and coordinating service restarts...");
                while (currentIndexRef.current < targetServices.length) {
                    const name = targetServices[currentIndexRef.current];
                    patchState(name, {
                        step: "updating",
                        detail: `Updating ${label(name)}...`,
                        attempts: (statesRef.current[name]?.attempts || 0) + 1,
                        error: null
                    });
                    try {
                        const res = await fetch(`/api/noona/settings/services/${encodeURIComponent(name)}/update-image`, {
                            method: "POST",
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({restart: true})
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) {
                            const message = parseApiError(json, `Failed to update ${name}.`);
                            if (shouldPause(message)) {
                                patchState(name, {
                                    step: "waiting",
                                    detail: `Lost contact while updating ${label(name)}.`
                                });
                                setPhaseState("waiting", `Lost contact while updating ${label(name)}.`);
                                return;
                            }
                            patchState(name, {step: "failed", detail: message, error: message});
                        } else {
                            patchState(name, {
                                step: json?.updated === true || json?.restarted === true ? "updated" : "current",
                                detail: json?.updated === true ? `${label(name)} updated.` : `${label(name)} is already current.`
                            });
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        if (shouldPause(message)) {
                            patchState(name, {step: "waiting", detail: `Lost contact while updating ${label(name)}.`});
                            setPhaseState("waiting", `Lost contact while updating ${label(name)}.`);
                            return;
                        }
                        patchState(name, {step: "failed", detail: message, error: message});
                    }
                    currentIndexRef.current += 1;
                    setCurrentIndex(currentIndexRef.current);
                }
                setPhaseState("verifying", "Updates applied. Waiting for stable services...");
                return;
            }

            if (requestStartedRef.current) return;
            const request = resolveRebootMonitorRequest(operation, requestMetadata ?? {});
            if (!request) {
                setPageError("No lifecycle request is defined for this monitor operation.");
                setPhaseState("failed", "No lifecycle request is defined for this monitor operation.");
                return;
            }
            requestStartedRef.current = true;
            setRequestStarted(true);
            currentIndexRef.current = 1;
            setCurrentIndex(1);
            setPhaseState("updating", operation === "ecosystem-restart" ? "Sending ecosystem restart request..." : "Sending ecosystem start request...");
            targetServices.forEach((name) => patchState(name, {
                step: "requesting",
                detail: "Waiting for lifecycle orchestration..."
            }));
            try {
                const res = await fetch(request.path, {
                    method: request.method,
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(request.body ?? {})
                });
                const json = await res.json().catch(() => null);
                if (!res.ok) {
                    const message = parseApiError(json, `Lifecycle request failed (HTTP ${res.status}).`);
                    if (shouldPause(message)) {
                        setPhaseState("waiting", "Lost contact after sending the lifecycle request.");
                        return;
                    }
                    targetServices.forEach((name) => patchState(name, {
                        step: "failed",
                        detail: message,
                        error: message
                    }));
                    setPageError(message);
                    setPhaseState("failed", message);
                    return;
                }
                targetServices.forEach((name) => patchState(name, {
                    step: "waiting",
                    detail: "Lifecycle request sent. Waiting for health checks..."
                }));
                setPhaseState("verifying", "Lifecycle request sent. Waiting for stable services...");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (shouldPause(message)) {
                    setPhaseState("waiting", "Lost contact after sending the lifecycle request.");
                    return;
                }
                targetServices.forEach((name) => patchState(name, {step: "failed", detail: message, error: message}));
                setPageError(message);
                setPhaseState("failed", message);
            }
        } finally {
            runnerRef.current = false;
        }
    };

    useEffect(() => {
        if (targetServices.length === 0 || phaseRef.current === "complete" || phaseRef.current === "failed") return;
        if (operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES) {
            if (phaseRef.current !== "waiting" && currentIndexRef.current < actionCount) void runMonitorAction();
        } else if (!startedRef.current) {
            startedRef.current = true;
            void runMonitorAction();
        }
    }, [actionCount, operation, targetServices]);

    useEffect(() => {
        if (targetServices.length === 0) return;
        let cancelled = false;
        let timer: number | null = null;
        const tick = async () => {
            if (cancelled || phaseRef.current === "complete" || phaseRef.current === "failed") return;
            if (Date.now() - startedAtRef.current >= TIMEOUT_MS) {
                setPageError("Timed out waiting for Noona to stabilize.");
                setPhaseState("failed", "Timed out waiting for Noona to stabilize.");
                return;
            }
            const reachable = await probeNow();
            if (cancelled) return;
            if (!reachable) {
                stableCountRef.current = 0;
                setStableCount(0);
                setPhaseState("waiting", "Lost contact with Moon. Waiting for the web UI to return...");
            } else {
                const requiredReady = requiredServices.every((name) => isStable(statesRef.current[name], operation));
                const targetsReady = targetServices.every((name) => isStable(statesRef.current[name], operation));
                const actionDone = currentIndexRef.current >= actionCount;
                if (operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES && !actionDone && phaseRef.current === "waiting" && requiredReady) {
                    setPhaseState("updating", "Required services recovered. Resuming update queue...");
                    void runMonitorAction();
                } else if (requiredReady && targetsReady && actionDone) {
                    stableCountRef.current += 1;
                    setStableCount(stableCountRef.current);
                    setPhaseState(stableCountRef.current >= STABILITY_POLLS_REQUIRED ? "complete" : "verifying", stableCountRef.current >= STABILITY_POLLS_REQUIRED ? "Noona is back online. Health checks are stable." : "Services are responding. Verifying stability...");
                } else {
                    stableCountRef.current = 0;
                    setStableCount(0);
                    setPhaseState("verifying", "Waiting for services to report healthy...");
                }
            }
            timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        };
        void tick();
        return () => {
            cancelled = true;
            if (timer != null) window.clearTimeout(timer);
        };
    }, [actionCount, operation, requiredServices, targetServices]);

    const healthyTargets = targetServices.filter((name) => isStable(states[name], operation)).length;
    const failures = targetServices.filter((name) => states[name]?.step === "failed").length;
    const progress = phase === "complete" ? 100 : Math.max(8, Math.min(100, Math.round((Math.min(currentIndex, actionCount) / Math.max(actionCount, 1)) * 64 + (healthyTargets / Math.max(targetServices.length, 1)) * 24 + (phase === "verifying" ? 12 : phase === "waiting" ? 14 : 8))));
    const queueTitle = operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES ? "Update Queue" : "Lifecycle Target";
    const render = (name: string) => {
        const entry = states[name];
        const [text, tone] = badge(entry?.step || "queued");
        return <Card key={name} fillWidth background="surface"
                     border={entry?.step === "failed" ? "danger-alpha-weak" : entry?.health?.success ? "success-alpha-weak" : "neutral-alpha-weak"}
                     padding="l" radius="l"><Column gap="8"><Row horizontal="between" vertical="center" gap="12"
                                                                 style={{flexWrap: "wrap"}}><Heading as="h3"
                                                                                                     variant="heading-strong-m">{label(name)}</Heading><Row
            gap="8"><Badge background={tone} onBackground="neutral-strong">{text}</Badge><Badge
            background={entry?.health?.success ? "success-alpha-weak" : entry?.health?.supported === false && entry?.health?.running ? "success-alpha-weak" : "neutral-alpha-weak"}
            onBackground="neutral-strong">{entry?.health?.success ? "Healthy" : entry?.health?.supported === false ? (entry?.health?.running ? "Running" : "No probe") : "Checking"}</Badge></Row></Row><Text
            variant="body-default-s">{entry?.detail || "Waiting for lifecycle monitoring."}</Text><Text
            onBackground="neutral-weak"
            variant="body-default-xs">{entry?.health?.detail || "Waiting for the next health probe."}{entry?.health?.status ? ` Status: ${entry.health.status}.` : ""}{entry?.health?.checkedAt ? ` Last checked at ${new Date(entry.health.checkedAt).toLocaleTimeString()}.` : ""}</Text></Column></Card>;
    };

    return <Column fillWidth horizontal="center" gap="20" paddingY="24"><Card fillWidth background="surface"
                                                                              border={phase === "failed" ? "danger-alpha-weak" : phase === "complete" ? "success-alpha-weak" : "neutral-alpha-weak"}
                                                                              padding="l" radius="l"
                                                                              style={{maxWidth: "96rem"}}><Column
        gap="20"><Column gap="8"><Row gap="8" vertical="center" style={{flexWrap: "wrap"}}><Badge
        background={phase === "complete" ? "success-alpha-weak" : phase === "failed" ? "danger-alpha-weak" : "brand-alpha-weak"}
        onBackground="neutral-strong">{phase === "complete" ? "Stable" : phase === "failed" ? "Needs attention" : "Monitoring"}</Badge><Heading
        variant="display-strong-s">{operation === "ecosystem-restart" ? "Restarting ecosystem" : operation === "ecosystem-start" || operation === "boot-start" ? "Starting ecosystem" : "Rebooting"}</Heading></Row><Text
        variant="body-default-l" onBackground="neutral-weak">{phaseDetail}</Text></Column><Column gap="8"><Row
        horizontal="between" vertical="center"><Text variant="body-default-s">Progress</Text><Text
        variant="body-default-xs" onBackground="neutral-weak">{progress}%</Text></Row><Row fillWidth
                                                                                           background="neutral-alpha-weak"
                                                                                           radius="m" style={{
        height: "0.85rem",
        overflow: "hidden"
    }}><Row
        background={phase === "failed" ? "danger-alpha-medium" : phase === "complete" ? "success-alpha-medium" : "brand-alpha-medium"}
        style={{height: "100%", width: `${progress}%`, transition: "width 320ms ease"}}/></Row></Column><Row gap="12"
                                                                                                             style={{
                                                                                                                 display: "grid",
                                                                                                                 gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))"
                                                                                                             }}><Card
        background="surface" border="neutral-alpha-weak" padding="m" radius="l"><Column gap="4"><Text
        onBackground="neutral-weak"
        variant="label-default-xs">{operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES ? "Updated" : "Operation"}</Text><Heading
        as="h3" variant="heading-strong-m">{`${Math.min(currentIndex, actionCount)}/${actionCount}`}</Heading><Text
        onBackground="neutral-weak"
        variant="body-default-xs">{operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES ? "Queue progress." : requestStarted ? "Lifecycle request sent." : "Lifecycle request pending."}</Text></Column></Card><Card
        background="surface" border="neutral-alpha-weak" padding="m" radius="l"><Column gap="4"><Text
        onBackground="neutral-weak" variant="label-default-xs">Healthy</Text><Heading as="h3"
                                                                                      variant="heading-strong-m">{`${healthyTargets}/${targetServices.length}`}</Heading><Text
        onBackground="neutral-weak" variant="body-default-xs">Target services reporting stable
        health.</Text></Column></Card><Card background="surface"
                                            border={failures > 0 ? "warning-alpha-weak" : "neutral-alpha-weak"}
                                            padding="m" radius="l"><Column gap="4"><Text onBackground="neutral-weak"
                                                                                         variant="label-default-xs">Failures</Text><Heading
        as="h3" variant="heading-strong-m">{String(failures)}</Heading><Text onBackground="neutral-weak"
                                                                             variant="body-default-xs">Targets that
        reported action errors.</Text></Column></Card><Card background="surface" border="neutral-alpha-weak" padding="m"
                                                            radius="l"><Column gap="4"><Text onBackground="neutral-weak"
                                                                                             variant="label-default-xs">Last
        contact</Text><Heading as="h3"
                               variant="heading-strong-m">{lastReachableAt ? new Date(lastReachableAt).toLocaleTimeString() : "Not yet"}</Heading><Text
        onBackground="neutral-weak" variant="body-default-xs">Last successful stack probe.</Text></Column></Card><Card
        background="surface" border="neutral-alpha-weak" padding="m" radius="l"><Column gap="4"><Text
        onBackground="neutral-weak" variant="label-default-xs">Stability</Text><Heading as="h3"
                                                                                        variant="heading-strong-m">{`${stableCount}/${STABILITY_POLLS_REQUIRED}`}</Heading><Text
        onBackground="neutral-weak" variant="body-default-xs">Consecutive healthy polls required.</Text></Column></Card></Row>{pageError &&
        <Text onBackground="danger-strong" variant="body-default-s">{pageError}</Text>}<Row gap="12"
                                                                                            style={{flexWrap: "wrap"}}><Button
        variant="secondary" onClick={() => {
        clearRebootMonitorSession();
        window.location.assign(returnTo);
    }}>{phase === "complete" ? "Continue" : "Back"}</Button><Button variant="secondary"
                                                                    onClick={() => window.location.reload()}>Reload
        page</Button><Button variant="primary" disabled={phase === "failed" || phase === "complete"} onClick={() => {
        void probeNow();
    }}>Probe now</Button></Row></Column></Card><Row fillWidth gap="20" style={{
        width: "100%",
        maxWidth: "96rem",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(24rem, 1fr))"
    }}><Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l"><Column gap="12"><Row
        horizontal="between" vertical="center" style={{flexWrap: "wrap"}}><Heading as="h2" variant="heading-strong-l">Required
        services</Heading><Badge background="neutral-alpha-weak"
                                 onBackground="neutral-strong">{requiredServices.length} services</Badge></Row><Text
        onBackground="neutral-weak" variant="body-default-s">Warden, Sage, and Moon must recover first. Mongo, Redis,
        and Vault are also required when they are part of the requested lifecycle target.</Text><Column
        gap="12">{requiredServices.map(render)}</Column></Column></Card><Card fillWidth background="surface"
                                                                              border="neutral-alpha-weak" padding="l"
                                                                              radius="l"><Column gap="12"><Row
        horizontal="between" vertical="center" style={{flexWrap: "wrap"}}><Heading as="h2"
                                                                                   variant="heading-strong-l">{queueTitle}</Heading><Badge
        background="neutral-alpha-weak"
        onBackground="neutral-strong">{secondaryServices.length} services</Badge></Row><Text onBackground="neutral-weak"
                                                                                             variant="body-default-s">{operation === REBOOT_MONITOR_OPERATION_UPDATE_SERVICES ? "Targeted services are updated one at a time, then health probes wait for a stable stack." : "These selected services still need to return alongside the required control plane."}</Text>{secondaryServices.length > 0 ?
        <Column gap="12">{secondaryServices.map(render)}</Column> :
        <Text onBackground="neutral-weak" variant="body-default-xs">All requested targets are already represented in the
            required-services panel.</Text>}</Column></Card></Row></Column>;
}
