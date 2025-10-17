#!/usr/bin/env node
import React, {
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
    forwardRef,
    useImperativeHandle,
    useContext
} from 'react';
import { render, Box, Text, useApp, useInput, Static, useStdoutDimensions } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { spawn } from 'child_process';
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
    listManagedContainers,
    appendDeploymentLogEntry,
    getActiveDeploymentLogFile,
    LOG_DIR
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

const normalizeLogEntry = (entry = {}) => ({
    id: entry.id || `${Date.now()}-${Math.random()}`,
    level: entry.level || 'info',
    text: stripAnsi(entry.text ?? ''),
    timestamp: entry.timestamp || Date.now()
});

const createTickerEntry = (entry = {}) => ({
    level: entry.level || 'info',
    text: stripAnsi(entry.text ?? ''),
    timestamp: entry.timestamp || Date.now()
});

const useEventTicker = () => {
    const storeRef = useRef(createTickerEntry({ text: 'Deployment control ready.' }));
    const listenersRef = useRef(new Set());

    const push = useCallback(entry => {
        const normalized = createTickerEntry(entry);
        storeRef.current = normalized;
        listenersRef.current.forEach(listener => {
            try {
                listener();
            } catch {
                // ignore listener failures
            }
        });
        return normalized;
    }, []);

    const subscribe = useCallback(listener => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
    }, []);

    const getSnapshot = useCallback(() => storeRef.current, []);

    return { push, subscribe, getSnapshot };
};

const usePersistentLog = () => {
    const readyRef = useRef(false);

    useEffect(() => {
        getActiveDeploymentLogFile()
            .then(() => {
                readyRef.current = true;
            })
            .catch(() => {
                readyRef.current = false;
            });
    }, []);

    return useCallback(entry => {
        const normalized = normalizeLogEntry(entry);
        if (!normalized.text) {
            return normalized;
        }
        if (!readyRef.current) {
            appendDeploymentLogEntry(normalized.level, normalized.text).catch(() => {});
            return normalized;
        }
        appendDeploymentLogEntry(normalized.level, normalized.text).catch(() => {});
        return normalized;
    }, []);
};

const useTerminalLayout = () => {
    const dimensions = useStdoutDimensions();
    const width = dimensions?.[0] ?? 80;
    const height = dimensions?.[1] ?? 24;

    return useMemo(() => {
        const isTiny = width < 60;
        const isSmall = width < 80;
        const isCompact = width < 100;
        const isNarrow = width < 120;
        const isWide = width >= 140;
        const isTall = height >= 35;

        return {
            width,
            height,
            isTiny,
            isSmall,
            isCompact,
            isNarrow,
            isWide,
            isTall
        };
    }, [width, height]);
};

const DeploymentContext = React.createContext(null);
const TickerContext = React.createContext(null);
const LayoutContext = React.createContext(null);

const useDeployment = () => {
    const ctx = useContext(DeploymentContext);
    if (!ctx) {
        throw new Error('Deployment context unavailable');
    }
    return ctx;
};

const useLayout = () => {
    const ctx = useContext(LayoutContext);
    if (!ctx) {
        throw new Error('Layout context unavailable');
    }
    return ctx;
};

const Pane = ({ title, children }) => {
    const layout = useLayout();
    const horizontalPadding = layout.isTiny ? 0 : 1;
    const horizontalMargin = layout.isNarrow ? 0 : 1;

    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="round"
            borderColor="cyan"
            paddingX={horizontalPadding}
            paddingY={1}
            marginX={horizontalMargin}
            marginBottom={layout.isNarrow ? 1 : 0}
        >
            {title && (
                <Text color="cyan" bold>
                    {title}
                </Text>
            )}
            <Box marginTop={title ? 1 : 0} flexDirection="column" flexGrow={1}>
                {children}
            </Box>
        </Box>
    );
};

const Card = ({ title, subtitle, children }) => {
    const layout = useLayout();
    const horizontalPadding = layout.isTiny ? 0 : 1;
    const verticalPadding = layout.isCompact ? 0 : 1;

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={horizontalPadding}
            paddingY={verticalPadding}
            marginBottom={1}
        >
            {title && (
                <Text bold>{title}</Text>
            )}
            {subtitle && (
                <Text dimColor>{subtitle}</Text>
            )}
            <Box marginTop={title || subtitle ? 1 : 0} flexDirection="column">
                {children}
            </Box>
        </Box>
    );
};

