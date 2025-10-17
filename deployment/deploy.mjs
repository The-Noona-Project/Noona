// deploy.mjs - Noona Docker Manager (Node.js version)
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import { chmod, readFile, writeFile } from 'fs/promises';
import util from 'util';
import {
    defaultDockerSocketDetector,
    isWindowsPipePath,
    normalizeDockerSocket,
} from '../utilities/etc/dockerSockets.mjs';
import {
    buildImage,
    pushImage,
    pullImage,
    startService,
    streamLogs,
    waitForHealth,
    stopContainer,
    removeResources,
    inspectNetwork,
    createNetwork,
    listContainers
} from './dockerHost.mjs';
import { BuildQueue } from './buildQueue.mjs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DOCKERHUB_USER = 'captainpax';
export const SERVICES = ['moon', 'warden', 'raven', 'sage', 'vault', 'portal'];
const NETWORK_NAME = 'noona-network';
const DEFAULT_WORKER_THREADS = 4;
const DEFAULT_SUBPROCESSES_PER_WORKER = 2;
const DEFAULT_DEBUG_LEVEL = 'false';
const DEFAULT_BOOT_MODE = 'minimal';
const BUILD_CONFIG_PATH = resolve(__dirname, 'build.config.json');
let cachedDeploymentConfig = null;
const HISTORY_FILE = resolve(__dirname, 'lifecycleHistory.json');
const MAX_HISTORY_ENTRIES = 50;
const DOCKER_SOCKET_TARGET = '/var/run/docker.sock';

let cachedHostDockerSocket = null;

const collectDetectedSockets = detectionResult => {
    const rawCandidates = Array.isArray(detectionResult)
        ? detectionResult
        : (typeof detectionResult === 'undefined' ? [] : [detectionResult]);

    return rawCandidates
        .map(candidate => normalizeDockerSocket(candidate))
        .filter(candidate => typeof candidate === 'string' && candidate.trim().length > 0);
};

export const resolveDockerSocketBinding = ({
    detectSockets = defaultDockerSocketDetector,
    platform = process.platform,
} = {}) => {
    let detectedSockets = [];

    if (typeof detectSockets === 'function') {
        try {
            detectedSockets = detectSockets({ env: process.env, process: { platform } }) ?? [];
        } catch (error) {
            detectedSockets = [];
        }
    }

    const candidates = collectDetectedSockets(detectedSockets);
    const isWindows = platform === 'win32';

    const preferred = candidates.find(candidate =>
        isWindows ? isWindowsPipePath(candidate) : !isWindowsPipePath(candidate)
    );

    if (preferred) {
        return preferred;
    }

    if (!isWindows) {
        const unixCandidate = candidates.find(candidate => candidate.startsWith('/'));
        if (unixCandidate) {
            return unixCandidate;
        }
    }

    return isWindows ? '//./pipe/docker_engine' : DOCKER_SOCKET_TARGET;
};

const getDefaultDockerSocketBinding = () => {
    if (!cachedHostDockerSocket) {
        cachedHostDockerSocket = resolveDockerSocketBinding();
    }
    return cachedHostDockerSocket;
};

const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

const formatConsoleArgs = args => {
    if (args.length === 0) return '';
    if (args.length === 1) {
        const [first] = args;
        return typeof first === 'string' ? first : util.inspect(first, { depth: 5, colors: false });
    }
    return util.format(...args);
};

let activeReporter = null;

const withReporter = async (reporter, fn) => {
    if (!reporter) {
        return fn();
    }

    const previousReporter = activeReporter;
    activeReporter = reporter;

    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        table: console.table
    };

    console.log = (...args) => {
        const message = formatConsoleArgs(args);
        if (typeof reporter.info === 'function') {
            reporter.info(message);
        } else {
            original.log(...args);
        }
    };
    console.warn = (...args) => {
        const message = formatConsoleArgs(args);
        if (typeof reporter.warn === 'function') {
            reporter.warn(message);
        } else {
            original.warn(...args);
        }
    };
    console.error = (...args) => {
        const message = formatConsoleArgs(args);
        if (typeof reporter.error === 'function') {
            reporter.error(message);
        } else {
            original.error(...args);
        }
    };
    console.table = (data, columns) => {
        if (typeof reporter.table === 'function') {
            reporter.table(data, columns);
        } else {
            original.table(data, columns);
        }
    };

    try {
        return await fn();
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
        console.table = original.table;
        activeReporter = previousReporter;
    }
};

