#!/usr/bin/env node
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import {
    SERVICES,
    buildServices,
    pushServices,
    pullServices,
    startServices,
    stopAllContainers,
    cleanServices,
    deleteDockerResources,
    readLifecycleHistory,
    getDeploymentSettings,
    updateBuildConcurrencyDefaults,
    updateDebugDefaults,
    listManagedContainers
} from './deploy.mjs';

const stripAnsi = input => typeof input === 'string'
    ? input.replace(/\u001B\[[0-9;]*m/g, '')
    : String(input ?? '');

const formatTable = (rows, columns) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '—';
    }
    const cols = columns && columns.length
        ? columns
        : Array.from(new Set(rows.flatMap(row => Object.keys(row || {}))));
    const sanitized = rows.map(row => {
        const obj = row && typeof row === 'object' ? row : {};
        return cols.map(column => stripAnsi(String(obj[column] ?? '')));
    });
    const widths = cols.map((column, index) => Math.max(
        stripAnsi(column).length,
        ...sanitized.map(row => row[index].length)
    ));
    const header = cols.map((column, index) => stripAnsi(column).padEnd(widths[index])).join('  ');
    const separator = widths.map(width => '─'.repeat(width)).join('  ');
    const body = sanitized
        .map(row => row.map((value, index) => value.padEnd(widths[index])).join('  '))
        .join('\n');
    return `${header}\n${separator}\n${body}`;
};

const useMessageLog = () => {
    const [messages, setMessages] = useState([]);

    const pushMessage = useCallback((entry) => {
        setMessages(prev => {
            const next = [...prev, { ...entry, id: `${Date.now()}-${Math.random()}` }];
            return next.slice(-50);
        });
    }, []);

    const createReporter = useCallback(() => ({
        info: message => pushMessage({ level: 'info', text: stripAnsi(message) }),
        warn: message => pushMessage({ level: 'warn', text: stripAnsi(message) }),
        error: message => pushMessage({ level: 'error', text: stripAnsi(message) }),
        success: message => pushMessage({ level: 'success', text: stripAnsi(message) }),
        table: (data, columns) => pushMessage({ level: 'table', text: formatTable(data, columns) })
    }), [pushMessage]);

    return { messages, pushMessage, createReporter };
};

const ViewContainer = ({ title, children }) => (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="cyan" padding={1}>
        <Text color="cyan" bold>{title}</Text>
        <Box marginTop={1} flexDirection="column">{children}</Box>
    </Box>
);

const Navigation = ({ active }) => {
    const views = [
        { id: 'overview', label: 'Overview Dashboard' },
        { id: 'builds', label: 'Build Queue Manager' },
        { id: 'containers', label: 'Container Status Board' },
        { id: 'settings', label: 'Settings & Defaults' }
    ];
    return (
        <Box flexDirection="column" width={30} marginRight={2}>
            <Text color="cyan" bold>Views</Text>
            {views.map((view, index) => (
                <Text key={view.id} color={active === view.id ? 'green' : undefined}>
                    {active === view.id ? '▸ ' : '  '}{index + 1}. {view.label}
                </Text>
            ))}
            <Box marginTop={1} flexDirection="column">
                <Text dimColor>←/→ or 1-4 to switch views.</Text>
                <Text dimColor>Press q to exit.</Text>
            </Box>
        </Box>
    );
};

const MessagePanel = ({ messages }) => {
    const recent = messages.slice(-4);
    const palette = {
        info: undefined,
        table: 'cyan',
        success: 'green',
        warn: 'yellow',
        error: 'red'
    };
    return (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" padding={1}>
            <Text color="cyan" bold>Activity</Text>
            {recent.length === 0 ? (
                <Text dimColor>No messages yet. Actions and status updates will appear here.</Text>
            ) : recent.map(entry => (
                <Text key={entry.id} color={palette[entry.level]}>
                    {entry.text}
                </Text>
            ))}
        </Box>
    );
};