const MetricGroup = ({ items }) => {
    const layout = useLayout();
    const isStacked = layout.isNarrow;

    return (
        <Box flexDirection={isStacked ? 'column' : 'row'} flexWrap={isStacked ? 'nowrap' : 'wrap'}>
            {items.map((item, index) => (
                <Box
                    key={item.label}
                    flexDirection="column"
                    marginRight={!isStacked && index < items.length - 1 ? 3 : 0}
                    marginBottom={isStacked && index < items.length - 1 ? 1 : 0}
                >
                    <Text dimColor>{item.label}</Text>
                    <Text bold color={item.color}>
                        {item.value}
                    </Text>
                </Box>
            ))}
        </Box>
    );
};

const NAVIGATION_ITEMS = [
    { id: 'overview', label: 'Overview' },
    { id: 'builds', label: 'Build Operations' },
    { id: 'containers', label: 'Containers' },
    { id: 'settings', label: 'Settings' }
];

const TopNavBar = React.memo(({ mission, activeViewId, activeViewLabel, navigationItems }) => {
    const layout = useLayout();
    const missionSummary = [
        {
            key: 'environment',
            label: 'Active Environment',
            value: mission.environment || 'local'
        },
        {
            key: 'capacity',
            label: 'Build Capacity',
            value: mission.capacity ?? '—'
        },
        {
            key: 'warden',
            label: 'Warden Status',
            value: mission.wardenStatus || 'unknown',
            color: mission.wardenStatus === 'running'
                ? 'green'
                : mission.wardenStatus === 'starting'
                    ? 'yellow'
                    : 'red'
        },
        {
            key: 'canvas',
            label: 'Canvas',
            value: activeViewLabel
        }
    ];

    const systemActions = [
        { key: 'palette', label: 'Command Palette', hint: 'Ctrl+Space · F1' },
        { key: 'navigate', label: 'Change View', hint: '←/→ · 1-4' },
        { key: 'exit', label: 'Exit', hint: 'q · Ctrl+C' }
    ];

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={layout.isTiny ? 0 : 1}
            paddingY={layout.isCompact ? 0 : 1}
            marginBottom={1}
        >
            <Box
                flexDirection="row"
                flexWrap="wrap"
                alignItems="flex-start"
                justifyContent="space-between"
            >
                <Box flexDirection="row" flexWrap="wrap">
                    {missionSummary.map((item, index) => (
                        <Box
                            key={item.key}
                            flexDirection="column"
                            marginRight={index < missionSummary.length - 1 ? 3 : 0}
                            marginBottom={layout.isNarrow ? 1 : 0}
                        >
                            <Text dimColor>{item.label}</Text>
                            <Text bold color={item.color}>
                                {item.value}
                            </Text>
                        </Box>
                    ))}
                </Box>
                <Box
                    flexDirection="row"
                    flexWrap="wrap"
                    alignItems="center"
                    marginTop={layout.isNarrow ? 1 : 0}
                >
                    {navigationItems.map((item, index) => {
                        const isActive = item.id === activeViewId;
                        return (
                            <Box key={item.id} marginRight={index < navigationItems.length - 1 ? 2 : 0}>
                                <Text color={isActive ? 'green' : 'gray'} bold={isActive}>
                                    {index + 1}. {item.label}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
            <Box
                marginTop={1}
                flexDirection="row"
                flexWrap="wrap"
                alignItems="center"
            >
                {systemActions.map((action, index) => (
                    <Box key={action.key} marginRight={index < systemActions.length - 1 ? 3 : 0}>
                        <Text dimColor>
                            {action.label}: {action.hint}
                        </Text>
                    </Box>
                ))}
                <Text dimColor>Active view updates only its canvas for faster feedback.</Text>
            </Box>
        </Box>
    );
});

const StatusBar = () => {
    const layout = useLayout();
    const ticker = useContext(TickerContext);
    const entry = useSyncExternalStore(ticker.subscribe, ticker.getSnapshot);
    const palette = {
        info: undefined,
        success: 'green',
        warn: 'yellow',
        error: 'red'
    };
    return (
        <Box
            borderStyle="round"
            borderColor="gray"
            paddingX={layout.isTiny ? 0 : 1}
            paddingY={0}
            marginTop={1}
        >
            <Text color={palette[entry.level]}>
                [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.text || 'Ready'}
            </Text>
            <Text dimColor> · F1 for help · Ctrl+Space Command Palette</Text>
        </Box>
    );
};

const COMMAND_DEFINITIONS = [
    { id: 'build', label: 'Build selected services', hint: 'b', action: 'build' },
    { id: 'push', label: 'Push selected services', hint: 'p', action: 'push' },
    { id: 'pull', label: 'Pull selected services', hint: 'u', action: 'pull' },
    { id: 'logs', label: 'Open logs directory', hint: 'o', action: 'logs' }
];

const CommandPalette = ({ visible }) => {
    const layout = useLayout();
    if (!visible) return null;
    return (
        <Box
            borderStyle="double"
            borderColor="cyan"
            paddingX={layout.isTiny ? 0 : 1}
            paddingY={layout.isCompact ? 0 : 1}
            flexDirection="column"
            marginTop={1}
        >
            <Text color="cyan" bold>
                Command Palette
            </Text>
            <Text dimColor>Press the highlighted key to trigger an action. Esc to close.</Text>
            <Box marginTop={1} flexDirection="column">
                {COMMAND_DEFINITIONS.map(cmd => (
                    <Text key={cmd.id}>
                        <Text color="green">{cmd.hint.toUpperCase()}</Text> – {cmd.label}
                    </Text>
                ))}
            </Box>
        </Box>
    );
};

const createLogBuffer = (limit = 200) => ({
    limit,
    entries: [],
    push(entry) {
        if (!entry || !entry.text) return;
        this.entries.push(entry);
        if (this.entries.length > this.limit) {
            this.entries.splice(0, this.entries.length - this.limit);
        }
    }
});

const TAB_DEFINITIONS = [
    { id: 'build', label: 'Build Images' },
    { id: 'push', label: 'Push Images' },
    { id: 'pull', label: 'Pull Images' }
];

const createTabState = () => ({
    jobs: {},
    logBuffer: createLogBuffer(),
    queueSize: 0,
    capacity: null,
    isRunning: false,
    lastServices: [],
    lastUpdated: null,
    version: 0
});

const tabReducer = (state, action) => {
    const target = action.tabId ? (state[action.tabId] || createTabState()) : null;
    switch (action.type) {
        case 'RESET': {
            const snapshot = createTabState();
            snapshot.isRunning = true;
            snapshot.lastUpdated = Date.now();
            snapshot.lastServices = action.services || [];
            snapshot.jobs = (action.services || []).reduce((acc, svc) => {
                acc[svc] = { status: 'pending', message: 'Pending…' };
                return acc;
            }, {});
            if (action.headline) {
                snapshot.logBuffer.push(normalizeLogEntry({ level: 'info', text: action.headline }));
            }
            return {
                ...state,
                [action.tabId]: snapshot
            };
        }
        case 'UPDATE': {
            if (!target) return state;
            const next = { ...target, version: target.version + 1 };
            if (action.updater) {
                action.updater(next);
            }
            return {
                ...state,
                [action.tabId]: next
            };
        }
        case 'COMPLETE': {
            if (!target) return state;
            return {
                ...state,
                [action.tabId]: {
                    ...target,
                    isRunning: false,
                    lastUpdated: Date.now(),
                    version: target.version + 1
                }
            };
        }
        default:
            return state;
    }
};

const useTabsReducer = () => useReducer(tabReducer, TAB_DEFINITIONS.reduce((acc, tab) => {
    acc[tab.id] = createTabState();
    return acc;
}, {}));

const QueuePane = ({
    services,
    cursor,
    selection,
    operation,
    useNoCache
}) => {
    const actionLabel = operation === 'build'
        ? `Build selected services${useNoCache ? ' (clean)' : ''}`
        : operation === 'push'
            ? 'Push selected services'
            : 'Pull selected services';

    return (
        <Pane title="Service Queue">
            <Text>Select services to include in the operation. Press enter or g to execute.</Text>
            <Box marginTop={1} flexDirection="column">
                {services.map((service, index) => {
                    const isSelected = selection.includes(service);
                    const isHighlighted = index === cursor;
                    return (
                        <Text key={service} color={isHighlighted ? 'cyan' : undefined}>
                            {isHighlighted ? '▸' : ' '} [{isSelected ? 'x' : ' '}] {service}
                        </Text>
                    );
                })}
            </Box>
            <Card title="Operation">
                <Text>Mode: {operation === 'build' ? 'Build images' : operation === 'push' ? 'Push to registry' : 'Pull from registry'}</Text>
                {operation === 'build' && (
                    <Text>Clean build: {useNoCache ? 'enabled' : 'disabled'} (press c to toggle)</Text>
                )}
                <Text dimColor>Shortcuts: ↑/↓ move · space toggle · b build · p push · u pull · g/enter execute · a select all · n clear</Text>
                <Box marginTop={1}>
                    <Text color="green">{actionLabel}</Text>
                </Box>
            </Card>
        </Pane>
    );
};

const LiveLogPane = ({ tabState }) => {
    const palette = {
        info: undefined,
        warn: 'yellow',
        error: 'red',
        success: 'green'
    };
    const statusPalette = {
        pending: 'gray',
        queued: 'yellow',
        running: 'cyan',
        succeeded: 'green',
        failed: 'red'
    };
    const services = tabState.lastServices;
    return (
        <Pane title="Live Activity">
            <Card title="Scheduler">
                <MetricGroup
                    items={[
                        { label: 'Capacity', value: tabState.capacity ?? '—' },
                        { label: 'Queue size', value: tabState.queueSize ?? 0 },
                        { label: 'Running', value: tabState.isRunning ? 'yes' : 'no', color: tabState.isRunning ? 'green' : undefined }
                    ]}
                />
            </Card>
            <Card title="Status by Service">
                {services.length === 0 ? (
                    <Text dimColor>No services queued yet.</Text>
                ) : (
                    <Box flexDirection="column">
                        {services.map(service => {
                            const state = tabState.jobs[service];
                            if (!state) {
                                return (
                                    <Text key={service} dimColor>
                                        {service}: pending…
                                    </Text>
                                );
                            }
                            return (
                                <Text key={service} color={statusPalette[state.status]}> {state.status === 'running' && <Spinner type="dots" />} {service}: {state.message}</Text>
                            );
                        })}
                    </Box>
                )}
            </Card>
            <Card title="Logs">
                {tabState.isRunning && (
                    <Box marginBottom={1}>
                        <Text color="cyan"><Spinner type="dots" /> Running operation…</Text>
                    </Box>
                )}
                {tabState.logBuffer.entries.length === 0 ? (
                    <Text dimColor>No logs captured yet.</Text>
                ) : (
                    <Static items={tabState.logBuffer.entries}>
                        {entry => (
                            <Text key={entry.id} color={palette[entry.level]}>
                                [{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—'}] {entry.text}
                            </Text>
                        )}
                    </Static>
                )}
            </Card>
        </Pane>
    );
};

const ActiveBuildsSection = ({
    services,
    cursor,
    selection,
    operation,
    useNoCache,
    tabState
}) => {
    const layout = useLayout();
    const direction = layout.isNarrow ? 'column' : 'row';

    return (
        <Box flexDirection={direction} flexGrow={0} flexShrink={0} marginBottom={1}>
            <QueuePane
                services={services}
                cursor={cursor}
                selection={selection}
                operation={operation}
                useNoCache={useNoCache}
            />
            <LiveLogPane tabState={tabState} />
        </Box>
    );
};

const BuildOperationsView = React.memo(forwardRef(({ isActive }, ref) => {
    const { pushMessage, createReporter, updateMission } = useDeployment();
    const services = useMemo(() => [...SERVICES], []);
    const [cursor, setCursor] = useState(0);
    const [selection, setSelection] = useState(() => [...services]);
    const [operation, setOperation] = useState('build');
    const [useNoCache, setUseNoCache] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [tabs, dispatch] = useTabsReducer();

    const setActiveOperation = useCallback(next => {
        setOperation(next);
    }, []);

    const initializeRun = useCallback((tabId, selectedServices, headline) => {
        dispatch({ type: 'RESET', tabId, services: selectedServices, headline });
    }, []);

    const finalizeRun = useCallback((tabId) => {
        dispatch({ type: 'COMPLETE', tabId });
    }, []);

    const handleProgress = useCallback((tabId, event) => {
        if (!event) return;
        const normalizedMessage = event.message ? stripAnsi(event.message) : '';
        const now = Date.now();
        dispatch({
            type: 'UPDATE',
            tabId,
            updater: next => {
                const pushLog = (text, level = 'info') => {
                    if (!text) return;
                    next.logBuffer.push(normalizeLogEntry({ text, level, timestamp: now }));
                };
                if (event.type === 'capacity' && typeof event.limit === 'number') {
                    next.capacity = event.limit;
                    pushLog(`Scheduler capacity set to ${event.limit}.`);
                    updateMission({ capacity: event.limit });
                }
                if (event.service) {
                    if (!next.lastServices.includes(event.service)) {
                        next.lastServices = [...next.lastServices, event.service];
                    }
                }
                if (event.type === 'enqueue' && event.service) {
                    next.jobs = {
                        ...next.jobs,
                        [event.service]: {
                            status: 'queued',
                            message: `Queued (${event.queueSize ?? 'pending'} ahead)`
                        }
                    };
                    next.queueSize = event.queueSize ?? next.queueSize;
                    next.isRunning = true;
                    pushLog(`[${event.service}] queued for execution.`);
                }
                if ((event.type === 'log' || event.type === 'update' || event.type === 'start') && event.service) {
                    next.jobs = {
                        ...next.jobs,
                        [event.service]: {
                            status: 'running',
                            message: normalizedMessage || 'Running…'
                        }
                    };
                    next.isRunning = true;
                    pushLog(`[${event.service}] ${normalizedMessage || 'Running…'}`, event.level || 'info');
                }
                if (event.type === 'error' && event.service) {
                    const detail = normalizedMessage || event.error?.message || 'Error reported.';
                    next.jobs = {
                        ...next.jobs,
                        [event.service]: {
                            status: 'failed',
                            message: detail
                        }
                    };
                    next.isRunning = true;
                    pushLog(`[${event.service}] ${detail}`, 'error');
                }
                if (event.type === 'complete' && event.service) {
                    const succeeded = event.status === 'fulfilled' || (event.ok !== false && event.status !== 'rejected');
                    const detail = succeeded
                        ? normalizedMessage || 'Completed successfully.'
                        : event.error?.message || normalizedMessage || 'Failed.';
                    next.jobs = {
                        ...next.jobs,
                        [event.service]: {
                            status: succeeded ? 'succeeded' : 'failed',
                            message: detail
                        }
                    };
                    pushLog(`[${event.service}] ${detail}`, succeeded ? 'success' : 'error');
                    if (!succeeded && Array.isArray(event.logs)) {
                        event.logs.slice(-5).forEach(line => {
                            pushLog(`[${event.service}] ${stripAnsi(line)}`, 'error');
                        });
                    }
                }
                if (event.type === 'idle') {
                    next.isRunning = false;
                    pushLog('Scheduler idle.');
                }
                const allComplete = Object.keys(next.jobs).length > 0 && Object.values(next.jobs).every(job => ['succeeded', 'failed'].includes(job.status));
                if (allComplete) {
                    next.isRunning = false;
                }
                next.queueSize = typeof event.queueSize === 'number' ? event.queueSize : next.queueSize;
                next.lastUpdated = now;
            }
        });
    }, [updateMission]);

    const executeOperation = useCallback(async (overrideOperation) => {
        const op = overrideOperation || operation;
        const selected = selection;
        if (isRunning) return;
        if (selected.length === 0) {
            pushMessage({ level: 'warn', text: 'Select at least one service before executing an operation.' });
            return;
        }
        setIsRunning(true);
        const headlineServices = selected.join(', ');
        const actionVerb = op === 'build' ? 'Starting build' : op === 'push' ? 'Starting push' : 'Starting pull';
        const headline = headlineServices ? `${actionVerb} for ${headlineServices}` : actionVerb;
        initializeRun(op, selected, headline);
        const reporter = createReporter();
        try {
            if (op === 'build') {
                const result = await buildServices(selected, {
                    useNoCache,
                    reporter,
                    onProgress: event => handleProgress('build', event)
                });
                if (!result.ok) {
                    pushMessage({ level: 'warn', text: 'One or more builds reported failures. Review activity log for details.' });
                }
            } else if (op === 'push') {
                await pushServices(selected, {
                    reporter,
                    onProgress: event => handleProgress('push', event)
                });
            } else if (op === 'pull') {
                await pullServices(selected, {
                    reporter,
                    onProgress: event => handleProgress('pull', event)
                });
            }
        } catch (error) {
            pushMessage({ level: 'error', text: `${op} operation failed: ${error.message}` });
        } finally {
            setIsRunning(false);
            finalizeRun(op);
        }
    }, [createReporter, finalizeRun, handleProgress, initializeRun, isRunning, operation, pushMessage, selection, useNoCache]);

    useImperativeHandle(ref, () => ({
        focusOperation: (op) => {
            setActiveOperation(op);
        },
        runOperation: (op) => {
            setActiveOperation(op);
            executeOperation(op);
        }
    }), [executeOperation, setActiveOperation]);

    useInput((input, key) => {
        if (!isActive) return;
        if (key.return || input === 'g') {
            executeOperation();
            return;
        }
        if (key.upArrow || input === 'k') {
            setCursor(current => (current - 1 + services.length) % services.length);
        }
        if (key.downArrow || input === 'j') {
            setCursor(current => (current + 1) % services.length);
        }
        if (input === ' ') {
            const target = services[cursor];
            setSelection(prev => prev.includes(target)
                ? prev.filter(value => value !== target)
                : [...prev, target]);
        }
        if (input === 'a') setSelection([...services]);
        if (input === 'n') setSelection([]);
        if (input === 'b') setActiveOperation('build');
        if (input === 'p') setActiveOperation('push');
        if (input === 'u' || input === 'l') setActiveOperation('pull');
        if (input === 'c' && operation === 'build') {
            setUseNoCache(value => !value);
        }
    });

    const activeTabState = tabs[operation] || createTabState();

    return (
        <ActiveBuildsSection
            services={services}
            cursor={cursor}
            selection={selection}
            operation={operation}
            useNoCache={useNoCache}
            tabState={activeTabState}
        />
    );
}));

const OverviewDashboard = React.memo(({ isActive }) => {
    const { pushMessage, updateMission } = useDeployment();
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
            updateMission({
                environment: settingsData?.defaults?.environment || settingsData?.environment || 'local',
                capacity: settingsData?.buildScheduler?.workerThreads ?? null,
                wardenStatus: containersData?.find(item => item?.name === 'warden')?.state || 'unknown'
            });
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to load overview: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage, updateMission]);

    useEffect(() => {
        load();
    }, [load]);

    useInput((input, key) => {
        if (!isActive) return;
        if (input === 'r' || (key.ctrl && input === 'l')) {
            load();
        }
    });

    const runningContainers = useMemo(() => containers.filter(item => item.state === 'running'), [containers]);

    return (
        <Pane title="Overview">
            {loading ? (
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading deployment summary…</Text>
            ) : (
                <>
                    <Card title="Build Scheduler" subtitle="Current defaults">
                        <MetricGroup
                            items={[{
                                label: 'Worker threads',
                                value: settings?.buildScheduler?.workerThreads ?? '—'
                            }, {
                                label: 'Subprocesses per worker',
                                value: settings?.buildScheduler?.subprocessesPerWorker ?? '—'
                            }, {
                                label: 'DEBUG level',
                                value: settings?.defaults?.debugLevel ?? 'false'
                            }, {
                                label: 'Boot mode',
                                value: settings?.defaults?.bootMode ?? 'minimal'
                            }]}
                        />
                    </Card>
                    <Card title="Container Status">
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
                    </Card>
                    <Card title="Recent Lifecycle Events">
                        {history.length === 0 ? (
                            <Text dimColor>No lifecycle events recorded yet.</Text>
                        ) : history.map(event => (
                            <Text key={`${event.timestamp}-${event.service ?? event.action}`}>
                                {event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'} · {event.service ? `${event.service} · ` : ''}{event.action} · {event.status}
                            </Text>
                        ))}
                    </Card>
                    <Text dimColor>Press r to refresh data.</Text>
                </>
            )}
        </Pane>
    );
});

const ContainerStatusBoard = React.memo(({ isActive }) => {
    const { pushMessage, createReporter, updateMission } = useDeployment();
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
            const warden = data?.find(item => item?.name === 'warden');
            if (warden) {
                updateMission({ wardenStatus: warden.state });
            }
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to load container status: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage, updateMission]);

    useEffect(() => {
        load();
    }, [load]);

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
                        updateMission({ wardenStatus: 'running' });
                    }
                    if (event.type === 'complete' && event.ok === false) {
                        pushMessage({ level: 'error', text: `Warden failed to start: ${event.error?.message || 'unknown error'}` });
                        updateMission({ wardenStatus: 'error' });
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
    }, [createReporter, load, pushMessage, updateMission]);

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

    return (
        <Pane title="Container Status">
            {loading ? (
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading container metadata…</Text>
            ) : (
                <>
                    {containers.length === 0 ? (
                        <Text dimColor>No managed containers detected.</Text>
                    ) : (
                        <Card title="Tracked Containers">
                            {containers.map(container => (
                                <Text key={container.id}>
                                    {container.name.padEnd(12)} · {container.state.padEnd(10)} · {container.ports !== '—' ? container.ports : 'no ports exposed'}
                                </Text>
                            ))}
                        </Card>
                    )}
                    <Card title="Maintenance Queue">
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
                    </Card>
                    <Text>Shortcuts: r refresh · k stop all · w start warden · x clean selected · d delete all</Text>
                    {confirmDelete && (
                        <Text color="red">Confirm delete of all Docker resources? Press y to confirm or any other key to cancel.</Text>
                    )}
                    {operating && <Text color="yellow"><Spinner type="dots" /> Executing container operation…</Text>}
                </>
            )}
        </Pane>
    );
});

