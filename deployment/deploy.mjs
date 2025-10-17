// deploy.mjs - Noona Docker Manager (Node.js version)
import readline from 'readline/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { chmod, readFile } from 'fs/promises';
import {
    buildImage,
    pushImage,
    pullImage,
    runContainer,
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
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
        return;
    }

    for (const info of containers) {
        const name = info.Names?.[0]?.replace(/^\//, '') || info.Id;
        const outcome = await stopContainer({ name });
        if (!outcome.ok) {
            print.error(`Failed to stop ${name}: ${outcome.error?.message}`);
        }
    }

    print.success('Stop command sent to all running Noona containers.');
};

const cleanService = async service => {
    const image = `${DOCKERHUB_USER}/noona-${service}`;
    const local = `noona-${service}`;

    const removal = await removeResources({
        containers: { names: [local] },
        images: {
            references: [
                `${image}:latest`,
                image,
                `${local}:latest`,
                local
            ]
        }
    });

    if (!removal.ok) {
        throw new Error('Some resources could not be removed.');
    }

    if (service === 'warden') {
        await removeResources({ networks: { names: [NETWORK_NAME] } });
    }
};

const deleteDockerResources = async () => {
    const confirmation = (await rl.question(`${colors.red}This will delete ALL local Noona Docker containers, images, volumes, and networks. Type DELETE to continue: ${colors.reset}`)).trim().toUpperCase();

    if (confirmation !== 'DELETE') {
        print.error('Delete aborted.');
        return;
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
        return;
    }

    print.success('All local Noona Docker resources deleted.');
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
                await stopAllContainers();
            } catch (e) {
                print.error(`Failed to stop containers: ${e.message}`);
            }
            continue;
        }

        if (mainChoice === '7') {
            try {
                await deleteDockerResources();
            } catch (e) {
                print.error(`Failed to delete Docker resources: ${e.message}`);
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
            const local = `noona-${svc}`;

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

                case '4': // Start
                    console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
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
                        const result = await runContainer(options);
                        reportDockerResult(result, {
                            successMessage: `${svc} started.`,
                            failureMessage: `Failed to start ${svc}`
                        });
                    } catch (e) {
                        print.error(`Failed to start ${svc}: ${e.message}`);
                    }
                    break;

                case '6': // Clean
                    console.log(`${colors.yellow}🧹 Cleaning ${svc}...${colors.reset}`);
                    try {
                        await cleanService(svc);
                        print.success(`Cleaned ${svc}`);
                    } catch (e) {
                        print.error(`Failed to clean ${svc}: ${e.message}`);
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