const OverviewDashboard = ({ isActive, pushMessage }) => {
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState(null);
    const [containers, setContainers] = useState([]);
    const [history, setHistory] = useState([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [settingsData, containersData, historyData] = await Promise.all([
                getDeploymentSettings(),
                listManagedContainers({ includeStopped: true }),
                readLifecycleHistory()
            ]);
            setSettings(settingsData);
            setContainers(containersData);
            setHistory(Array.isArray(historyData) ? historyData.slice(-5).reverse() : []);
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to load overview: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage]);

    useEffect(() => {
        load();
    }, [load]);

    useInput((input, key) => {
        if (!isActive) return;
        if (input === 'r' || key.ctrl && input === 'l') {
            load();
        }
    });

    const runningContainers = useMemo(() => containers.filter(item => item.state === 'running'), [containers]);

    return (
        <ViewContainer title="Overview">
            {loading ? (
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading deployment summary…</Text>
            ) : (
                <>
                    <Text bold color="green">Build Scheduler</Text>
                    <Text>
                        Worker threads: {settings?.buildScheduler?.workerThreads ?? '—'} | Subprocesses per worker: {settings?.buildScheduler?.subprocessesPerWorker ?? '—'}
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                        <Text bold color="green">Defaults</Text>
                        <Text>DEBUG level: {settings?.defaults?.debugLevel ?? 'false'}</Text>
                        <Text>Boot mode: {settings?.defaults?.bootMode ?? 'minimal'}</Text>
                    </Box>
                    <Box marginTop={1} flexDirection="column">
                        <Text bold color="green">Container Status</Text>
                        <Text>{runningContainers.length} running / {containers.length} tracked containers</Text>
                        {containers.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                {containers.slice(0, 5).map(container => (
                                    <Text key={container.id}>
                                        {container.name.padEnd(12)} — {container.state.padEnd(10)} {container.ports !== '—' ? `(${container.ports})` : ''}
                                    </Text>
                                ))}
                                {containers.length > 5 && (
                                    <Text dimColor>…and {containers.length - 5} more</Text>
                                )}
                            </Box>
                        )}
                    </Box>
                    <Box marginTop={1} flexDirection="column">
                        <Text bold color="green">Recent Lifecycle Events</Text>
                        {history.length === 0 ? (
                            <Text dimColor>No lifecycle events recorded yet.</Text>
                        ) : history.map(event => (
                            <Text key={`${event.timestamp}-${event.service ?? event.action}`}>
                                {event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'} · {event.service ? `${event.service} · ` : ''}{event.action} · {event.status}
                            </Text>
                        ))}
                    </Box>
                    <Box marginTop={1}>
                        <Text dimColor>Press r to refresh data.</Text>
                    </Box>
                </>
            )}
        </ViewContainer>
    );
};

