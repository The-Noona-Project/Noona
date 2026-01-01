import { useCallback, useEffect, useMemo, useState } from 'react';

import ActionModal from './components/ActionModal';
import CollapsibleSection from './components/CollapsibleSection';
import LogPanel from './components/LogPanel';
import ServiceSelect, { ALL_SERVICES_OPTION } from './components/ServiceSelect';
import { formatJSON } from './utils/formatters';
import { ServicesResponse, StreamEntry } from './types';

const SERVICES_ENDPOINT = '/api/services?includeStopped=true';
const LOG_LIMIT = 500;

const extractServiceNames = (services: ServicesResponse['services']): string[] => {
    if (!Array.isArray(services)) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const service of services) {
        const candidate =
            typeof service === 'string'
                ? service
                : typeof (service as { name?: string })?.name === 'string'
                  ? (service as { name: string }).name
                  : typeof (service as { id?: string })?.id === 'string'
                    ? (service as { id: string }).id
                    : undefined;
        if (!candidate) continue;
        const normalized = candidate.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        names.push(normalized);
    }
    return names;
};

const resolveServicesPayload = (selection: string[]): 'all' | string[] | undefined => {
    if (!selection.length) {
        return undefined;
    }
    if (selection.includes(ALL_SERVICES_OPTION)) {
        return 'all';
    }
    return selection;
};

