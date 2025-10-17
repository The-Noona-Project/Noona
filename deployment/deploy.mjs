// deploy.mjs - Noona Docker Manager (Node.js version)
import readline from 'readline/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { chmod, readFile, writeFile } from 'fs/promises';
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
const SERVICES = ['moon', 'warden', 'raven', 'sage', 'vault', 'portal'];
const NETWORK_NAME = 'noona-network';
const DEFAULT_WORKER_THREADS = 4;
const DEFAULT_SUBPROCESSES_PER_WORKER = 2;
const BUILD_CONFIG_PATH = resolve(__dirname, 'build.config.json');
let cachedBuildSchedulerConfig = null;
const HISTORY_FILE = resolve(__dirname, 'lifecycleHistory.json');
const MAX_HISTORY_ENTRIES = 50;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

const readLifecycleHistory = async () => {
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

const loadBuildSchedulerConfig = async () => {
    if (cachedBuildSchedulerConfig) {
        return cachedBuildSchedulerConfig;
    }

    try {
        const raw = await readFile(BUILD_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            if (parsed.buildScheduler && typeof parsed.buildScheduler === 'object') {
                cachedBuildSchedulerConfig = parsed.buildScheduler;
            } else if (parsed.build && typeof parsed.build === 'object') {
                cachedBuildSchedulerConfig = parsed.build;
            } else {
                cachedBuildSchedulerConfig = parsed;
            }
        } else {
            cachedBuildSchedulerConfig = {};
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`${colors.yellow}⚠️  Failed to read ${BUILD_CONFIG_PATH}: ${error.message}${colors.reset}`);
        }
        cachedBuildSchedulerConfig = {};
    }

    return cachedBuildSchedulerConfig;
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

const resolveBuildConcurrency = async () => {
    const fileConfig = await loadBuildSchedulerConfig();
    const fileWorkers = parsePositiveInteger(
        fileConfig?.workerThreads ?? fileConfig?.workers,
        DEFAULT_WORKER_THREADS
    );
    const fileSubprocesses = parsePositiveInteger(
        fileConfig?.subprocessesPerWorker ?? fileConfig?.subprocesses,
        DEFAULT_SUBPROCESSES_PER_WORKER
    );

    const workers = parsePositiveInteger(
        CLI_ARG_VALUES.get('--build-workers'),
        fileWorkers,
        { flag: '--build-workers' }
    );
    const subprocessesPerWorker = parsePositiveInteger(
        CLI_ARG_VALUES.get('--build-subprocesses'),
        fileSubprocesses,
        { flag: '--build-subprocesses' }
    );

    return { workerThreads: workers, subprocessesPerWorker };
};

const executeBuilds = async (services, { useNoCache }) => {
    if (!services || services.length === 0) {
        print.error('No services selected for build.');
        return;
    }

    const { workerThreads, subprocessesPerWorker } = await resolveBuildConcurrency();
    const maxCapacity = workerThreads * subprocessesPerWorker;
    console.log(`${colors.cyan}🧵 Build worker pool: ${workerThreads} thread(s), up to ${maxCapacity} concurrent jobs (subprocess limit ${subprocessesPerWorker}).${colors.reset}`);

    const scheduler = new BuildQueue({
        workerThreads,
        subprocessesPerWorker,
        logger: createSchedulerLogger()
    });

    scheduler.useBaseCapacity();

    const ravenSelected = services.includes('raven');
    const standardServices = services.filter(service => service !== 'raven');

    const scheduleServiceBuild = service => scheduler.enqueue({
        name: service,
        run: async report => {
            report({ message: 'Preparing build context' });
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
                throw error;
            }

            const records = gatherBuildRecords(result.data?.records || []);
            const stepLines = records.filter(line => /^Step\s+\d+/i.test(line)).slice(-3);
            if (stepLines.length) {
                stepLines.forEach(line => report({ message: line }));
            } else if (records.length) {
                report({ message: `${service} emitted ${records.length} build log entries.` });
            }

            (result.warnings || []).forEach(warning => {
                report({ level: 'warn', message: warning.trim() });
            });

            return { service, image, records, warnings: result.warnings || [] };
        }
    });

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
        }
    }

    if (failures.length === 0) {
        print.success('All builds completed successfully.');
    } else {
        console.error(`${colors.red}${failures.length} build(s) failed. Review logs above for details.${colors.reset}`);
    }
};

const RAW_CLI_ARGS = process.argv.slice(2);
const CLI_ARGS = new Set(RAW_CLI_ARGS);
const CLI_ARG_VALUES = RAW_CLI_ARGS.reduce((map, arg) => {
    if (arg.startsWith('--') && arg.includes('=')) {
        const [key, ...rest] = arg.split('=');
        if (key) {
            map.set(key, rest.join('='));
        }
    }
    return map;
}, new Map());
const FORCE_CLEAN_BUILD = CLI_ARGS.has('--clean-build');
const FORCE_CACHED_BUILD = CLI_ARGS.has('--cached-build');
const CONFLICTING_BUILD_FLAGS = FORCE_CLEAN_BUILD && FORCE_CACHED_BUILD;