const BuildQueueManager = ({ isActive, createReporter, pushMessage }) => {
    const serviceList = useMemo(() => [...SERVICES], []);
    const [selectedValues, setSelectedValues] = useState(() => [...serviceList]);
    const [cursor, setCursor] = useState(0);
    const [operation, setOperation] = useState('build');
    const [useNoCache, setUseNoCache] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [jobState, setJobState] = useState({});

    const updateJob = useCallback((service, data) => {
        setJobState(prev => ({
            ...prev,
            [service]: {
                ...(prev[service] || {}),
                ...data,
                updatedAt: Date.now()
            }
        }));
    }, []);

    const handleProgress = useCallback(event => {
        if (!event || !event.service) return;
        switch (event.type) {
            case 'update':
                updateJob(event.service, { status: 'running', message: stripAnsi(event.message || '') });
                break;
            case 'log':
                updateJob(event.service, { status: 'running', message: stripAnsi(event.message || '') });
                break;
            case 'capacity':
                pushMessage({ level: 'info', text: `Scheduler capacity updated to ${event.limit}` });
                break;
            case 'complete':
                updateJob(event.service, {
                    status: event.ok === false || event.status === 'rejected' ? 'failed' : 'succeeded',
                    message: event.error?.message || event.status || 'completed'
                });
                break;
            default:
                break;
        }
    }, [pushMessage, updateJob]);

    const execute = useCallback(async () => {
        if (isRunning) return;
        if (selectedValues.length === 0) {
            pushMessage({ level: 'warn', text: 'Select at least one service before executing an operation.' });
            return;
        }

        setIsRunning(true);
        setJobState({});
        const reporter = createReporter();
        try {
            if (operation === 'build') {
                const result = await buildServices(selectedValues, {
                    useNoCache,
                    reporter,
                    onProgress: handleProgress
                });
                if (!result.ok) {
                    pushMessage({ level: 'warn', text: 'One or more builds reported failures. Review activity log for details.' });
                }
            } else if (operation === 'push') {
                await pushServices(selectedValues, {
                    reporter,
                    onProgress: handleProgress
                });
            } else if (operation === 'pull') {
                await pullServices(selectedValues, {
                    reporter,
                    onProgress: handleProgress
                });
            }
        } catch (error) {
            pushMessage({ level: 'error', text: `${operation} operation failed: ${error.message}` });
        } finally {
            setIsRunning(false);
        }
    }, [createReporter, handleProgress, isRunning, operation, pushMessage, selectedValues, useNoCache]);

    const toggleOperation = useCallback(next => {
        setOperation(next);
        setJobState({});
    }, []);

    useInput((input, key) => {
        if (!isActive) return;
        if (isRunning) return;
        if (key.upArrow || input === 'k') {
            setCursor(current => (current - 1 + serviceList.length) % serviceList.length);
        }
        if (key.downArrow || input === 'j') {
            setCursor(current => (current + 1) % serviceList.length);
        }
        if (input === ' ') {
            const target = serviceList[cursor];
            setSelectedValues(prev => prev.includes(target)
                ? prev.filter(value => value !== target)
                : [...prev, target]);
        }
        if (input === 'b') toggleOperation('build');
        if (input === 'p') toggleOperation('push');
        if (input === 'l') toggleOperation('pull');
        if (input === 'g') execute();
        if (input === 'c' && operation === 'build') setUseNoCache(value => !value);
        if (input === 'a') setSelectedValues([...serviceList]);
        if (input === 'n') setSelectedValues([]);
    });

    const actionLabel = operation === 'build'
        ? `Build selected services${useNoCache ? ' (clean)' : ''}`
        : operation === 'push'
            ? 'Push selected services'
            : 'Pull selected services';

    return (
        <ViewContainer title="Build Queue Manager">
            <Box flexDirection="column">
                <Text>Select services (↑/↓ to move, space to toggle). Press g to run {actionLabel.toLowerCase()}.</Text>
                <Box flexDirection="column" marginTop={1}>
                    {serviceList.map((service, index) => {
                        const isSelected = selectedValues.includes(service);
                        const isHighlighted = index === cursor;
                        return (
                            <Text key={service} color={isHighlighted ? 'cyan' : undefined}>
                                {isHighlighted ? '▸' : ' '} [{isSelected ? 'x' : ' '}] {service}
                            </Text>
                        );
                    })}
                </Box>
                <Box marginTop={1} flexDirection="column">
                    <Text>Operation: {operation === 'build' ? 'Build images' : operation === 'push' ? 'Push to registry' : 'Pull from registry'}</Text>
                    {operation === 'build' && (
                        <Text>Clean build: {useNoCache ? 'enabled' : 'disabled'} (press c to toggle)</Text>
                    )}
                    <Text dimColor>Shortcuts: ↑/↓ move · space toggle · b build · p push · l pull · g execute · a select all · n clear selection</Text>
                </Box>
                {isRunning && (
                    <Text color="cyan"><Spinner type="dots" /> Running {actionLabel}…</Text>
                )}
                {Object.keys(jobState).length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                        {selectedValues.map(service => {
                            const state = jobState[service];
                            if (!state) {
                                return (
                                    <Text key={service} dimColor>{service}: pending…</Text>
                                );
                            }
                            const color = state.status === 'failed' ? 'red' : state.status === 'succeeded' ? 'green' : 'yellow';
                            return (
                                <Text key={service} color={color}>
                                    {state.status === 'running' && <Spinner type="dots" />} {service}: {state.message || state.status}
                                </Text>
                            );
                        })}
                    </Box>
                )}
            </Box>
        </ViewContainer>
    );
};