const safeParseJSON = (value: string): unknown => {
    if (!value.trim()) return null;
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Invalid JSON payload: ${(error as Error).message}`);
    }
};

const useLogBuffer = () => {
    const [entries, setEntries] = useState<StreamEntry[]>([]);

    const append = useCallback((entry: StreamEntry) => {
        setEntries((current) => {
            const next = [...current, entry];
            if (next.length > LOG_LIMIT) {
                return next.slice(next.length - LOG_LIMIT);
            }
            return next;
        });
    }, []);

    const reset = useCallback((action: string) => {
        setEntries([{ action, type: 'start', message: 'Request dispatched' }]);
    }, []);

    return { entries, append, reset };
};

const getStatusClass = (status?: string): string => {
    if (!status) return 'status-pill status-info';
    const normalized = status.toLowerCase();
    if (['ok', 'healthy', 'running', 'ready'].includes(normalized)) return 'status-pill status-ok';
    if (['warn', 'warning', 'partial'].includes(normalized)) return 'status-pill status-warn';
    if (['error', 'failed', 'unavailable', 'stopped'].includes(normalized)) return 'status-pill status-error';
    return 'status-pill status-info';
};

type ActionSurface = 'build' | 'push' | 'pull' | 'clean';

const App = () => {
    const [availableServices, setAvailableServices] = useState<string[]>([]);
    const [servicesCatalog, setServicesCatalog] = useState<ServicesResponse | null>(null);
    const [servicesStatus, setServicesStatus] = useState<'idle' | 'ok' | 'warn' | 'error'>('idle');
    const [servicesOutput, setServicesOutput] = useState('Click “Refresh status” to load deployment information.');
    const [settingsOutput, setSettingsOutput] = useState('Settings output will appear here.');
    const [settingsJson, setSettingsJson] = useState('{}');
    const [hostDockerSocket, setHostDockerSocket] = useState('');
    const [buildSelection, setBuildSelection] = useState<string[]>([]);
    const [registrySelection, setRegistrySelection] = useState<string[]>([]);
    const [startSelection, setStartSelection] = useState<string[]>([]);
    const [cleanSelection, setCleanSelection] = useState<string[]>([]);
    const [buildUseNoCache, setBuildUseNoCache] = useState(false);
    const [buildConcurrency, setBuildConcurrency] = useState('');
    const [startDebugLevel, setStartDebugLevel] = useState('auto');
    const [startBootMode, setStartBootMode] = useState('standard');
    const [startBindSocket, setStartBindSocket] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [servicesLoading, setServicesLoading] = useState(false);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [activeAction, setActiveAction] = useState<ActionSurface | null>(null);
    const [showWardenPrompt, setShowWardenPrompt] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const [serviceActivity, setServiceActivity] = useState<Record<string, string>>({});
    const [logServiceScope, setLogServiceScope] = useState<string | null>(null);
    const [activeControl, setActiveControl] = useState('services');

    const { entries: logEntries, append: appendLog, reset: resetLog } = useLogBuffer();

    const wardenSelected = useMemo(() => {
        if (startSelection.includes(ALL_SERVICES_OPTION)) {
            return availableServices.includes('warden');
        }
        return startSelection.some((service) => service.toLowerCase() === 'warden');
    }, [availableServices, startSelection]);

    const shouldBindHostSocket = wardenSelected && startBindSocket;

    const serviceHealth = useMemo(() => {
        const health: Record<string, string> = {};
        const services = servicesCatalog?.services;
        if (Array.isArray(services)) {
            services.forEach((service) => {
                const name =
                    typeof service === 'string'
                        ? service
                        : typeof (service as { name?: string })?.name === 'string'
                          ? (service as { name: string }).name
                          : typeof (service as { id?: string })?.id === 'string'
                            ? (service as { id: string }).id
                            : undefined;
                const status =
                    typeof service === 'object' && service
                        ? (service as { status?: string; state?: string })?.status ||
                          (service as { status?: string; state?: string })?.state
                        : undefined;
                if (name) {
                    health[name.trim()] = status ?? servicesStatus;
                }
            });
        }
        return health;
    }, [servicesCatalog?.services, servicesStatus]);

    const servicesStatusLabel = servicesStatus === 'ok'
        ? 'Healthy'
        : servicesStatus === 'warn'
          ? 'Partial'
          : servicesStatus === 'error'
            ? 'Unavailable'
            : 'Idle';
    const servicesStatusClass =
        servicesStatus === 'ok'
            ? 'status-pill status-ok'
            : servicesStatus === 'warn'
              ? 'status-pill status-warn'
              : servicesStatus === 'error'
                ? 'status-pill status-error'
                : 'status-pill status-info';

    const readNdjsonStream = useCallback(
        async (response: Response, action: string) => {
            const reader = response.body?.getReader?.();
            if (!reader) {
                appendLog({ action, type: 'error', message: 'Streaming unsupported in this browser.' });
                return;
            }
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        appendLog(JSON.parse(line));
                    } catch (error) {
                        appendLog({ action, type: 'error', message: 'Malformed stream payload', raw: line });
                    }
                }
            }
            if (buffer.trim()) {
                try {
                    appendLog(JSON.parse(buffer));
                } catch (error) {
                    appendLog({ action, type: 'error', message: 'Malformed stream payload', raw: buffer });
                }
            }
        },
        [appendLog]
    );

    const invokeStreamEndpoint = useCallback(
        async (action: string, url: string, payload?: unknown, targetServices?: string[]) => {
            setErrorMessage(null);
            const scope = Array.isArray(targetServices) && targetServices.length === 1 ? targetServices[0] : null;
            setLogServiceScope(scope);
            resetLog(action);
            setIsStreaming(true);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload ?? {})
                });
                if (!response.ok && response.status !== 207) {
                    appendLog({ action, type: 'error', message: `Request failed: ${response.status}` });
                    return;
                }
                await readNdjsonStream(response, action);
            } catch (error) {
                appendLog({ action, type: 'error', message: (error as Error).message });
            } finally {
                setIsStreaming(false);
            }
        },
        [appendLog, readNdjsonStream, resetLog]
    );

    const fetchServiceCatalog = useCallback(async () => {
        setServicesLoading(true);
        try {
            const response = await fetch(SERVICES_ENDPOINT);
            if (!response.ok && response.status !== 207) {
                throw new Error(`Failed to load services (${response.status})`);
            }
            const payload: ServicesResponse = await response.json();
            setServicesCatalog(payload);
            setAvailableServices(extractServiceNames(payload.services));
            setServicesStatus(payload.ok ? 'ok' : 'warn');
            setServicesOutput(formatJSON(payload));
        } catch (error) {
            setServicesCatalog(null);
            setServicesStatus('error');
            setServicesOutput((error as Error).message);
        } finally {
            setServicesLoading(false);
        }
    }, []);

    const handleLoadSettings = useCallback(async () => {
        setSettingsLoading(true);
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) {
                throw new Error(`Failed to load settings (${response.status})`);
            }
            const payload = await response.json();
            setSettingsOutput(formatJSON(payload));
            setSettingsJson(JSON.stringify(payload, null, 2));
            if (Object.prototype.hasOwnProperty.call(payload || {}, 'hostDockerSocketOverride')) {
                setHostDockerSocket(payload.hostDockerSocketOverride ?? '');
            } else {
                setHostDockerSocket('');
            }
        } catch (error) {
            setSettingsOutput((error as Error).message);
        } finally {
            setSettingsLoading(false);
        }
    }, []);

    const handleUpdateSettings = useCallback(async () => {
        setErrorMessage(null);
        try {
            const parsed = safeParseJSON(settingsJson || '{}');
            const payload = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
            if (payload && typeof payload === 'object' && (payload as { defaults?: Record<string, unknown> }).defaults) {
                delete (payload as { defaults?: Record<string, unknown> }).defaults?.hostDockerSocketOverride;
            }
            payload.hostDockerSocketOverride = hostDockerSocket.trim() ? hostDockerSocket.trim() : null;
            const response = await fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Failed to update settings (${response.status})`);
            }
            const body = await response.json();
            setSettingsOutput(formatJSON(body));
            setSettingsJson(JSON.stringify(body, null, 2));
            if (Object.prototype.hasOwnProperty.call(body || {}, 'hostDockerSocketOverride')) {
                setHostDockerSocket(body.hostDockerSocketOverride ?? '');
            }
        } catch (error) {
            setErrorMessage((error as Error).message);
        }
    }, [hostDockerSocket, settingsJson]);

    const deriveTargetServices = useCallback(
        (selection: 'all' | string[] | undefined): string[] => {
            if (selection === 'all') {
                return availableServices;
            }
            if (!selection || selection.length === 0) {
                return availableServices;
            }
            return selection;
        },
        [availableServices]
    );

    const markServiceActivity = useCallback((action: string, targets: string[]) => {
        if (!targets.length) return;
        const timestamp = new Date().toLocaleTimeString();
        setServiceActivity((current) => {
            const next = { ...current };
            targets.forEach((service) => {
                next[service] = `${action} @ ${timestamp}`;
            });
            return next;
        });
    }, []);

    const handleBuild = useCallback(async () => {
        const payload: Record<string, unknown> = { useNoCache: buildUseNoCache };
        const services = resolveServicesPayload(buildSelection);
        if (services) {
            payload.services = services;
        }
        if (buildConcurrency.trim()) {
            payload.concurrency = safeParseJSON(buildConcurrency);
        }
        const targets = deriveTargetServices(services);
        markServiceActivity('build', targets);
        await invokeStreamEndpoint('build', '/api/build', payload, targets);
    }, [buildConcurrency, buildSelection, buildUseNoCache, deriveTargetServices, invokeStreamEndpoint, markServiceActivity]);

    const handleRegistryAction = useCallback(
        async (action: 'push' | 'pull') => {
            const payload: Record<string, unknown> = {};
            const services = resolveServicesPayload(registrySelection);
            if (services) {
                payload.services = services;
            }
            const targets = deriveTargetServices(services);
            markServiceActivity(action, targets);
            await invokeStreamEndpoint(action, `/api/${action}`, payload, targets);
        },
        [deriveTargetServices, invokeStreamEndpoint, markServiceActivity, registrySelection]
    );

    const handlePush = useCallback(async () => {
        await handleRegistryAction('push');
    }, [handleRegistryAction]);

    const handlePull = useCallback(async () => {
        await handleRegistryAction('pull');
    }, [handleRegistryAction]);

    const dispatchStart = useCallback(
        async (servicesOverride?: string[]) => {
            const payload: Record<string, unknown> = {
                debugLevel: startDebugLevel,
                bootMode: startBootMode,
                useHostDockerSocket: shouldBindHostSocket
            };
            const services = resolveServicesPayload(servicesOverride ?? startSelection);
            if (services) {
                payload.services = services;
            }
            if (shouldBindHostSocket && hostDockerSocket.trim()) {
                payload.hostDockerSocketOverride = hostDockerSocket.trim();
            }
            const targets = deriveTargetServices(services);
            markServiceActivity('start', targets);
            await invokeStreamEndpoint('start', '/api/start', payload, targets);
        },
        [
            deriveTargetServices,
            hostDockerSocket,
            invokeStreamEndpoint,
            markServiceActivity,
            shouldBindHostSocket,
            startBootMode,
            startDebugLevel,
            startSelection
        ]
    );

    const handleStart = useCallback(async () => {
        await dispatchStart();
    }, [dispatchStart]);

    const handleStartWarden = useCallback(async () => {
        const wardenSelection = ['warden'];
        setSelectedService('warden');
        setStartSelection(wardenSelection);
        await dispatchStart(wardenSelection);
    }, [dispatchStart]);

    const handleStop = useCallback(async () => {
        const targets = deriveTargetServices('all');
        markServiceActivity('stop', targets);
        await invokeStreamEndpoint('stop', '/api/stop', undefined, targets);
    }, [deriveTargetServices, invokeStreamEndpoint, markServiceActivity]);

    const handleClean = useCallback(async () => {
        const payload: Record<string, unknown> = {};
        const services = resolveServicesPayload(cleanSelection);
        if (services) {
            payload.services = services;
        }
        const targets = deriveTargetServices(services);
        markServiceActivity('clean', targets);
        await invokeStreamEndpoint('clean', '/api/clean', payload, targets);
    }, [cleanSelection, deriveTargetServices, invokeStreamEndpoint, markServiceActivity]);

    const handleDelete = useCallback(async () => {
        if (!deleteConfirm) {
            setErrorMessage('Please confirm the destructive delete operation before proceeding.');
            return;
        }
        const targets = deriveTargetServices('all');
        markServiceActivity('delete', targets);
        await invokeStreamEndpoint('delete', '/api/delete', { confirm: true }, targets);
    }, [deleteConfirm, deriveTargetServices, invokeStreamEndpoint, markServiceActivity]);

    const handleFocusService = useCallback((service?: string | null) => {
        setSelectedService(service || null);
        if (!service) {
            setLogServiceScope(null);
        }
    }, []);

    const handleClearSelection = useCallback(() => {
        setSelectedService(null);
        setLogServiceScope(null);
    }, []);

    const openActionSurface = useCallback((action: ActionSurface) => {
        setErrorMessage(null);
        setActiveAction(action);
    }, []);

    const closeActionSurface = useCallback(() => {
        setActiveAction(null);
    }, []);

    useEffect(() => {
        fetchServiceCatalog();
    }, [fetchServiceCatalog]);

    useEffect(() => {
        if (!selectedService) return;
        setBuildSelection([selectedService]);
        setRegistrySelection([selectedService]);
        setStartSelection([selectedService]);
        setCleanSelection([selectedService]);
    }, [selectedService]);

    const scopedLogEntries = useMemo(() => {
        if (!selectedService) return logEntries;
        return logEntries.filter((entry) => {
            const entryService = (entry as { service?: string }).service || (entry.event as { service?: string })?.service;
            if (entryService) {
                return entryService === selectedService;
            }
            return logServiceScope === selectedService;
        });
    }, [logEntries, logServiceScope, selectedService]);

    const lastActionLabel = (service: string): string => {
        return serviceActivity[service] ?? 'Awaiting command';
    };

    const serviceCountLabel = useMemo(
        () => (availableServices.length ? `${availableServices.length} detected` : 'No services detected'),
        [availableServices.length]
    );

    const hasWarden = useMemo(
        () => availableServices.some((service) => service.toLowerCase() === 'warden'),
        [availableServices]
    );

    const handleBuildFlowSubmit = useCallback(async () => {
        await handleBuild();
        closeActionSurface();
        if (hasWarden) {
            setStartSelection(['warden']);
            setShowWardenPrompt(true);
        }
    }, [closeActionSurface, handleBuild, hasWarden]);

    const dismissWardenPrompt = useCallback(() => {
        setShowWardenPrompt(false);
    }, []);

    const startWardenAfterBuild = useCallback(async () => {
        dismissWardenPrompt();
        await handleStartWarden();
    }, [dismissWardenPrompt, handleStartWarden]);

    const quickActions = useMemo(
        () => [
            {
                id: 'build',
                title: 'Build',
                badge: 'Images',
                description: 'Compile containers for detected services with optional concurrency overrides.',
                metaLabel: 'Scope',
                metaValue: availableServices.length ? 'All detected services' : 'No services loaded',
                actionLabel: 'Start build',
                onAction: () => openActionSurface('build'),
                disabled: isStreaming || availableServices.length === 0
            },
            {
                id: 'push',
                title: 'Push',
                badge: 'Registry',
                description: 'Upload tagged images to the configured container registry.',
                metaLabel: 'Target',
                metaValue: serviceCountLabel,
                actionLabel: 'Push images',
                onAction: () => openActionSurface('push'),
                disabled: isStreaming || availableServices.length === 0
            },
            {
                id: 'pull',
                title: 'Pull',
                badge: 'Registry',
                description: 'Fetch images from the registry to refresh local caches.',
                metaLabel: 'Target',
                metaValue: serviceCountLabel,
                actionLabel: 'Pull images',
                onAction: () => openActionSurface('pull'),
                disabled: isStreaming || availableServices.length === 0
            },
            {
                id: 'clean',
                title: 'Clean',
                badge: 'Lifecycle',
                description: 'Remove resources for selected services or the entire stack.',
                metaLabel: 'Confirmation',
                metaValue: deleteConfirm ? 'Prune enabled' : 'Selective cleanup',
                actionLabel: 'Run cleanup',
                onAction: () => openActionSurface('clean'),
                disabled: isStreaming || availableServices.length === 0
            },
            {
                id: 'start-warden',
                title: 'Start Warden',
                badge: 'Control plane',
                description: 'Launch Warden with the current boot mode and socket binding preferences.',
                metaLabel: 'Availability',
                metaValue: hasWarden ? 'Warden detected' : 'Warden not listed',
                actionLabel: 'Start Warden',
                onAction: handleStartWarden,
                disabled: isStreaming
            }
        ],
        [
            availableServices.length,
            deleteConfirm,
            handleStartWarden,
            hasWarden,
            isStreaming,
            openActionSurface,
            serviceCountLabel
        ]
    );

    return (
        <div className="app-shell">
            {activeAction === 'build' && (
                <ActionModal
                    title="Build services"
                    subtitle="Select services, concurrency, and caching options before dispatching a build."
                    onClose={closeActionSurface}
                    footer={
                        <div className="controls modal-controls">
                            <button type="button" className="ghost" onClick={closeActionSurface}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleBuildFlowSubmit}
                                disabled={isStreaming || availableServices.length === 0}
                            >
                                Dispatch build
                            </button>
                        </div>
                    }
                >
                    <div className="inline-group">
                        <ServiceSelect
                            id="quick-build-services"
                            label="Services to build"
                            value={buildSelection}
                            onChange={setBuildSelection}
                            options={selectedService ? [selectedService] : availableServices}
                            includeAllOption={!selectedService}
                            helpText="Pick target services or build everything."
                            size={4}
                        />
                        <label className="oneui-field">
                            <span className="oneui-field__label">Concurrency override</span>
                            <input
                                id="quick-build-concurrency"
                                placeholder='{"workers":2}'
                                value={buildConcurrency}
                                onChange={(event) => setBuildConcurrency(event.target.value)}
                            />
                        </label>
                    </div>
                    <label className="oneui-field checkbox-field">
                        <span>
                            <input
                                type="checkbox"
                                checked={buildUseNoCache}
                                onChange={(event) => setBuildUseNoCache(event.target.checked)}
                            />{' '}
                            Use --no-cache
                        </span>
                    </label>
                </ActionModal>
            )}

            {activeAction === 'push' && (
                <ActionModal
                    title="Push images"
                    subtitle="Choose which services to push to the configured registry."
                    onClose={closeActionSurface}
                    footer={
                        <div className="controls modal-controls">
                            <button type="button" className="ghost" onClick={closeActionSurface}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handlePush}
                                disabled={isStreaming || availableServices.length === 0}
                            >
                                Push images
                            </button>
                        </div>
                    }
                >
                    <ServiceSelect
                        id="quick-push-services"
                        label="Services to push"
                        value={registrySelection}
                        onChange={setRegistrySelection}
                        options={selectedService ? [selectedService] : availableServices}
                        includeAllOption={!selectedService}
                        helpText="Limit pushes to specific services or include all."
                        size={4}
                    />
                </ActionModal>
            )}

            {activeAction === 'pull' && (
                <ActionModal
                    title="Pull images"
                    subtitle="Choose which services to refresh from the registry."
                    onClose={closeActionSurface}
                    footer={
                        <div className="controls modal-controls">
                            <button type="button" className="ghost" onClick={closeActionSurface}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handlePull}
                                disabled={isStreaming || availableServices.length === 0}
                            >
                                Pull images
                            </button>
                        </div>
                    }
                >
                    <ServiceSelect
                        id="quick-pull-services"
                        label="Services to pull"
                        value={registrySelection}
                        onChange={setRegistrySelection}
                        options={selectedService ? [selectedService] : availableServices}
                        includeAllOption={!selectedService}
                        helpText="Target specific services to refresh locally."
                        size={4}
                    />
                </ActionModal>
            )}

            {activeAction === 'clean' && (
                <ActionModal
                    title="Clean resources"
                    subtitle="Preview cleanup scope and optionally enable full Docker prune."
                    onClose={closeActionSurface}
                    footer={
                        <div className="controls modal-controls">
                            <button type="button" className="ghost" onClick={closeActionSurface}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleClean}
                                disabled={isStreaming || availableServices.length === 0}
                            >
                                Remove resources
                            </button>
                        </div>
                    }
                >
                    <ServiceSelect
                        id="quick-clean-services"
                        label="Services to clean"
                        value={cleanSelection}
                        onChange={setCleanSelection}
                        options={selectedService ? [selectedService] : availableServices}
                        includeAllOption={!selectedService}
                        helpText="Remove resources for a subset or the entire stack."
                        size={4}
                    />
                    <label className="oneui-field checkbox-field">
                        <span>
                            <input
                                type="checkbox"
                                checked={deleteConfirm}
                                onChange={(event) => setDeleteConfirm(event.target.checked)}
                            />{' '}
                            Confirm full Docker prune
                        </span>
                    </label>
                </ActionModal>
            )}

            {showWardenPrompt && (
                <ActionModal
                    title="Build dispatched"
                    subtitle="Build options saved. Start Warden with the current start configuration?"
                    onClose={dismissWardenPrompt}
                    footer={
                        <div className="controls modal-controls">
                            <button type="button" className="ghost" onClick={dismissWardenPrompt}>
                                Maybe later
                            </button>
                            <button
                                type="button"
                                onClick={startWardenAfterBuild}
                                disabled={isStreaming || !hasWarden}
                            >
                                Start Warden now
                            </button>
                        </div>
                    }
                >
                    <p className="muted">
                        Build submitted for {buildSelection.length ? buildSelection.join(', ') : 'all detected services'}. Warden is
                        preselected in the start list so you can launch it with the current boot and debug settings.
                    </p>
                </ActionModal>
            )}

            <header className="hero">
                <div className="hero__eyebrow">Warden Control</div>
                <div className="hero__title-row">
                    <h1>Deployment Console</h1>
                    <span className="hero__badge">Live NDJSON feed</span>
                </div>
                <p>Issue build, registry, lifecycle, and cleanup commands with a cockpit-grade interface tailored for on-call.</p>
                <div className="hero__actions">
                    <button type="button" onClick={fetchServiceCatalog} disabled={servicesLoading}>
                        {servicesLoading ? 'Refreshing…' : 'Refresh status'}
                    </button>
                    <button type="button" onClick={handleLoadSettings} disabled={settingsLoading}>
                        {settingsLoading ? 'Loading settings…' : 'Sync settings'}
                    </button>
                    <div className="hero__hint">Bindings update automatically when Warden is selected.</div>
                </div>
            </header>

            <section className="status-ribbon" aria-label="Deployment health">
                <div className="status-card">
                    <div className="status-card__label">Services</div>
                    <div className="status-card__value">
                        <span className={servicesStatusClass}>{servicesStatusLabel}</span>
                        <span className="status-card__meta">{availableServices.length || '—'} detected</span>
                    </div>
                </div>
                <div className="status-card">
                    <div className="status-card__label">Streaming</div>
                    <div className="status-card__value">
                        <span className={isStreaming ? 'status-pill status-info' : 'status-pill status-ok'}>
                            {isStreaming ? 'Active' : 'Idle'}
                        </span>
                        <span className="status-card__meta">NDJSON output</span>
                    </div>
                </div>
                <div className="status-card">
                    <div className="status-card__label">Settings</div>
                    <div className="status-card__value">
                        <span className="status-pill status-info">{hostDockerSocket ? 'Socket override' : 'Default path'}</span>
                        <span className="status-card__meta">Patch /api/settings</span>
                    </div>
                </div>
                <div className="status-card">
                    <div className="status-card__label">Warden Binding</div>
                    <div className="status-card__value">
                        <span className={shouldBindHostSocket ? 'status-pill status-ok' : 'status-pill status-warn'}>
                            {shouldBindHostSocket ? 'Host socket bound' : 'Socket optional'}
                        </span>
                        <span className="status-card__meta">Set under Start / Stop</span>
                    </div>
                </div>
            </section>

            <main className="content-grid">
                {errorMessage && (
                    <section className="oneui-card wide-card">
                        <div className="alert">{errorMessage}</div>
                    </section>
                )}

            <section className="summary-section">
                <div className="summary-section__header">
                    <div>
                        <p className="eyebrow">Quick commands</p>
                        <h2>Action shortcuts</h2>
                            <p className="muted">Dispatch common deployment flows without drilling into individual services.</p>
                        </div>
                    </div>
                    <div className="summary-grid">
                        {quickActions.map((action) => (
                            <div className="summary-card" key={action.id}>
                                <div className="summary-card__top">
                                    <div>
                                        <p className="eyebrow">Quick action</p>
                                        <h3>{action.title}</h3>
                                    </div>
                                    <span className="status-pill status-info">{action.badge}</span>
                                </div>
                                <p className="muted">{action.description}</p>
                                <div className="summary-card__meta">
                                    <span className="summary-card__label">{action.metaLabel}</span>
                                    <span className="summary-card__value">{action.metaValue}</span>
                                </div>
                                <div className="summary-card__footer">
                                    <button type="button" onClick={action.onAction} disabled={action.disabled}>
                                        {action.actionLabel}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="oneui-card focus-bar" aria-label="Streaming focus">
                    <div className="focus-bar__header">
                        <div>
                            <p className="eyebrow">Streaming</p>
                            <h2>Focus service</h2>
                            <p className="muted">Scope defaults, streaming output, and quick actions.</p>
                        </div>
                        <div className="focus-bar__meta">
                            <span className={selectedService ? getStatusClass(serviceHealth[selectedService]) : servicesStatusClass}>
                                {selectedService ? serviceHealth[selectedService] ?? 'Unknown' : servicesStatusLabel}
                            </span>
                            <span className="muted">
                                {selectedService ? lastActionLabel(selectedService) : 'Monitoring all services'}
                            </span>
                            <button
                                type="button"
                                className="ghost"
                                onClick={handleClearSelection}
                                disabled={!selectedService}
                            >
                                Clear focus
                            </button>
                        </div>
                    </div>
                    <div className="inline-group focus-row">
                        <label className="oneui-field">
                            <div className="field-label">
                                <span className="oneui-field__label">Select scope</span>
                                <span className="oneui-field__hint">Updates quick actions and log filtering</span>
                            </div>
                            <select
                                value={selectedService ?? ''}
                                onChange={(event) => handleFocusService(event.target.value || null)}
                            >
                                <option value="">All services</option>
                                {availableServices.map((service) => (
                                    <option key={service} value={service}>
                                        {service}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </section>

                <section className="oneui-card wide-card detail-surface">
                    <div className="detail-header">
                        <div>
                            <p className="eyebrow">Detail</p>
                            <h2>{selectedService ?? 'Stack controls'}</h2>
                            <div className="detail-meta">
                                {selectedService ? (
                                    <>
                                        <span className={getStatusClass(serviceHealth[selectedService])}>
                                            {serviceHealth[selectedService] ?? 'Unknown'}
                                        </span>
                                        <span className="muted">{lastActionLabel(selectedService)}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="status-pill status-info">{serviceCountLabel}</span>
                                        <span className="muted">Manage build, registry, lifecycle, and cleanup flows.</span>
                                    </>
                                )}
                            </div>
                        </div>
                        {selectedService && (
                            <button type="button" className="ghost" onClick={handleClearSelection}>
                                Clear focus
                            </button>
                        )}
                    </div>

                    <div className="control-tabs">
                        {[
                            {
                                id: 'services',
                                label: 'Services',
                                meta: servicesStatusLabel,
                                badgeClass: servicesStatusClass
                            },
                            {
                                id: 'build',
                                label: 'Build',
                                meta: buildUseNoCache ? 'No-cache enabled' : 'Cached builds',
                                badgeClass: 'status-pill status-info'
                            },
                            {
                                id: 'registry',
                                label: 'Registry',
                                meta: registrySelection.length ? 'Scoped targets' : 'All services',
                                badgeClass: 'status-pill status-info'
                            },
                            {
                                id: 'start',
                                label: 'Start / Stop',
                                meta: startDebugLevel,
                                badgeClass: 'status-pill status-info'
                            },
                            {
                                id: 'cleanup',
                                label: 'Cleanup',
                                meta: deleteConfirm ? 'Prune enabled' : 'Selective',
                                badgeClass: 'status-pill status-warn'
                            },
                            {
                                id: 'settings',
                                label: 'Settings',
                                meta: hostDockerSocket.trim() ? 'Custom socket' : 'Auto-detect',
                                badgeClass: 'status-pill status-info'
                            }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                className={`control-tab ${activeControl === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveControl(tab.id)}
                            >
                                <div className="control-tab__label">{tab.label}</div>
                                <span className={`${tab.badgeClass} control-tab__meta`}>{tab.meta}</span>
                            </button>
                        ))}
                    </div>

                    <div className="control-card">
                        {activeControl === 'services' && (
                            <>
                                <p className="muted inline-hint">Live service catalog and reported health.</p>
                                <pre id="services-output">{servicesOutput}</pre>
                                <div className="controls card-footer">
                                    <button type="button" onClick={fetchServiceCatalog} disabled={servicesLoading}>
                                        Refresh status
                                    </button>
                                    <button
                                        type="button"
                                        className="ghost"
                                        onClick={handleClearSelection}
                                        disabled={!selectedService}
                                    >
                                        Clear focus
                                    </button>
                                </div>
                            </>
                        )}

                        {activeControl === 'build' && (
                            <>
                                <div className="form-grid">
                                    <ServiceSelect
                                        id="build-services"
                                        label="Services to build"
                                        value={buildSelection}
                                        onChange={setBuildSelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        helpText={selectedService ? 'Locked to focused service' : 'Choose targets or build all'}
                                        includeAllOption={!selectedService}
                                        size={4}
                                    />
                                    <label className="oneui-field">
                                        <div className="field-label">
                                            <span className="oneui-field__label">Concurrency override</span>
                                            <span className="oneui-field__hint">Provide JSON to override defaults</span>
                                        </div>
                                        <input
                                            id="build-concurrency"
                                            placeholder='{"workers":2}'
                                            value={buildConcurrency}
                                            onChange={(event) => setBuildConcurrency(event.target.value)}
                                        />
                                    </label>
                                    <label className="oneui-field checkbox-field full-span">
                                        <span>
                                            <input
                                                type="checkbox"
                                                checked={buildUseNoCache}
                                                onChange={(event) => setBuildUseNoCache(event.target.checked)}
                                            />{' '}
                                            Use --no-cache
                                        </span>
                                    </label>
                                </div>
                                <div className="controls card-footer">
                                    <button type="button" onClick={handleBuild} disabled={isStreaming}>
                                        Start build
                                    </button>
                                    <button
                                        type="button"
                                        className="ghost"
                                        onClick={() => {
                                            setBuildSelection(selectedService ? [selectedService] : []);
                                            setBuildConcurrency('');
                                            setBuildUseNoCache(false);
                                        }}
                                        disabled={isStreaming}
                                    >
                                        Reset build options
                                    </button>
                                </div>
                            </>
                        )}

                        {activeControl === 'registry' && (
                            <>
                                <div className="form-grid">
                                    <ServiceSelect
                                        id="registry-services"
                                        label="Services"
                                        value={registrySelection}
                                        onChange={setRegistrySelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        includeAllOption={!selectedService}
                                        helpText={registrySelection.length ? 'Operating on selected services' : 'Defaults to all'}
                                        size={4}
                                    />
                                </div>
                                <div className="controls card-footer">
                                    <button type="button" onClick={() => handleRegistryAction('push')} disabled={isStreaming}>
                                        Push images
                                    </button>
                                    <button
                                        type="button"
                                        className="ghost"
                                        onClick={() => handleRegistryAction('pull')}
                                        disabled={isStreaming}
                                    >
                                        Pull images
                                    </button>
                                </div>
                            </>
                        )}

                        {activeControl === 'start' && (
                            <>
                                <div className="form-grid">
                                    <ServiceSelect
                                        id="start-services"
                                        label="Services"
                                        value={startSelection}
                                        onChange={setStartSelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        includeAllOption={!selectedService}
                                        helpText={selectedService ? 'Launch focused service' : 'Start a selection or all'}
                                        size={4}
                                    />
                                    <label className="oneui-field">
                                        <div className="field-label">
                                            <span className="oneui-field__label">Debug level</span>
                                            <span className="oneui-field__hint">Controls runtime verbosity</span>
                                        </div>
                                        <select value={startDebugLevel} onChange={(event) => setStartDebugLevel(event.target.value)}>
                                            <option value="auto">auto</option>
                                            <option value="info">info</option>
                                            <option value="debug">debug</option>
                                            <option value="super">super</option>
                                        </select>
                                    </label>
                                    <label className="oneui-field">
                                        <div className="field-label">
                                            <span className="oneui-field__label">Boot mode</span>
                                            <span className="oneui-field__hint">Choose standard or elevated boot</span>
                                        </div>
                                        <select value={startBootMode} onChange={(event) => setStartBootMode(event.target.value)}>
                                            <option value="standard">standard</option>
                                            <option value="super">super</option>
                                        </select>
                                    </label>
                                    {wardenSelected && (
                                        <label className="oneui-field checkbox-field full-span">
                                            <span>
                                                <input
                                                    type="checkbox"
                                                    checked={startBindSocket}
                                                    onChange={(event) => setStartBindSocket(event.target.checked)}
                                                />{' '}
                                                Bind host Docker socket
                                            </span>
                                            <span className="oneui-field__hint">
                                                Expose the host socket when launching Warden; override path in Settings.
                                            </span>
                                        </label>
                                    )}
                                </div>
                                <div className="controls card-footer">
                                    <button type="button" onClick={handleStart} disabled={isStreaming}>
                                        Start services
                                    </button>
                                    <button type="button" className="ghost" onClick={handleStop} disabled={isStreaming}>
                                        Stop all
                                    </button>
                                </div>
                            </>
                        )}

                        {activeControl === 'cleanup' && (
                            <>
                                <div className="form-grid">
                                    <ServiceSelect
                                        id="clean-services"
                                        label="Services"
                                        value={cleanSelection}
                                        onChange={setCleanSelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        includeAllOption={!selectedService}
                                        helpText={deleteConfirm ? 'Full prune confirmed' : 'Targeted cleanup by default'}
                                        size={4}
                                    />
                                    <label className="oneui-field checkbox-field full-span">
                                        <span>
                                            <input
                                                type="checkbox"
                                                checked={deleteConfirm}
                                                onChange={(event) => setDeleteConfirm(event.target.checked)}
                                            />{' '}
                                            Confirm full Docker prune
                                        </span>
                                    </label>
                                </div>
                                <div className="controls card-footer">
                                    <button type="button" onClick={handleClean} disabled={isStreaming}>
                                        Remove selected resources
                                    </button>
                                    <button type="button" className="ghost" onClick={handleDelete} disabled={isStreaming}>
                                        Delete all Noona Docker resources
                                    </button>
                                </div>
                            </>
                        )}

                        {activeControl === 'settings' && (
                            <>
                                <div className="form-grid">
                                    <label className="oneui-field">
                                        <div className="field-label">
                                            <span className="oneui-field__label">Host Docker socket override</span>
                                            <span className="oneui-field__hint">Leave blank to auto-detect</span>
                                        </div>
                                        <input
                                            id="settings-host-socket"
                                            placeholder="/var/run/docker.sock"
                                            value={hostDockerSocket}
                                            onChange={(event) => setHostDockerSocket(event.target.value)}
                                        />
                                    </label>
                                    <label className="oneui-field full-span">
                                        <div className="field-label">
                                            <span className="oneui-field__label">Raw JSON payload</span>
                                            <span className="oneui-field__hint">Overrides are merged into deployment settings</span>
                                        </div>
                                        <textarea
                                            id="settings-json"
                                            rows={6}
                                            value={settingsJson}
                                            onChange={(event) => setSettingsJson(event.target.value)}
                                            placeholder='{"defaults":{"debugLevel":"debug"}}'
                                        />
                                    </label>
                                </div>
                                <div className="controls card-footer">
                                    <button type="button" onClick={handleUpdateSettings} disabled={isStreaming}>
                                        Update settings
                                    </button>
                                    <button type="button" className="ghost" onClick={handleLoadSettings} disabled={settingsLoading}>
                                        Reload settings
                                    </button>
                                </div>
                                <pre id="settings-output">{settingsOutput}</pre>
                            </>
                        )}
                    </div>
                </section>

                <section className="stream-column">
                    <CollapsibleSection title="Streaming Output" defaultOpen className="stream-card">
                        <LogPanel entries={scopedLogEntries} />
                    </CollapsibleSection>
                </section>
            </main>
        </div>
    );
};

export default App;