const emitThroughReporter = (kind, fallback, message) => {
    if (activeReporter && typeof activeReporter[kind] === 'function') {
        activeReporter[kind](message);
        return;
    }
    fallback(message);
};

export const readLifecycleHistory = async () => {
    try {
        const raw = await readFile(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`${colors.yellow}⚠️  Failed to read lifecycle history: ${error.message}${colors.reset}`);
        }
        return [];
    }
};

const recordLifecycleEvent = async event => {
    try {
        const history = await readLifecycleHistory();
        history.push({ ...event, timestamp: new Date().toISOString() });
        const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
        await writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
    } catch (error) {
        console.warn(`${colors.yellow}⚠️  Unable to persist lifecycle history: ${error.message}${colors.reset}`);
    }
};

const formatPorts = ports => {
    if (!ports) return '—';
    if (Array.isArray(ports)) {
        const entries = ports.map(port => {
            const privatePort = port.PrivatePort ? `${port.PrivatePort}/${port.Type || 'tcp'}` : port.Type || '';
            if (port.PublicPort) {
                const host = port.IP && port.IP !== '0.0.0.0' ? port.IP : 'localhost';
                return `${host}:${port.PublicPort} → ${privatePort}`;
            }
            return privatePort || `${port.Type || 'tcp'}`;
        }).filter(Boolean);
        return entries.length ? entries.join(', ') : '—';
    }

    const entries = Object.entries(ports)
        .flatMap(([internal, bindings]) => {
            if (!bindings || !bindings.length) {
                return internal;
            }
            return bindings.map(binding => {
                const host = binding.HostIp && binding.HostIp !== '0.0.0.0' ? binding.HostIp : 'localhost';
                return `${host}:${binding.HostPort} → ${internal}`;
            });
        })
        .filter(Boolean);
    return entries.length ? entries.join(', ') : '—';
};