const ContainerStatusBoard = ({ isActive, createReporter, pushMessage }) => {
    const serviceList = useMemo(() => [...SERVICES], []);
    const [containers, setContainers] = useState([]);
    const [selectedValues, setSelectedValues] = useState(() => [...serviceList]);
    const [cursor, setCursor] = useState(0);
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [operating, setOperating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listManagedContainers({ includeStopped: true });
            setContainers(data);
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to load container status: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage]);

    useEffect(() => {
        load();
    }, [load]);

    useInput((input, key) => {
        if (!isActive) return;
        if (operating) return;
        if (confirmDelete) {
            if (input === 'y' || input === 'Y') {
                handleDelete();
            } else {
                setConfirmDelete(false);
                pushMessage({ level: 'info', text: 'Delete operation cancelled.' });
            }
            return;
        }
        if (input === 'r') load();
        if (input === 'k') handleStopAll();
        if (input === 'x') handleClean();
        if (input === 'd') setConfirmDelete(true);
        if (input === 'w') handleStart();
        if (operating) return;
        if (key.upArrow || input === 'k') {
            setCursor(current => (current - 1 + serviceList.length) % serviceList.length);
        }
        if (key.downArrow || input === 'j') {
            setCursor(current => (current + 1) % serviceList.length);
        }
        if (input === ' ') {
            const target = serviceList[cursor];
            setSelectedValues(prev => prev.includes(target)
                ? prev.filter(value => value !== target)
                : [...prev, target]);
        }
    });

    const handleStopAll = useCallback(async () => {
        setOperating(true);
        const reporter = createReporter();
        try {
            await stopAllContainers({ reporter });
            await load();
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to stop containers: ${error.message}` });
        } finally {
            setOperating(false);
        }
    }, [createReporter, load, pushMessage]);

    const handleClean = useCallback(async () => {
        if (selectedValues.length === 0) {
            pushMessage({ level: 'warn', text: 'Select at least one service to clean.' });
            return;
        }
        setOperating(true);
        const reporter = createReporter();
        try {
            await cleanServices(selectedValues, { reporter });
            await load();
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to clean services: ${error.message}` });
        } finally {
            setOperating(false);
        }
    }, [createReporter, load, pushMessage, selectedValues]);

    const handleStart = useCallback(async () => {
        setOperating(true);
        const reporter = createReporter();
        try {
            await startServices(['warden'], {
                reporter,
                onProgress: event => {
                    if (!event) return;
                    if (event.type === 'complete' && event.ok) {
                        pushMessage({ level: 'success', text: 'Warden reported healthy.' });
                    }
                    if (event.type === 'complete' && event.ok === false) {
                        pushMessage({ level: 'error', text: `Warden failed to start: ${event.error?.message || 'unknown error'}` });
                    }
                },
                onLog: payload => {
                    if (!payload?.line) return;
                    pushMessage({ level: 'info', text: `[${payload.service}] ${stripAnsi(payload.line)}` });
                }
            });
            await load();
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to start warden: ${error.message}` });
        } finally {
            setOperating(false);
        }
    }, [createReporter, load, pushMessage]);

    const handleDelete = useCallback(async () => {
        setConfirmDelete(false);
        setOperating(true);
        const reporter = createReporter();
        try {
            await deleteDockerResources({ reporter, confirm: true });
            await load();
        } catch (error) {
            pushMessage({ level: 'error', text: `Unable to delete Docker resources: ${error.message}` });
        } finally {
            setOperating(false);
        }
    }, [createReporter, load, pushMessage]);

    return (
        <ViewContainer title="Container Status Board">
            {loading ? (
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading container metadata…</Text>
            ) : (
                <>
                    {containers.length === 0 ? (
                        <Text dimColor>No managed containers detected.</Text>
                    ) : (
                        <Box flexDirection="column">
                            {containers.map(container => (
                                <Text key={container.id}>
                                    {container.name.padEnd(12)} · {container.state.padEnd(10)} · {container.ports !== '—' ? container.ports : 'no ports exposed'}
                                </Text>
                            ))}
                        </Box>
                    )}
                    <Box marginTop={1} flexDirection="column">
                        <Text>Select services to clean (↑/↓ to move, space to toggle):</Text>
                        <Box flexDirection="column" marginTop={1}>
                            {serviceList.map((service, index) => {
                                const isSelected = selectedValues.includes(service);
                                const isHighlighted = index === cursor;
                                return (
                                    <Text key={service} color={isHighlighted ? 'cyan' : undefined}>
                                        {isHighlighted ? '▸' : ' '} [{isSelected ? 'x' : ' '}] {service}
                                    </Text>
                                );
                            })}
                        </Box>
                    </Box>
                    <Box marginTop={1} flexDirection="column">
                        <Text>Shortcuts: ↑/↓ move · space toggle · r refresh · k stop all · w start warden · x clean selected · d delete all</Text>
                        {confirmDelete && (
                            <Text color="red">Confirm delete of all Docker resources? Press y to confirm or any other key to cancel.</Text>
                        )}
                        {operating && <Text color="yellow"><Spinner type="dots" /> Executing container operation…</Text>}
                    </Box>
                </>
            )}
        </ViewContainer>
    );
};

const SettingsPanel = ({ isActive, createReporter, pushMessage }) => {
    const [settings, setSettings] = useState(null);
    const [mode, setMode] = useState('menu');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getDeploymentSettings();
            setSettings(data);
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to read settings: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage]);

    useEffect(() => {
        load();
    }, [load]);

    const resetMode = useCallback(() => setMode('menu'), []);

    const handleUpdateConcurrency = useCallback(async (key, value) => {
        const reporter = createReporter();
        try {
            await updateBuildConcurrencyDefaults({ [key]: value });
            await load();
            reporter.success(`Updated ${key} to ${value}.`);
        } catch (error) {
            reporter.error(`Failed to update ${key}: ${error.message}`);
        } finally {
            resetMode();
        }
    }, [createReporter, load, resetMode]);

    const handleUpdateDebug = useCallback(async updates => {
        const reporter = createReporter();
        try {
            await updateDebugDefaults(updates);
            await load();
            reporter.success('Updated default debug configuration.');
        } catch (error) {
            reporter.error(`Failed to update defaults: ${error.message}`);
        } finally {
            resetMode();
        }
    }, [createReporter, load, resetMode]);

    useInput((input, key) => {
        if (!isActive) return;
        if (mode !== 'menu' && key.escape) {
            resetMode();
        }
    });

    if (loading || !settings) {
        return (
            <ViewContainer title="Settings & Defaults">
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading settings…</Text>
            </ViewContainer>
        );
    }

    if (mode === 'menu') {
        const menuItems = [
            { label: 'Adjust worker threads', value: 'workers' },
            { label: 'Adjust subprocesses per worker', value: 'subprocessesPerWorker' },
            { label: 'Set default DEBUG level', value: 'debugLevel' },
            { label: 'Set default boot mode', value: 'bootMode' }
        ];
        return (
            <ViewContainer title="Settings & Defaults">
                <Text>Current build concurrency:</Text>
                <Text>
                    Worker threads: {settings.buildScheduler.workerThreads} | Subprocesses per worker: {settings.buildScheduler.subprocessesPerWorker}
                </Text>
                <Box marginTop={1} flexDirection="column">
                    <Text>Defaults:</Text>
                    <Text>DEBUG level: {settings.defaults.debugLevel}</Text>
                    <Text>Boot mode: {settings.defaults.bootMode}</Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                    <Text>Select a setting to update:</Text>
                    <SelectInput
                        items={menuItems}
                        onSelect={item => setMode(item.value)}
                        focus={isActive}
                    />
                    <Text dimColor>Press esc to cancel any edit.</Text>
                </Box>
            </ViewContainer>
        );
    }

    if (mode === 'workers' || mode === 'subprocessesPerWorker') {
        const options = Array.from({ length: 8 }, (_, index) => ({
            label: String(index + 1),
            value: index + 1
        }));
        return (
            <ViewContainer title="Adjust Concurrency">
                <Text>Select a new value for {mode === 'workers' ? 'worker threads' : 'subprocesses per worker'}:</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateConcurrency(mode === 'workers' ? 'workerThreads' : 'subprocessesPerWorker', item.value)}
                    focus={isActive}
                />
                <Text dimColor>Press esc to cancel.</Text>
            </ViewContainer>
        );
    }

    if (mode === 'debugLevel') {
        const options = ['false', 'true', 'super'].map(value => ({ label: value, value }));
        return (
            <ViewContainer title="Default DEBUG Level">
                <Text>Select the default DEBUG level for container launches:</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateDebug({ debugLevel: item.value })}
                    focus={isActive}
                />
                <Text dimColor>Press esc to cancel.</Text>
            </ViewContainer>
        );
    }

    if (mode === 'bootMode') {
        const options = ['minimal', 'super'].map(value => ({ label: value, value }));
        return (
            <ViewContainer title="Default Boot Mode">
                <Text>Select the default boot mode for Warden:</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateDebug({ bootMode: item.value })}
                    focus={isActive}
                />
                <Text dimColor>Press esc to cancel.</Text>
            </ViewContainer>
        );
    }

    return null;
};

const App = () => {
    const { exit } = useApp();
    const [view, setView] = useState('overview');
    const { messages, pushMessage, createReporter } = useMessageLog();

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            exit();
            return;
        }
        if (input === 'q') {
            exit();
            return;
        }
        const order = ['overview', 'builds', 'containers', 'settings'];
        const index = order.indexOf(view);
        if (key.leftArrow || input === 'h') {
            const next = (index - 1 + order.length) % order.length;
            setView(order[next]);
        }
        if (key.rightArrow || input === 'l') {
            const next = (index + 1) % order.length;
            setView(order[next]);
        }
        if (['1', '2', '3', '4'].includes(input)) {
            setView(order[Number.parseInt(input, 10) - 1]);
        }
    });

    return (
        <Box flexDirection="column">
            <Box flexDirection="row">
                <Navigation active={view} />
                {view === 'overview' && (
                    <OverviewDashboard isActive pushMessage={pushMessage} />
                )}
                {view === 'builds' && (
                    <BuildQueueManager isActive createReporter={createReporter} pushMessage={pushMessage} />
                )}
                {view === 'containers' && (
                    <ContainerStatusBoard isActive createReporter={createReporter} pushMessage={pushMessage} />
                )}
                {view === 'settings' && (
                    <SettingsPanel isActive createReporter={createReporter} pushMessage={pushMessage} />
                )}
            </Box>
            <MessagePanel messages={messages} />
            <Text dimColor>Accessibility: navigation via keyboard, high-contrast colors, spinner feedback during operations.</Text>
        </Box>
    );
};

render(<App />);
