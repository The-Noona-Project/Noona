import { useCallback, useEffect, useMemo, useState } from 'react';

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
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const [serviceActivity, setServiceActivity] = useState<Record<string, string>>({});
    const [logServiceScope, setLogServiceScope] = useState<string | null>(null);

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

    const handleStart = useCallback(async () => {
        const payload: Record<string, unknown> = {
            debugLevel: startDebugLevel,
            bootMode: startBootMode,
            useHostDockerSocket: shouldBindHostSocket
        };
        const services = resolveServicesPayload(startSelection);
        if (services) {
            payload.services = services;
        }
        if (shouldBindHostSocket && hostDockerSocket.trim()) {
            payload.hostDockerSocketOverride = hostDockerSocket.trim();
        }
        const targets = deriveTargetServices(services);
        markServiceActivity('start', targets);
        await invokeStreamEndpoint('start', '/api/start', payload, targets);
    }, [
        deriveTargetServices,
        hostDockerSocket,
        invokeStreamEndpoint,
        markServiceActivity,
        shouldBindHostSocket,
        startBootMode,
        startDebugLevel,
        startSelection
    ]);

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

    const handleSelectService = useCallback((service: string) => {
        setSelectedService(service);
    }, []);

    const handleClearSelection = useCallback(() => {
        setSelectedService(null);
        setLogServiceScope(null);
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

    return (
        <div className="app-shell">
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
                            <p className="eyebrow">Service overview</p>
                            <h2>Compact control deck</h2>
                            <p className="muted">Open a service to drive builds, registry syncs, lifecycle changes, and cleanup.</p>
                        </div>
                        {selectedService && (
                            <button type="button" className="ghost" onClick={handleClearSelection}>
                                Close detail
                            </button>
                        )}
                    </div>
                    <div className="summary-grid">
                        {availableServices.length === 0 && (
                            <div className="summary-card empty">
                                <p className="muted">No services detected yet. Refresh status to load the catalog.</p>
                            </div>
                        )}
                        {availableServices.map((service) => {
                            const status = serviceHealth[service] ?? servicesStatusLabel.toLowerCase();
                            return (
                                <div className="summary-card" key={service}>
                                    <div className="summary-card__top">
                                        <div>
                                            <p className="eyebrow">Service</p>
                                            <h3>{service}</h3>
                                        </div>
                                        <span className={getStatusClass(status)}>{status || 'Unknown'}</span>
                                    </div>
                                    <div className="summary-card__meta">
                                        <span className="summary-card__label">Last action</span>
                                        <span className="summary-card__value">{lastActionLabel(service)}</span>
                                    </div>
                                    <div className="summary-card__footer">
                                        <button type="button" onClick={() => handleSelectService(service)}>
                                            Open
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {selectedService && (
                    <section className="oneui-card wide-card detail-surface">
                        <div className="detail-header">
                            <div>
                                <p className="eyebrow">Detail</p>
                                <h2>{selectedService}</h2>
                                <div className="detail-meta">
                                    <span className={getStatusClass(serviceHealth[selectedService])}>
                                        {serviceHealth[selectedService] ?? 'Unknown'}
                                    </span>
                                    <span className="muted">{lastActionLabel(selectedService)}</span>
                                </div>
                            </div>
                            <button type="button" className="ghost" onClick={handleClearSelection}>
                                Back to overview
                            </button>
                        </div>

                        <div className="stack-grid detail-grid">
                            <CollapsibleSection
                                title="Services"
                                defaultOpen
                                meta={<div className={servicesStatusClass}>{servicesStatusLabel}</div>}
                            >
                                <pre id="services-output">{servicesOutput}</pre>
                            </CollapsibleSection>

                            <CollapsibleSection title="Build">
                                <div className="inline-group">
                                    <ServiceSelect
                                        id="build-services"
                                        label="Services to build"
                                        value={buildSelection}
                                        onChange={setBuildSelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        helpText="Scope is locked to the selected service."
                                        includeAllOption={!selectedService}
                                        size={4}
                                    />
                                    <label className="oneui-field">
                                        <span className="oneui-field__label">Concurrency override</span>
                                        <input
                                            id="build-concurrency"
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
                                <div className="controls">
                                    <button type="button" onClick={handleBuild} disabled={isStreaming}>
                                        Start build
                                    </button>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection title="Push / Pull">
                                <ServiceSelect
                                    id="registry-services"
                                    label="Services"
                                    value={registrySelection}
                                    onChange={setRegistrySelection}
                                    options={selectedService ? [selectedService] : availableServices}
                                    includeAllOption={!selectedService}
                                    helpText="Select specific services or operate on the entire stack."
                                    size={4}
                                />
                                <div className="controls">
                                    <button type="button" onClick={() => handleRegistryAction('push')} disabled={isStreaming}>
                                        Push images
                                    </button>
                                    <button type="button" onClick={() => handleRegistryAction('pull')} disabled={isStreaming}>
                                        Pull images
                                    </button>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection title="Start / Stop" defaultOpen>
                                <div className="inline-group">
                                    <ServiceSelect
                                        id="start-services"
                                        label="Services"
                                        value={startSelection}
                                        onChange={setStartSelection}
                                        options={selectedService ? [selectedService] : availableServices}
                                        includeAllOption={!selectedService}
                                        helpText="Launch individual services or the entire deployment."
                                        size={4}
                                    />
                                    <label className="oneui-field">
                                        <span className="oneui-field__label">Debug level</span>
                                        <select value={startDebugLevel} onChange={(event) => setStartDebugLevel(event.target.value)}>
                                            <option value="auto">auto</option>
                                            <option value="info">info</option>
                                            <option value="debug">debug</option>
                                            <option value="super">super</option>
                                        </select>
                                    </label>
                                    <label className="oneui-field">
                                        <span className="oneui-field__label">Boot mode</span>
                                        <select value={startBootMode} onChange={(event) => setStartBootMode(event.target.value)}>
                                            <option value="standard">standard</option>
                                            <option value="super">super</option>
                                        </select>
                                    </label>
                                </div>
                                {wardenSelected && (
                                    <label className="oneui-field checkbox-field">
                                        <span>
                                            <input
                                                type="checkbox"
                                                checked={startBindSocket}
                                                onChange={(event) => setStartBindSocket(event.target.checked)}
                                            />{' '}
                                            Bind host Docker socket
                                        </span>
                                        <span className="help-text">
                                            Expose the host Docker socket when launching Warden. Override the socket path from the Settings panel if needed.
                                        </span>
                                    </label>
                                )}
                                <div className="controls">
                                    <button type="button" onClick={handleStart} disabled={isStreaming}>
                                        Start services
                                    </button>
                                    <button type="button" onClick={handleStop} disabled={isStreaming}>
                                        Stop all
                                    </button>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection title="Cleanup">
                                <ServiceSelect
                                    id="clean-services"
                                    label="Services"
                                    value={cleanSelection}
                                    onChange={setCleanSelection}
                                    options={selectedService ? [selectedService] : availableServices}
                                    includeAllOption={!selectedService}
                                    helpText="Remove resources for selected services or everything."
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
                                <div className="controls">
                                    <button type="button" onClick={handleClean} disabled={isStreaming}>
                                        Remove selected resources
                                    </button>
                                    <button type="button" onClick={handleDelete} disabled={isStreaming}>
                                        Delete all Noona Docker resources
                                    </button>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection title="Settings">
                                <label className="oneui-field">
                                    <span className="oneui-field__label">Host Docker socket override</span>
                                    <input
                                        id="settings-host-socket"
                                        placeholder="/var/run/docker.sock"
                                        value={hostDockerSocket}
                                        onChange={(event) => setHostDockerSocket(event.target.value)}
                                    />
                                    <span className="help-text">
                                        Optional host socket path to bind when starting Warden. Leave blank to auto-detect.
                                    </span>
                                </label>
                                <label className="oneui-field">
                                    <span className="oneui-field__label">Raw JSON payload</span>
                                    <textarea
                                        id="settings-json"
                                        rows={6}
                                        value={settingsJson}
                                        onChange={(event) => setSettingsJson(event.target.value)}
                                        placeholder='{"defaults":{"debugLevel":"debug"}}'
                                    />
                                </label>
                                <div className="controls">
                                    <button type="button" onClick={handleUpdateSettings} disabled={isStreaming}>
                                        Update settings
                                    </button>
                                </div>
                                <pre id="settings-output">{settingsOutput}</pre>
                            </CollapsibleSection>
                        </div>
                    </section>
                )}

                <section className="stream-column">
                    <CollapsibleSection title={selectedService ? `Streaming Output — ${selectedService}` : 'Streaming Output'} defaultOpen className="stream-card">
                        <LogPanel entries={scopedLogEntries} />
                    </CollapsibleSection>
                </section>
            </main>
        </div>
    );
};

export default App;