const printHeader = () => {
    console.log(`\n${colors.bold}${colors.cyan}`);
    console.log('==============================');
    console.log('   🚀 Noona Docker Manager');
    console.log('==============================');
    console.log(`${colors.reset}`);
};

const printMainMenu = () => {
    console.log(`${colors.yellow}Select an action:${colors.reset}`);
    console.log('1) 🛠️  Build');
    console.log('2) 📤 Push');
    console.log('3) 📥 Pull');
    console.log('4) ▶️  Start');
    console.log('5) ⏹ Stop All');
    console.log('6) 🧹 Clean');
    console.log('7) 🗑️ Delete Docker');
    console.log('0) ❌ Exit\n');
};

const printServicesMenu = () => {
    console.log(`${colors.yellow}Select a service:${colors.reset}`);
    console.log('0) All');
    SERVICES.forEach((svc, i) => console.log(`${i + 1}) ${svc}`));
    console.log('');
};

const print = {
    success: msg => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: msg => console.error(`${colors.red}❌ ${msg}${colors.reset}`)
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

const createContainerOptions = (service, image, envVars = {}) => {
    const entries = Object.entries(envVars)
        .filter(([, value]) => typeof value === 'string' && value.trim() !== '');

    const normalizedEnv = Object.fromEntries(entries);
    if (!normalizedEnv.SERVICE_NAME) {
        normalizedEnv.SERVICE_NAME = `noona-${service}`;
    }

    const containerName = normalizedEnv.SERVICE_NAME;
    const hostConfig = {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock']
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

const stopAllContainers = async () => {
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

const deleteDockerResources = async () => {
    const confirmation = (await rl.question(`${colors.red}This will delete ALL local Noona Docker containers, images, volumes, and networks. Type DELETE to continue: ${colors.reset}`)).trim().toUpperCase();

    if (confirmation !== 'DELETE') {
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
};

const selectServices = async mainChoice => {
    if (mainChoice === '4') {
        console.log(`${colors.cyan}▶️  Start is limited to launching the warden orchestrator.${colors.reset}`);
        return ['warden'];
    }

    printServicesMenu();
    const svcChoice = (await rl.question('Enter service choice: ')).trim();

    if (svcChoice === '0') {
        return [...SERVICES];
    }

    const index = Number.parseInt(svcChoice, 10);
    if (!Number.isInteger(index) || index < 1 || index > SERVICES.length) {
        print.error('Invalid service choice.');
        return null;
    }

    return [SERVICES[index - 1]];
};

const askDebugSetting = async () => {
    const answer = (await rl.question('Select DEBUG level (false/true/super) [false]: ')).trim().toLowerCase();
    const allowed = new Set(['false', 'true', 'super']);
    if (!answer) return 'false';
    if (allowed.has(answer)) return answer;
    print.error('Invalid DEBUG level supplied. Defaulting to "false".');
    return 'false';
};

const askBootMode = async () => {
    const answer = (await rl.question('Select boot mode (minimal/super) [minimal]: ')).trim().toLowerCase();
    const allowed = new Set(['minimal', 'super']);
    if (!answer) return 'minimal';
    if (allowed.has(answer)) return answer;
    print.error('Invalid boot mode supplied. Defaulting to "minimal".');
    return 'minimal';
};

const askCleanBuild = async () => {
    if (CONFLICTING_BUILD_FLAGS) {
        console.warn(`${colors.yellow}⚠️  Conflicting build cache flags detected; defaulting to cached builds.${colors.reset}`);
        return false;
    }

    if (FORCE_CLEAN_BUILD) {
        console.log(`${colors.cyan}🧼 Clean build requested via CLI flag (--clean-build).${colors.reset}`);
        return true;
    }

    if (FORCE_CACHED_BUILD) {
        console.log(`${colors.cyan}📦 Cached build requested via CLI flag (--cached-build).${colors.reset}`);
        return false;
    }

    const answer = (await rl.question('Perform a clean build (use --no-cache)? (y/N): ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
};

const run = async () => {
    while (true) {
        printHeader();
        printMainMenu();
        const mainChoice = (await rl.question('Enter choice: ')).trim();
        if (mainChoice === '0') break;

        if (!['1','2','3','4','5','6','7'].includes(mainChoice)) {
            print.error('Invalid main choice');
            continue;
        }

        if (mainChoice === '5') {
            try {
                const summary = await stopAllContainers();
                await recordLifecycleEvent({
                    action: 'stop-all',
                    status: summary.ok ? 'success' : 'partial',
                    details: { containers: summary.rows }
                });
            } catch (e) {
                print.error(`Failed to stop containers: ${e.message}`);
                await recordLifecycleEvent({
                    action: 'stop-all',
                    status: 'failed',
                    details: { message: e.message }
                });
            }
            continue;
        }

        if (mainChoice === '7') {
            try {
                const result = await deleteDockerResources();
                if (result?.ok) {
                    presentRemovalSummary(result.summary, { title: 'Deleted resources' });
                }
                await recordLifecycleEvent({
                    action: 'delete-all',
                    status: result?.ok ? 'success' : result?.cancelled ? 'cancelled' : 'failed',
                    details: result?.ok
                        ? { removed: result.summary }
                        : { message: result?.cancelled ? 'User cancelled deletion' : result?.error?.message || 'Unknown error' }
                });
            } catch (e) {
                print.error(`Failed to delete Docker resources: ${e.message}`);
                await recordLifecycleEvent({
                    action: 'delete-all',
                    status: 'failed',
                    details: { message: e.message }
                });
            }
            continue;
        }

        const selected = await selectServices(mainChoice);
        if (!selected || selected.length === 0) {
            continue;
        }

        let useNoCache = false;
        if (mainChoice === '1') {
            useNoCache = await askCleanBuild();
        }

        if (mainChoice === '1') {
            try {
                await executeBuilds(selected, { useNoCache });
            } catch (error) {
                print.error(`Build orchestration failed: ${error.message}`);
            }
            continue;
        }

        for (const svc of selected) {
            if (!svc) continue;
            const image = `${DOCKERHUB_USER}/noona-${svc}`;

            switch (mainChoice) {
                case '2': // Push
                    console.log(`${colors.yellow}📤 Pushing ${svc}...${colors.reset}`);
                    try {
                        const result = await pushImage({ reference: `${image}:latest` });
                        reportDockerResult(result, {
                            successMessage: `Push complete: ${image}`,
                            failureMessage: `Push failed: ${image}`
                        });
                    } catch (error) {
                        print.error(`Push failed: ${image}: ${error.message}`);
                    }
                    break;

                case '3': // Pull
                    console.log(`${colors.yellow}📥 Pulling ${svc}...${colors.reset}`);
                    try {
                        const result = await pullImage({ reference: `${image}:latest` });
                        reportDockerResult(result, {
                            successMessage: `Pull complete: ${image}`,
                            failureMessage: `Pull failed: ${image}`
                        });
                    } catch (error) {
                        print.error(`Pull failed: ${image}: ${error.message}`);
                    }
                    break;

                case '4': { // Start
                    console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
                    const logBuffer = [];
                    let logStream;
                    try {
                        await ensureNetwork();
                        const requestedDebug = await askDebugSetting();
                        const BOOT_MODE = await askBootMode();
                        const DEBUG = BOOT_MODE === 'super' ? 'super' : requestedDebug;

                        if (BOOT_MODE === 'super' && requestedDebug !== 'super') {
                            console.log(`${colors.cyan}ℹ️  Forcing DEBUG="super" to match selected boot mode.${colors.reset}`);
                        }

                        const options = createContainerOptions(svc, image, { DEBUG, BOOT_MODE });
                        const cleanup = await removeResources({ containers: { names: [options.name] } });
                        if (!cleanup.ok) {
                            throw new Error('Unable to remove existing container');
                        }

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
                            break;
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
                                process.stdout.write(`${colors.cyan}[${options.name}]${colors.reset} ${line}\n`);
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
                            interval: BOOT_MODE === 'super' ? 1000 : 2000,
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
                            break;
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
                                health: { ...healthResult.data, url: healthUrl }
                            }
                        });
                    } catch (e) {
                        print.error(`Failed to start ${svc}: ${e.message}`);
                        await recordLifecycleEvent({
                            action: 'start',
                            service: svc,
                            status: 'failed',
                            details: {
                                message: e.message,
                                logs: logBuffer.slice(-20)
                            }
                        });
                    } finally {
                        if (logStream?.destroy) {
                            logStream.destroy();
                        }
                    }
                    break;
                }

                case '6': // Clean
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
                    } catch (e) {
                        print.error(`Failed to clean ${svc}: ${e.message}`);
                        await recordLifecycleEvent({
                            action: 'clean',
                            service: svc,
                            status: 'failed',
                            details: { message: e.message }
                        });
                    }
                    break;
            }
        }

        const again = await rl.question('\nReturn to main menu? (y/N): ');
        if (again.toLowerCase() !== 'y') break;
    }

    rl.close();
    console.log(`${colors.cyan}Goodbye!${colors.reset}`);
};

run();