const SettingsPanel = React.memo(({ isActive }) => {
    const { pushMessage, createReporter, updateMission } = useDeployment();
    const [settings, setSettings] = useState(null);
    const [mode, setMode] = useState('menu');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getDeploymentSettings();
            setSettings(data);
            updateMission({
                environment: data?.defaults?.environment || data?.environment || 'local',
                capacity: data?.buildScheduler?.workerThreads ?? null
            });
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to load deployment settings: ${error.message}` });
        } finally {
            setLoading(false);
        }
    }, [pushMessage, updateMission]);

    useEffect(() => {
        load();
    }, [load]);

    const handleUpdateBuild = useCallback(async (patch) => {
        const reporter = createReporter();
        try {
            await updateBuildConcurrencyDefaults(patch, { reporter });
            await load();
            pushMessage({ level: 'success', text: 'Updated build scheduler defaults.' });
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to update build scheduler: ${error.message}` });
        }
    }, [createReporter, load, pushMessage]);

    const handleUpdateDebug = useCallback(async (patch) => {
        const reporter = createReporter();
        try {
            await updateDebugDefaults(patch, { reporter });
            await load();
            pushMessage({ level: 'success', text: 'Updated debug defaults.' });
        } catch (error) {
            pushMessage({ level: 'error', text: `Failed to update debug defaults: ${error.message}` });
        }
    }, [createReporter, load, pushMessage]);

    useInput((input, key) => {
        if (!isActive) return;
        if (mode !== 'menu' && key.escape) {
            setMode('menu');
            return;
        }
        if (mode === 'menu') {
            if (input === '1') setMode('build');
            if (input === '2') setMode('debug');
            if (input === '3') setMode('boot');
        }
    });

    if (loading) {
        return (
            <Pane title="Settings">
                <Text><Text color="cyan"><Spinner type="dots" /></Text> Loading deployment settings…</Text>
            </Pane>
        );
    }

    if (mode === 'menu') {
        return (
            <Pane title="Settings">
                <Card title="Adjust Defaults" subtitle="Press 1-3 to choose a setting to update">
                    <Text>1. Update build scheduler defaults</Text>
                    <Text>2. Toggle debug defaults</Text>
                    <Text>3. Change default boot mode</Text>
                    <Text dimColor>Press the corresponding number key. Esc returns from an edit screen.</Text>
                </Card>
            </Pane>
        );
    }

    if (mode === 'build') {
        const options = [
            { label: '1 worker thread', value: { workerThreads: 1 } },
            { label: '2 worker threads', value: { workerThreads: 2 } },
            { label: '4 worker threads', value: { workerThreads: 4 } },
            { label: '8 worker threads', value: { workerThreads: 8 } },
            { label: '1 subprocess per worker', value: { subprocessesPerWorker: 1 } },
            { label: '2 subprocesses per worker', value: { subprocessesPerWorker: 2 } },
            { label: '4 subprocesses per worker', value: { subprocessesPerWorker: 4 } }
        ];
        return (
            <Pane title="Build Scheduler Defaults">
                <Text>Select a preset to update concurrency.</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateBuild(item.value)}
                    focus={isActive}
                />
                <Text dimColor>Press esc to return.</Text>
            </Pane>
        );
    }

    if (mode === 'debug') {
        const options = [
            { label: 'Enable DEBUG logging', value: { debugLevel: 'true' } },
            { label: 'Disable DEBUG logging', value: { debugLevel: 'false' } }
        ];
        return (
            <Pane title="Debug Logging">
                <Text>Toggle DEBUG level logging across services.</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateDebug(item.value)}
                    focus={isActive}
                />
                <Text dimColor>Press esc to return.</Text>
            </Pane>
        );
    }

    if (mode === 'boot') {
        const options = ['minimal', 'super'].map(value => ({ label: value, value }));
        return (
            <Pane title="Default Boot Mode">
                <Text>Select the default boot mode for Warden:</Text>
                <SelectInput
                    items={options}
                    onSelect={item => handleUpdateDebug({ bootMode: item.value })}
                    focus={isActive}
                />
                <Text dimColor>Press esc to return.</Text>
            </Pane>
        );
    }

    return null;
});