const buildContainerRow = (inspection, { result, note } = {}) => {
    const networks = Object.keys(inspection?.NetworkSettings?.Networks || {});
    return {
        Name: inspection?.Name?.replace(/^\//, '') || inspection?.Config?.Hostname || 'unknown',
        State: result || inspection?.State?.Status || 'unknown',
        Health: inspection?.State?.Health?.Status || 'n/a',
        Networks: networks.length ? networks.join(', ') : '—',
        Ports: formatPorts(inspection?.NetworkSettings?.Ports),
        Note: note || ''
    };
};

const printContainerTable = (rows, { title } = {}) => {
    if (!rows || rows.length === 0) {
        return;
    }
    if (title) {
        console.log(`${colors.cyan}${title}${colors.reset}`);
    }
    console.table(rows);
};

const presentRemovalSummary = (summary = {}, { title } = {}) => {
    const rows = [];
    (summary.containers || []).forEach(name => rows.push({ Type: 'container', Target: name.replace(/^\//, ''), Result: 'removed' }));
    (summary.images || []).forEach(name => rows.push({ Type: 'image', Target: name, Result: 'removed' }));
    (summary.volumes || []).forEach(name => rows.push({ Type: 'volume', Target: name, Result: 'removed' }));
    (summary.networks || []).forEach(name => rows.push({ Type: 'network', Target: name, Result: 'removed' }));

    if (!rows.length) {
        rows.push({ Type: 'info', Target: 'No matching resources', Result: '—' });
    }

    if (title) {
        console.log(`${colors.cyan}${title}${colors.reset}`);
    }
    console.table(rows);
};

const printRemediation = remediation => {
    if (!remediation) return;
    console.log(`${colors.yellow}💡 ${remediation}${colors.reset}`);
};

const parsePositiveInteger = (value, fallback, { flag } = {}) => {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }
    if (flag) {
        console.warn(`${colors.yellow}⚠️  Ignoring invalid ${flag} value (${value}); using ${fallback}.${colors.reset}`);
    }
    return fallback;
};

const defaultDeploymentConfig = () => ({
    buildScheduler: {
        workerThreads: DEFAULT_WORKER_THREADS,
        subprocessesPerWorker: DEFAULT_SUBPROCESSES_PER_WORKER
    },
    defaults: {
        debugLevel: DEFAULT_DEBUG_LEVEL,
        bootMode: DEFAULT_BOOT_MODE
    }
});

const loadDeploymentConfig = async () => {
    if (cachedDeploymentConfig) {
        return cachedDeploymentConfig;
    }

    let config = defaultDeploymentConfig();

    try {
        const raw = await readFile(BUILD_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            const scheduler = parsed.buildScheduler || parsed.build || parsed;
            if (scheduler && typeof scheduler === 'object') {
                config.buildScheduler = {
                    workerThreads: parsePositiveInteger(
                        scheduler.workerThreads ?? scheduler.workers,
                        config.buildScheduler.workerThreads
                    ),
                    subprocessesPerWorker: parsePositiveInteger(
                        scheduler.subprocessesPerWorker ?? scheduler.subprocesses,
                        config.buildScheduler.subprocessesPerWorker
                    )
                };
            }

            if (parsed.defaults && typeof parsed.defaults === 'object') {
                config.defaults = {
                    debugLevel: typeof parsed.defaults.debugLevel === 'string'
                        ? parsed.defaults.debugLevel
                        : config.defaults.debugLevel,
                    bootMode: typeof parsed.defaults.bootMode === 'string'
                        ? parsed.defaults.bootMode
                        : config.defaults.bootMode
                };
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`${colors.yellow}⚠️  Failed to read ${BUILD_CONFIG_PATH}: ${error.message}${colors.reset}`);
        }
    }

    cachedDeploymentConfig = config;
    return config;
};

const saveDeploymentConfig = async updater => {
    const current = await loadDeploymentConfig();
    const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
    const normalized = {
        buildScheduler: {
            workerThreads: parsePositiveInteger(
                next.buildScheduler?.workerThreads,
                DEFAULT_WORKER_THREADS
            ),
            subprocessesPerWorker: parsePositiveInteger(
                next.buildScheduler?.subprocessesPerWorker,
                DEFAULT_SUBPROCESSES_PER_WORKER
            )
        },
        defaults: {
            debugLevel: typeof next.defaults?.debugLevel === 'string'
                ? next.defaults.debugLevel
                : DEFAULT_DEBUG_LEVEL,
            bootMode: typeof next.defaults?.bootMode === 'string'
                ? next.defaults.bootMode
                : DEFAULT_BOOT_MODE
        }
    };

    cachedDeploymentConfig = normalized;
    await writeFile(BUILD_CONFIG_PATH, JSON.stringify(normalized, null, 2));
    return normalized;
};

export const getDeploymentSettings = async () => loadDeploymentConfig();

export const updateBuildConcurrencyDefaults = async ({ workerThreads, subprocessesPerWorker }) => {
    return saveDeploymentConfig(config => ({
        ...config,
        buildScheduler: {
            workerThreads: workerThreads ?? config.buildScheduler.workerThreads,
            subprocessesPerWorker: subprocessesPerWorker ?? config.buildScheduler.subprocessesPerWorker
        }
    }));
};

export const updateDebugDefaults = async ({ debugLevel, bootMode }) => {
    return saveDeploymentConfig(config => ({
        ...config,
        defaults: {
            debugLevel: debugLevel ?? config.defaults.debugLevel,
            bootMode: bootMode ?? config.defaults.bootMode
        }
    }));
};

const gatherBuildRecords = (records = []) => {
    return records
        .map(record => {
            if (!record) return '';
            if (typeof record === 'string') {
                return record.trim();
            }
            if (typeof record === 'object') {
                const value = record.stream || record.status || record.error;
                return typeof value === 'string' ? value.trim() : '';
            }
            return String(record).trim();
        })
        .filter(line => line);
};

const createSchedulerLogger = () => ({
    info: message => console.log(`${colors.cyan}${message}${colors.reset}`),
    warn: message => console.warn(`${colors.yellow}${message}${colors.reset}`),
    error: message => console.error(`${colors.red}${message}${colors.reset}`)
});

const resolveBuildConcurrency = async (overrides = {}) => {
    const config = await loadDeploymentConfig();
    const workerThreads = parsePositiveInteger(
        overrides.workerThreads,
        config.buildScheduler.workerThreads
    );
    const subprocessesPerWorker = parsePositiveInteger(
        overrides.subprocessesPerWorker,
        config.buildScheduler.subprocessesPerWorker
    );

    return { workerThreads, subprocessesPerWorker };
};

const executeBuilds = async (services, { useNoCache = false, concurrency = {}, reporter, onProgress } = {}) => {
    return withReporter(reporter, async () => {
        if (!services || services.length === 0) {
            print.error('No services selected for build.');
            return;
        }

        const { workerThreads, subprocessesPerWorker } = await resolveBuildConcurrency(concurrency);
        const maxCapacity = workerThreads * subprocessesPerWorker;
        console.log(`${colors.cyan}🧵 Build worker pool: ${workerThreads} thread(s), up to ${maxCapacity} concurrent jobs (subprocess limit ${subprocessesPerWorker}).${colors.reset}`);

        const scheduler = new BuildQueue({
            workerThreads,
            subprocessesPerWorker,
            logger: createSchedulerLogger()
        });

        const progressEmitter = typeof onProgress === 'function'
            ? update => onProgress({ view: 'builds', ...update })
            : null;

        const detachListeners = () => {
            if (!progressEmitter) return;
            scheduler.off('log', logListener);
            scheduler.off('enqueued', enqueueListener);
            scheduler.off('capacityChange', capacityListener);
            scheduler.off('idle', idleListener);
        };

        const logListener = payload => progressEmitter?.({ type: 'log', service: payload.id, level: payload.level, message: payload.message });
        const enqueueListener = payload => progressEmitter?.({ type: 'enqueue', service: payload.id, queueSize: payload.size });
        const capacityListener = payload => progressEmitter?.({ type: 'capacity', limit: payload.limit });
        const idleListener = () => progressEmitter?.({ type: 'idle' });

        if (progressEmitter) {
            scheduler.on('log', logListener);
            scheduler.on('enqueued', enqueueListener);
            scheduler.on('capacityChange', capacityListener);
            scheduler.on('idle', idleListener);
        }

        scheduler.useBaseCapacity();

        const ravenSelected = services.includes('raven');
        const standardServices = services.filter(service => service !== 'raven');

        const scheduleServiceBuild = service => scheduler.enqueue({
            name: service,
            run: async report => {
                const forward = entry => {
                    if (!entry) return;
                    const normalized = typeof entry === 'string' ? { message: entry } : entry;
                    if (progressEmitter) {
                        progressEmitter({ type: 'update', service, ...normalized });
                    }
                    report(entry);
                };

                forward({ message: 'Preparing build context' });
                await ensureExecutables(service);

                const image = `${DOCKERHUB_USER}/noona-${service}`;
                const dockerfile = `${ROOT_DIR}/deployment/${service}.Dockerfile`;

                const result = await buildImage({
                    context: ROOT_DIR,
                    dockerfile,
                    tag: `${image}:latest`,
                    noCache: useNoCache
                });

                if (!result.ok) {
                    const error = new Error(result.error?.message || `Build failed: ${image}`);
                    error.details = result.error;
                    error.records = gatherBuildRecords(result.data?.records || result.error?.records || []);
                    if (progressEmitter) {
                        progressEmitter({ type: 'error', service, message: error.message, details: error.details });
                    }
                    throw error;
                }

                const records = gatherBuildRecords(result.data?.records || []);
                const stepLines = records.filter(line => /^Step\s+\d+/i.test(line)).slice(-3);
                if (stepLines.length) {
                    stepLines.forEach(line => forward({ message: line }));
                } else if (records.length) {
                    forward({ message: `${service} emitted ${records.length} build log entries.` });
                }

                (result.warnings || []).forEach(warning => {
                    forward({ level: 'warn', message: warning.trim() });
                });

                return { service, image, records, warnings: result.warnings || [] };
            }
        });

        try {
            const jobPromises = standardServices.map(service => scheduleServiceBuild(service).catch(() => {}));
            await Promise.allSettled(jobPromises);
            await scheduler.drain();

            if (ravenSelected) {
                if (standardServices.length) {
                    console.log(`${colors.cyan}🦅 Raven build deferred until other services complete. Expanding pool to ${scheduler.useMaxCapacity()} slots.${colors.reset}`);
                } else {
                    console.log(`${colors.cyan}🦅 Raven build scheduled with expanded pool size ${scheduler.useMaxCapacity()}.${colors.reset}`);
                }
                const ravenPromise = scheduleServiceBuild('raven').catch(() => {});
                await Promise.allSettled([ravenPromise]);
                await scheduler.drain();
            }

            const summary = scheduler.getResults();
            if (summary.length === 0) {
                print.error('No builds were executed.');
                return;
            }

            console.log(`${colors.bold}${colors.cyan}Build Summary${colors.reset}`);

            const failures = [];
            for (const entry of summary) {
                const durationSeconds = (entry.duration / 1000).toFixed(2);
                if (entry.status === 'fulfilled') {
                    print.success(`${entry.id} built in ${durationSeconds}s.`);
                    const warnings = entry.value?.warnings || [];
                    warnings.forEach(warning => console.warn(`${colors.yellow}⚠️  ${entry.id}: ${warning}${colors.reset}`));
                    progressEmitter?.({ type: 'complete', service: entry.id, status: 'fulfilled', duration: entry.duration, result: entry.value });
                } else {
                    failures.push(entry);
                    print.error(`${entry.id} build failed after ${durationSeconds}s.`);
                    if (entry.error?.message) {
                        console.error(`${colors.red}   ↳ ${entry.error.message}${colors.reset}`);
                    }
                    const tail = entry.logs.slice(-10);
                    if (tail.length) {
                        console.error(`${colors.red}--- ${entry.id} log tail ---${colors.reset}`);
                        tail.forEach(line => console.error(line));
                        console.error(`${colors.red}--- end ${entry.id} ---${colors.reset}`);
                    }
                    progressEmitter?.({ type: 'complete', service: entry.id, status: 'rejected', duration: entry.duration, error: entry.error, logs: entry.logs });
                }
            }

            if (failures.length === 0) {
                print.success('All builds completed successfully.');
            } else {
                console.error(`${colors.red}${failures.length} build(s) failed. Review logs above for details.${colors.reset}`);
            }

            return summary;
        } finally {
            detachListeners();
        }
    });
};

const print = {
    success: msg => emitThroughReporter('success',
        message => console.log(`${colors.green}✅ ${message}${colors.reset}`),
        msg
    ),
    error: msg => emitThroughReporter('error',
        message => console.error(`${colors.red}❌ ${message}${colors.reset}`),
        msg
    )
};

const reportDockerResult = (result, { successMessage, failureMessage }) => {
    if (result.ok) {
        if (successMessage) {
            print.success(successMessage);
        }
        (result.warnings || []).forEach(warning => {
            console.warn(`${colors.yellow}⚠️  ${warning.trim()}${colors.reset}`);
        });
        return true;
    }

    const details = result.error?.message || failureMessage || 'Docker operation failed';
    if (failureMessage) {
        print.error(`${failureMessage}: ${details}`);
    } else {
        print.error(details);
    }

    if (result.error?.details) {
        console.error(result.error.details);
    }
    return false;
};

const ensureExecutables = async service => {
    if (service !== 'raven') return;

    const gradlewPath = resolve(ROOT_DIR, 'services', service, 'gradlew');

    try {
        await chmod(gradlewPath, 0o755);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`${colors.yellow}⚠️  Unable to update permissions for ${gradlewPath}: ${error.message}${colors.reset}`);
        }
    }
};

export const createContainerOptions = (service, image, envVars = {}, {
    detectDockerSockets,
    platform,
} = {}) => {
    const entries = Object.entries(envVars)
        .filter(([, value]) => typeof value === 'string' && value.trim() !== '');

    const normalizedEnv = Object.fromEntries(entries);
    if (!normalizedEnv.SERVICE_NAME) {
        normalizedEnv.SERVICE_NAME = `noona-${service}`;
    }

    const containerName = normalizedEnv.SERVICE_NAME;
    const hostDockerSocket =
        typeof detectDockerSockets === 'function' || typeof platform === 'string'
            ? resolveDockerSocketBinding({ detectSockets: detectDockerSockets, platform })
            : getDefaultDockerSocketBinding();
    const hostConfig = {
        Binds: [`${hostDockerSocket}:${DOCKER_SOCKET_TARGET}`]
    };
    const exposedPorts = {};

    if (service === 'warden') {
        const apiPort = normalizedEnv.WARDEN_API_PORT?.trim() || '4001';
        const portKey = `${apiPort}/tcp`;
        hostConfig.PortBindings = { [portKey]: [{ HostPort: apiPort }] };
        exposedPorts[portKey] = {};
    }

    return {
        name: containerName,
        image: `${image}:latest`,
        env: normalizedEnv,
        network: NETWORK_NAME,
        hostConfig,
        exposedPorts
    };
};

const ensureNetwork = async () => {
    const inspection = await inspectNetwork(NETWORK_NAME);
    if (inspection.ok) {
        console.log(`${colors.cyan}🔗 Using existing Docker network ${NETWORK_NAME}.${colors.reset}`);
        return;
    }

    if (inspection.error?.context?.notFound) {
        console.log(`${colors.yellow}🌐 Creating Docker network ${NETWORK_NAME}...${colors.reset}`);
        const creation = await createNetwork({ name: NETWORK_NAME });
        if (creation.ok) {
            print.success(`Created Docker network ${NETWORK_NAME}`);
        } else {
            throw new Error(creation.error?.message || 'Unable to create network');
        }
        return;
    }

    throw new Error(inspection.error?.message || 'Unable to inspect network');
};

export const stopAllContainers = async ({ reporter } = {}) => {
    return withReporter(reporter, async () => {
        console.log(`${colors.yellow}⏹ Stopping all running Noona containers...${colors.reset}`);
        const results = await listContainers({ filters: { name: ['noona-'] } });
        if (!results.ok) {
            throw new Error(results.error?.message || 'Failed to list containers');
        }

        const containers = results.data || [];
        if (containers.length === 0) {
            print.success('No running Noona containers found.');
            const rows = [{ Name: '—', State: 'none', Ports: '—', Result: 'No running containers' }];
            console.table(rows);
            return { ok: true, rows };
        }

        const rows = [];
        for (const info of containers) {
            const name = info.Names?.[0]?.replace(/^\//, '') || info.Id;
            const outcome = await stopContainer({ name });
            const result = outcome.ok
                ? (outcome.data?.skipped ? 'already stopped' : 'stopped')
                : `error: ${outcome.error?.message || 'unknown error'}`;
            if (!outcome.ok) {
                print.error(`Failed to stop ${name}: ${outcome.error?.message}`);
            }
            rows.push({
                Name: name,
                State: info.State || info.Status || 'unknown',
                Ports: formatPorts(info.Ports),
                Result: result
            });
        }

        console.table(rows);
        if (rows.every(row => !row.Result.startsWith('error'))) {
            print.success('Stop command sent to all running Noona containers.');
        }
        return { ok: rows.every(row => !row.Result.startsWith('error')), rows };
    });
};

const cleanService = async service => {
    const image = `${DOCKERHUB_USER}/noona-${service}`;
    const local = `noona-${service}`;
    const removalRequest = {
        containers: { names: [local] },
        images: {
            references: [
                `${image}:latest`,
                image,
                `${local}:latest`,
                local
            ]
        }
    };

    if (service === 'warden') {
        removalRequest.networks = { names: [NETWORK_NAME] };
    }

    const removal = await removeResources(removalRequest);

    if (!removal.ok) {
        throw new Error('Some resources could not be removed.');
    }

    return removal.data;
};

const normalizeServices = services => {
    if (!services) return [];
if (services === 'all') return [...SERVICES];
    const list = Array.isArray(services) ? services : [services];
    return list
        .map(value => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(value => SERVICES.includes(value));
};

export const cleanServices = async (services, { reporter } = {}) => {
    const targets = normalizeServices(services);
    if (!targets.length) {
        return { ok: false, results: [] };
    }

    return withReporter(reporter, async () => {
        const results = [];
        for (const svc of targets) {
            console.log(`${colors.yellow}🧹 Cleaning ${svc}...${colors.reset}`);
            try {
                const summary = await cleanService(svc);
                presentRemovalSummary(summary, { title: `Removed resources for ${svc}` });
                await recordLifecycleEvent({
                    action: 'clean',
                    service: svc,
                    status: 'success',
                    details: { removed: summary }
                });
                print.success(`Cleaned ${svc}`);
                results.push({ service: svc, ok: true, summary });
            } catch (error) {
                print.error(`Failed to clean ${svc}: ${error.message}`);
                await recordLifecycleEvent({
                    action: 'clean',
                    service: svc,
                    status: 'failed',
                    details: { message: error.message }
                });
                results.push({ service: svc, ok: false, error });
            }
        }

        return { ok: results.every(entry => entry.ok), results };
    });
};

export const deleteDockerResources = async ({ reporter, confirm = false } = {}) => {
    return withReporter(reporter, async () => {
        if (!confirm) {
            print.error('Delete aborted.');
            return { ok: false, cancelled: true };
        }

        console.log(`${colors.yellow}🗑️ Deleting Noona Docker resources...${colors.reset}`);

        const removal = await removeResources({
            containers: { filters: { name: ['noona-'] } },
            images: { match: tag => tag.startsWith('captainpax/noona-') || tag.startsWith('noona-') },
            volumes: { filters: { name: ['noona-'] } },
            networks: { filters: { name: ['noona-'] } }
        });

        if (!removal.ok) {
            print.error('Some Docker resources could not be deleted.');
            return { ok: false, error: removal.error };
        }

        print.success('All local Noona Docker resources deleted.');
        return { ok: true, summary: removal.data };
    });
};

export const buildServices = async (services, options = {}) => {
    const targets = normalizeServices(services);
    if (!targets.length) {
        print.error('No services selected for build.');
        return { ok: false, summary: [] };
    }

    const summary = await executeBuilds(targets, options);
    const normalized = Array.isArray(summary) ? summary : [];
    const ok = normalized.length > 0 && normalized.every(entry => entry.status === 'fulfilled');
    return { ok, summary: normalized };
};

const runRegistryOperation = async ({
    services,
    operation,
    verb,
    reporter,
    onProgress
}) => {
    const targets = normalizeServices(services);
    if (!targets.length) {
        print.error(`No services selected for ${verb}.`);
        return { ok: false, results: [] };
    }

    return withReporter(reporter, async () => {
        const results = [];
        for (const svc of targets) {
            const image = `${DOCKERHUB_USER}/noona-${svc}`;
            console.log(`${colors.yellow}${verb} ${svc}...${colors.reset}`);
            onProgress?.({ type: 'start', service: svc });
            try {
                const outcome = await operation({ reference: `${image}:latest` });
                const ok = reportDockerResult(outcome, {
                    successMessage: `${verb} complete: ${image}`,
                    failureMessage: `${verb} failed: ${image}`
                });
                onProgress?.({ type: 'complete', service: svc, ok, result: outcome });
                results.push({ service: svc, ok, result: outcome });
            } catch (error) {
                print.error(`${verb} failed: ${image}: ${error.message}`);
                onProgress?.({ type: 'complete', service: svc, ok: false, error });
                results.push({ service: svc, ok: false, error });
            }
        }

        return { ok: results.every(entry => entry.ok), results };
    });
};

export const pushServices = async (services, { reporter, onProgress } = {}) => {
    return runRegistryOperation({
        services,
        operation: pushImage,
        verb: '📤 Pushing',
        reporter,
        onProgress
    });
};

export const pullServices = async (services, { reporter, onProgress } = {}) => {
    return runRegistryOperation({
        services,
        operation: pullImage,
        verb: '📥 Pulling',
        reporter,
        onProgress
    });
};

const resolveDebugDefaults = async ({ debugLevel, bootMode } = {}) => {
    const config = await loadDeploymentConfig();
    const resolvedBoot = (bootMode || config.defaults.bootMode || DEFAULT_BOOT_MODE).toLowerCase();
    const resolvedDebug = (debugLevel || config.defaults.debugLevel || DEFAULT_DEBUG_LEVEL).toLowerCase();
    const effectiveDebug = resolvedBoot === 'super' ? 'super' : resolvedDebug;
    return { bootMode: resolvedBoot, debugLevel: effectiveDebug, requestedDebug: resolvedDebug };
};

export const startServices = async (services, {
    reporter,
    debugLevel,
    bootMode,
    onProgress,
    onLog
} = {}) => {
    const targets = normalizeServices(services);
    if (!targets.length) {
        print.error('No services selected for start.');
        return { ok: false, results: [] };
    }

    return withReporter(reporter, async () => {
        const results = [];
        for (const svc of targets) {
            if (svc !== 'warden') {
                print.error(`Start is currently supported for the warden orchestrator. Skipping ${svc}.`);
                results.push({ service: svc, ok: false, error: new Error('unsupported-service') });
                continue;
            }

            console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
            const logBuffer = [];
            let logStream;
            const settings = await resolveDebugDefaults({ debugLevel, bootMode });

            try {
                await ensureNetwork();
                if (settings.bootMode === 'super' && settings.requestedDebug !== 'super') {
                    console.log(`${colors.cyan}ℹ️  Forcing DEBUG="super" to match selected boot mode.${colors.reset}`);
                }

                const image = `${DOCKERHUB_USER}/noona-${svc}`;
                const options = createContainerOptions(svc, image, {
                    DEBUG: settings.debugLevel,
                    BOOT_MODE: settings.bootMode
                });

                const cleanup = await removeResources({ containers: { names: [options.name] } });
                if (!cleanup.ok) {
                    throw new Error('Unable to remove existing container');
                }

                onProgress?.({ type: 'start', service: svc, step: 'launch', settings });

                const startResult = await startService(options);
                if (!startResult.ok) {
                    print.error(`Failed to start ${svc}: ${startResult.error?.message}`);
                    await recordLifecycleEvent({
                        action: 'start',
                        service: svc,
                        status: 'failed',
                        details: {
                            step: 'start-service',
                            error: startResult.error
                        }
                    });
                    results.push({ service: svc, ok: false, error: startResult.error });
                    continue;
                }

                const inspection = startResult.data.inspection;
                const logResult = await streamLogs({
                    name: options.name,
                    follow: true,
                    tail: 50,
                    onData: rawLine => {
                        const line = rawLine.trim();
                        if (!line) return;
                        logBuffer.push(line);
                        if (logBuffer.length > 50) {
                            logBuffer.shift();
                        }
                        onLog?.({ service: svc, line });
                    }
                });

                if (!logResult.ok) {
                    console.warn(`${colors.yellow}⚠️  Unable to stream logs for ${options.name}: ${logResult.error?.message}${colors.reset}`);
                } else {
                    logStream = logResult.data.stream;
                }

                const apiPort = (options.env?.WARDEN_API_PORT || '4001').trim();
                const healthUrl = `http://localhost:${apiPort}/health`;
                const healthResult = await waitForHealth({
                    name: options.name,
                    url: healthUrl,
                    interval: settings.bootMode === 'super' ? 1000 : 2000,
                    timeout: 120000
                });

                if (!healthResult.ok) {
                    print.error(`Failed to start ${svc}: ${healthResult.error?.message}`);
                    printRemediation(healthResult.error?.context?.remediation);
                    await recordLifecycleEvent({
                        action: 'start',
                        service: svc,
                        status: 'failed',
                        details: {
                            step: 'health-check',
                            health: healthResult.error,
                            logs: logBuffer.slice(-20)
                        }
                    });
                    results.push({ service: svc, ok: false, error: healthResult.error });
                    continue;
                }

                if (logStream?.destroy) {
                    logStream.destroy();
                    logStream = null;
                }

                const row = buildContainerRow(inspection, {
                    result: inspection?.State?.Status,
                    note: `Health ${healthResult.data.status} after ${healthResult.data.attempts} attempt(s)`
                });
                printContainerTable([row], { title: 'Container status' });
                print.success(`${svc} started and reported healthy (HTTP ${healthResult.data.status}).`);

                await recordLifecycleEvent({
                    action: 'start',
                    service: svc,
                    status: 'success',
                    details: {
                        container: row,
                        health: { ...healthResult.data, url: healthUrl },
                        settings
                    }
                });

                onProgress?.({ type: 'complete', service: svc, ok: true, inspection: row, health: healthResult.data, settings });
                results.push({ service: svc, ok: true, inspection: row, health: healthResult.data });
            } catch (error) {
                print.error(`Failed to start ${svc}: ${error.message}`);
                await recordLifecycleEvent({
                    action: 'start',
                    service: svc,
                    status: 'failed',
                    details: {
                        message: error.message,
                        stack: error.stack,
                        settings
                    }
                });
                onProgress?.({ type: 'complete', service: svc, ok: false, error, settings });
                results.push({ service: svc, ok: false, error });
            } finally {
                if (logStream?.destroy) {
                    logStream.destroy();
                }
            }
        }

        return { ok: results.every(entry => entry.ok), results };
    });
};

export const listManagedContainers = async ({ includeStopped = true } = {}) => {
    const filters = { name: ['noona-'] };
    const result = await listContainers({ filters, all: includeStopped });
    if (!result.ok) {
        throw new Error(result.error?.message || 'Unable to list containers');
    }

    return (result.data || []).map(info => ({
        id: info.Id,
        name: info.Names?.[0]?.replace(/^\//, '') || info.Id,
        image: info.Image,
        state: info.State || info.Status || 'unknown',
        status: info.Status || info.State || 'unknown',
        ports: formatPorts(info.Ports),
        createdAt: info.Created ? new Date(info.Created * 1000).toISOString() : null
    }));
};

if (process.argv[1]) {
    const entryUrl = pathToFileURL(process.argv[1]).href;
    if (import.meta.url === entryUrl) {
        // Launch the Ink-based CLI when this module is executed directly.
        // eslint-disable-next-line promise/catch-or-return
        import('./cli.mjs');
    }
}