const openLogsDirectory = () => {
    const opener = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'explorer'
            : 'xdg-open';
    try {
        const child = spawn(opener, [LOG_DIR], {
            stdio: 'ignore',
            detached: true
        });
        child.unref();
    } catch (error) {
        // fallback handled by caller
    }
};

const DeploymentLayout = () => {
    const { exit } = useApp();
    const ticker = useEventTicker();
    const persistLog = usePersistentLog();
    const layout = useTerminalLayout();
    const [activeView, setActiveView] = useState('overview');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [mission, setMission] = useState({ environment: 'local', capacity: '—', wardenStatus: 'unknown' });
    const buildRef = useRef(null);

    const updateMission = useCallback(patch => {
        setMission(prev => ({ ...prev, ...patch }));
    }, []);

    const persist = useCallback((entry) => {
        persistLog(entry);
    }, [persistLog]);

    const pushMessage = useCallback((entry, options = {}) => {
        const normalized = normalizeLogEntry(entry);
        if (!normalized.text) {
            return normalized;
        }
        ticker.push(normalized);
        if (!options.skipPersist) {
            persist(normalized);
        }
        return normalized;
    }, [persist, ticker]);

    const createReporter = useCallback(() => ({
        info: message => pushMessage({ level: 'info', text: stripAnsi(message) }, { skipPersist: true }),
        warn: message => pushMessage({ level: 'warn', text: stripAnsi(message) }, { skipPersist: true }),
        error: message => pushMessage({ level: 'error', text: stripAnsi(message) }, { skipPersist: true }),
        success: message => pushMessage({ level: 'success', text: stripAnsi(message) }, { skipPersist: true }),
        table: (data, columns) => pushMessage({ level: 'info', text: formatTable(data, columns) }, { skipPersist: true })
    }), [pushMessage]);

    useEffect(() => {
        (async () => {
            try {
                const [settingsData, containersData] = await Promise.all([
                    getDeploymentSettings().catch(() => null),
                    listManagedContainers({ includeStopped: true }).catch(() => [])
                ]);
                updateMission({
                    environment: settingsData?.defaults?.environment || settingsData?.environment || 'local',
                    capacity: settingsData?.buildScheduler?.workerThreads ?? '—',
                    wardenStatus: containersData?.find(item => item?.name === 'warden')?.state || 'unknown'
                });
            } catch {
                // ignore
            }
        })();
    }, [updateMission]);

    const contextValue = useMemo(() => ({
        pushMessage,
        createReporter,
        updateMission,
        mission,
        requestView: setActiveView
    }), [pushMessage, createReporter, updateMission, mission]);

    const executeBuildCommand = useCallback(command => {
        if (!command) {
            return;
        }
        if (command.type === 'focus') {
            setActiveView('builds');
            buildRef.current?.focusOperation(command.operation);
            return;
        }
        if (command.type === 'run') {
            buildRef.current?.runOperation(command.operation);
        }
    }, [setActiveView]);

    const requestBuildCommand = useCallback(command => {
        setPaletteOpen(false);
        executeBuildCommand(command);
    }, [executeBuildCommand]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            exit();
            return;
        }
        if (input === 'q') {
            exit();
            return;
        }
        if (key.ctrl && input === ' ') {
            setPaletteOpen(prev => !prev);
            return;
        }
        if (key.f1) {
            setPaletteOpen(true);
            return;
        }
        if (paletteOpen) {
            if (key.escape) {
                setPaletteOpen(false);
                return;
            }
            if (input === 'b') {
                requestBuildCommand({ type: 'focus', operation: 'build' });
                return;
            }
            if (input === 'p') {
                requestBuildCommand({ type: 'run', operation: 'push' });
                return;
            }
            if (input === 'u') {
                requestBuildCommand({ type: 'run', operation: 'pull' });
                return;
            }
            if (input === 'o') {
                setPaletteOpen(false);
                try {
                    openLogsDirectory();
                    pushMessage({ level: 'info', text: `Opened logs directory at ${LOG_DIR}` });
                } catch (error) {
                    pushMessage({ level: 'warn', text: `Unable to open logs directory automatically. Path: ${LOG_DIR}` });
                }
                return;
            }
            return;
        }
        const order = NAVIGATION_ITEMS.map(item => item.id);
        const index = order.indexOf(activeView);
        if (key.leftArrow || input === 'h') {
            const next = (index - 1 + order.length) % order.length;
            setActiveView(order[next]);
        }
        if (key.rightArrow || input === 'l') {
            const next = (index + 1) % order.length;
            setActiveView(order[next]);
        }
        if (['1', '2', '3', '4'].includes(input)) {
            setActiveView(order[Number.parseInt(input, 10) - 1]);
        }
    });

    let canvas = null;
    if (activeView === 'overview') {
        canvas = <OverviewDashboard isActive />;
    } else if (activeView === 'containers') {
        canvas = <ContainerStatusBoard isActive />;
    } else if (activeView === 'settings') {
        canvas = <SettingsPanel isActive />;
    }

    const activeViewLabel = NAVIGATION_ITEMS.find(item => item.id === activeView)?.label ?? activeView;

    return (
        <TickerContext.Provider value={ticker}>
            <LayoutContext.Provider value={layout}>
                <DeploymentContext.Provider value={contextValue}>
                    <Box flexDirection="column" paddingX={layout.isTiny ? 0 : 1}>
                        <TopNavBar
                            mission={mission}
                            activeViewId={activeView}
                            activeViewLabel={activeViewLabel}
                            navigationItems={NAVIGATION_ITEMS}
                        />
                        <BuildOperationsView isActive={activeView === 'builds'} ref={buildRef} />
                        <Box flexDirection="column" flexGrow={1}>
                            <Box flexDirection="column" flexGrow={1}>
                                {canvas}
                            </Box>
                            <CommandPalette visible={paletteOpen} />
                        </Box>
                        <StatusBar />
                    </Box>
                </DeploymentContext.Provider>
            </LayoutContext.Provider>
        </TickerContext.Provider>
    );
};

render(<DeploymentLayout />);
