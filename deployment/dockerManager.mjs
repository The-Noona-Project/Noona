// dockerManager.mjs - consolidated Noona Docker Manager
import { fileURLToPath } from 'url';
import { dirname, resolve, join, relative, posix } from 'path';
import { access, appendFile, chmod, mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import util from 'util';
import { EventEmitter } from 'node:events';
import Docker from 'dockerode';
import { pack } from 'tar-fs';
import ignore from 'ignore';
import {
    defaultDockerSocketDetector,
    isWindowsPipePath,
    normalizeDockerSocket,
    isTcpDockerSocket,
} from '../utilities/etc/dockerSockets.mjs';
const noop = () => {};

const pickLoggerMethod = (logger, candidates) => {
    for (const method of candidates) {
        if (logger && typeof logger[method] === 'function') {
            return logger[method].bind(logger);
        }
    }
    return noop;
};

class BuildQueue extends EventEmitter {
    constructor({ workerThreads = 4, subprocessesPerWorker = 2, logger = console } = {}) {
        super();
        if (!Number.isInteger(workerThreads) || workerThreads < 1) {
            throw new TypeError('workerThreads must be a positive integer');
        }
        if (!Number.isInteger(subprocessesPerWorker) || subprocessesPerWorker < 1) {
            throw new TypeError('subprocessesPerWorker must be a positive integer');
        }

        this.workerThreads = workerThreads;
        this.subprocessesPerWorker = subprocessesPerWorker;
        this.logger = {
            info: pickLoggerMethod(logger, ['info', 'log']),
            warn: pickLoggerMethod(logger, ['warn', 'info', 'log']),
            error: pickLoggerMethod(logger, ['error', 'warn', 'log'])
        };

        this.queue = [];
        this.active = 0;
        this.limit = workerThreads;
        this.completed = [];
        this.jobCounter = 0;
    }

    useBaseCapacity() {
        this.limit = this.workerThreads;
        this.emit('capacityChange', { limit: this.limit });
        this.#process();
        return this.limit;
    }

    useMaxCapacity() {
        this.limit = this.workerThreads * this.subprocessesPerWorker;
        this.emit('capacityChange', { limit: this.limit });
        this.#process();
        return this.limit;
    }

    getCurrentCapacity() {
        return this.limit;
    }

    enqueue({ name, run }) {
        if (typeof run !== 'function') {
            throw new TypeError('enqueue requires a run() function');
        }

        const id = name || `job-${++this.jobCounter}`;
        return new Promise((resolve, reject) => {
            this.queue.push({ id, run, resolve, reject });
            this.emit('enqueued', { id, size: this.queue.length });
            setImmediate(() => this.#process());
        });
    }

    async drain() {
        if (this.active === 0 && this.queue.length === 0) {
            return;
        }

        return new Promise(resolve => {
            const handleIdle = () => {
                this.off('idle', handleIdle);
                resolve();
            };
            this.on('idle', handleIdle);
        });
    }

    getResults() {
        return this.completed.map(entry => ({
            ...entry,
            logs: [...entry.logs]
        }));
    }

    #process() {
        while (this.active < this.limit && this.queue.length > 0) {
            this.#runNext();
        }
    }

    #runNext() {
        const job = this.queue.shift();
        if (!job) return;

        const { id, run, resolve, reject } = job;
        const startedAt = Date.now();
        const logs = [];
        this.active += 1;

        const logLine = (level, message) => {
            if (!message) return;
            const text = `[${id}] ${message}`;
            logs.push(text);
            switch (level) {
                case 'error':
                    this.logger.error(text);
                    break;
                case 'warn':
                    this.logger.warn(text);
                    break;
                default:
                    this.logger.info(text);
                    break;
            }
            this.emit('log', { id, level, message, text });
        };

        logLine('info', `started (active ${this.active}/${this.limit})`);

        const report = entry => {
            if (!entry) return;
            const normalized = typeof entry === 'string'
                ? { level: 'info', message: entry }
                : { level: entry.level || 'info', message: entry.message || '' };
            if (!normalized.message) return;
            logLine(normalized.level, normalized.message);
        };

        const finalize = (status, payload) => {
            const finishedAt = Date.now();
            const duration = finishedAt - startedAt;
            if (status === 'fulfilled') {
                logLine('info', `completed in ${duration}ms`);
                this.completed.push({ id, status, value: payload, logs: [...logs], startedAt, finishedAt, duration });
            } else {
                const error = payload instanceof Error ? payload : new Error(String(payload));
                const reason = error.message || 'Unknown error';
                logLine('error', `failed after ${duration}ms: ${reason}`);
                if (Array.isArray(error.records)) {
                    for (const record of error.records) {
                        if (typeof record === 'string' && record.trim()) {
                            logLine('error', record.trim());
                        }
                    }
                }
                this.completed.push({ id, status, error, logs: [...logs], startedAt, finishedAt, duration });
            }
        };

        Promise.resolve()
            .then(() => run(report))
            .then(result => {
                finalize('fulfilled', result);
                job.resolve(result);
            })
            .catch(error => {
                finalize('rejected', error);
                job.reject(error);
            })
            .finally(() => {
                this.active = Math.max(0, this.active - 1);
                if (this.active === 0 && this.queue.length === 0) {
                    this.emit('idle');
                } else {
                    this.#process();
                }
            });
    }
}

const success = (data = null, warnings = []) => ({ ok: true, data, warnings });

const failure = (operation, error, context = {}) => {
    const normalized = {
        message: error?.json?.message || error?.message || 'Unknown error',
        code: error?.statusCode || error?.code || null,
        reason: error?.reason || null,
        context
    };

    if (error?.stack) {
        normalized.stack = error.stack;
    }

    return {
        ok: false,
        error: {
            operation,
            ...normalized
        }
    };
};

const readDockerIgnore = async (context, dockerfile) => {
    const ig = ignore().add(['.git', 'node_modules', 'dist', 'build']);
    const candidatePaths = new Set([join(context, '.dockerignore')]);
    if (dockerfile) {
        const dockerDir = dirname(dockerfile);
        if (dockerDir.startsWith(context)) {
            candidatePaths.add(join(dockerDir, '.dockerignore'));
        }
    }

    for (const filePath of candidatePaths) {
        try {
            await access(filePath);
            const contents = await readFile(filePath, 'utf8');
            const entries = contents
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            if (entries.length) {
                ig.add(entries);
            }
        } catch {
            // ignore missing file
        }
    }
    return ig;
};

const createBuildContext = async (contextPath, dockerfile) => {
    const absoluteContext = resolve(contextPath);
    const ig = await readDockerIgnore(absoluteContext, dockerfile);
    return pack(absoluteContext, {
        ignore: (name) => {
            if (!name) return false;
            const relativePath = relative(absoluteContext, name);
            if (!relativePath) return false;
            return ig.ignores(relativePath);
        }
    });
};

const normalizeDockerfilePath = (contextPath, dockerfilePath) => {
    if (!dockerfilePath) {
        return dockerfilePath;
    }

    const normalizedContext = contextPath ? contextPath.replace(/\\/g, '/') : contextPath;
    const normalizedDockerfile = dockerfilePath.replace(/\\/g, '/');
    const relativePath = normalizedContext
        ? posix.relative(normalizedContext, normalizedDockerfile)
        : '';
    const candidate = relativePath && relativePath.length > 0 ? relativePath : normalizedDockerfile;
    return candidate;
};

const generateRemediation = (name, url) => {
    if (name && /warden/i.test(name)) {
        return [
            'Ensure the Warden container can bind the configured host port (default 4001).',
            'Verify the Docker socket volume (/var/run/docker.sock) is mounted so Warden can inspect other containers.',
            `Confirm the health endpoint ${url} is reachable from the host.`,
            'Inspect the Warden logs for startup or dependency errors.'
        ].join(' ');
    }

    return 'Inspect the container logs and verify the Docker network configuration for the service.';
};

class DockerHost {
    constructor(options = {}) {
        const {
            createDocker = (cfg) => new Docker(cfg),
            detectDockerSockets = defaultDockerSocketDetector,
            ...dockerOptions
        } = options;
        const hasOwn = (key) => Object.prototype.hasOwnProperty.call(dockerOptions, key);

        const config = { ...dockerOptions };
        const removeTcpFields = () => {
            delete config.host;
            delete config.port;
            delete config.protocol;
        };

        const adoptSocketPath = (candidate) => {
            if (typeof candidate !== 'string') {
                return false;
            }

            const normalized = normalizeDockerSocket(candidate);
            if (!normalized) {
                return false;
            }

            config.socketPath = normalized;

            if (isWindowsPipePath(normalized) || (
                !hasOwn('host') &&
                !hasOwn('port') &&
                !hasOwn('protocol')
            )) {
                removeTcpFields();
            }

            return true;
        };

        let usingSocket = false;

        if (hasOwn('socketPath')) {
            usingSocket = adoptSocketPath(config.socketPath);
            if (!usingSocket) {
                delete config.socketPath;
            }
        }

        const dockerHostEnv = process.env.DOCKER_HOST;

        if (!usingSocket && dockerHostEnv && !hasOwn('host')) {
            if (adoptSocketPath(dockerHostEnv)) {
                usingSocket = true;
            } else {
                const url = new URL(dockerHostEnv);
                config.host = url.hostname;
                config.port = url.port || 2375;
                config.protocol = url.protocol.replace(':', '');
                delete config.socketPath;
            }
        }

        const shouldDetectSockets =
            !usingSocket &&
            !dockerHostEnv &&
            !config.socketPath &&
            !hasOwn('socketPath') &&
            !hasOwn('host') &&
            !hasOwn('port') &&
            !hasOwn('protocol') &&
            !config.host &&
            !config.port &&
            !config.protocol;

        if (shouldDetectSockets) {
            const detected = typeof detectDockerSockets === 'function'
                ? detectDockerSockets({ env: process.env })
                : [];
            const firstSocket = Array.isArray(detected)
                ? detected.find((entry) => typeof entry === 'string' && entry.trim().length > 0)
                : null;

            usingSocket = adoptSocketPath(firstSocket);

            if (!usingSocket) {
                usingSocket = adoptSocketPath('/var/run/docker.sock');
            }
        }

        if (!usingSocket && !config.host && !config.socketPath) {
            config.socketPath = '/var/run/docker.sock';
        }

        this.docker = createDocker(config);
    }

    async _collectStream(stream) {
        return new Promise((resolvePromise, rejectPromise) => {
            const records = [];
            this.docker.modem.followProgress(stream, (err, res) => {
                if (err) {
                    rejectPromise(err);
                    return;
                }
                resolvePromise({ records, response: res });
            }, evt => {
                records.push(evt);
            });
        });
    }

    async buildImage({ context, dockerfile, tag, buildArgs = {}, noCache = false }) {
        try {
            const buildStream = await this.docker.buildImage(await createBuildContext(context, dockerfile), {
                t: tag,
                dockerfile: normalizeDockerfilePath(context, dockerfile),
                buildargs: buildArgs,
                nocache: noCache
            });
            const { records } = await this._collectStream(buildStream);
            const warnings = records.filter(entry => entry?.stream?.toLowerCase().includes('warning'));
            return success({ records }, warnings.map(entry => entry.stream));
        } catch (error) {
            return failure('buildImage', error, { context, dockerfile, tag, noCache });
        }
    }

    async pushImage({ reference }) {
        try {
            const image = this.docker.getImage(reference);
            const stream = await image.push({});
            const { records } = await this._collectStream(stream);
            return success({ records });
        } catch (error) {
            return failure('pushImage', error, { reference });
        }
    }

    async pullImage({ reference }) {
        try {
            const stream = await this.docker.pull(reference);
            const { records } = await this._collectStream(stream);
            return success({ records });
        } catch (error) {
            return failure('pullImage', error, { reference });
        }
    }

    async runContainer({ name, image, env = {}, network, hostConfig = {}, exposedPorts = {} }) {
        try {
            const Env = Object.entries(env).map(([key, value]) => `${key}=${value}`);
            const baseHostConfig = { AutoRemove: true, NetworkMode: network, ...hostConfig };
            const container = await this.docker.createContainer({
                name,
                Image: image,
                Env,
                Hostname: name,
                HostConfig: baseHostConfig,
                NetworkingConfig: network ? { EndpointsConfig: { [network]: {} } } : undefined,
                ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined
            });
            await container.start();
            return success({ id: container.id });
        } catch (error) {
            return failure('runContainer', error, { name, image });
        }
    }

    async startService({ name, healthCheck, ...options }) {
        const result = await this.runContainer({ name, ...options });
        if (!result.ok) {
            return result;
        }

        try {
            const container = this.docker.getContainer(name);
            const inspection = await container.inspect();
            const networks = Object.keys(inspection?.NetworkSettings?.Networks || {});
            const attached = options.network ? networks.includes(options.network) : true;
            if (!attached) {
                const error = new Error(`Container is not attached to network ${options.network}`);
                return failure('startService', error, {
                    name,
                    requestedNetwork: options.network,
                    networks,
                    networkAttached: false,
                    inspection
                });
            }

            if (healthCheck?.url) {
                const { url, interval, timeout, expectedStatus } = healthCheck;
                const healthResult = await this.waitForHealth({
                    name,
                    url,
                    interval,
                    timeout,
                    expectedStatus
                });
                if (!healthResult.ok) {
                    return {
                        ...healthResult,
                        error: {
                            ...healthResult.error,
                            context: {
                                ...healthResult.error.context,
                                inspection
                            }
                        }
                    };
                }

                return success({
                    id: result.data.id,
                    inspection,
                    health: healthResult.data
                });
            }

            return success({ id: result.data.id, inspection });
        } catch (error) {
            return failure('startService', error, { name, network: options.network });
        }
    }

    async streamLogs({
        name,
        follow = true,
        stdout = true,
        stderr = true,
        tail = 50,
        since,
        onData
    }) {
        try {
            const container = this.docker.getContainer(name);
            const stream = await container.logs({
                follow,
                stdout,
                stderr,
                tail,
                since,
                timestamps: false
            });

            if (onData) {
                stream.on('data', chunk => {
                    const text = chunk?.toString?.('utf8') || '';
                    if (!text) return;
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    lines.forEach(line => onData(line));
                });
            }

            return success({ stream });
        } catch (error) {
            return failure('streamLogs', error, { name, follow, tail, since });
        }
    }

    async waitForHealth({ name, url, interval = 2000, timeout = 60000, expectedStatus }) {
        const deadline = Date.now() + timeout;
        let attempts = 0;
        let lastError = null;

        while (Date.now() <= deadline) {
            attempts += 1;
            try {
                const response = await fetch(url);
                const statusOk = expectedStatus ? response.status === expectedStatus : response.ok;
                if (statusOk) {
                    return success({ attempts, status: response.status });
                }
                lastError = new Error(`Unexpected status code: ${response.status}`);
            } catch (error) {
                lastError = error;
            }

            if (Date.now() + interval > deadline) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        const context = {
            name,
            url,
            attempts,
            timeout,
            remediation: generateRemediation(name, url)
        };
        if (lastError?.message) {
            context.lastError = lastError.message;
        }
        return failure('waitForHealth', lastError || new Error('Health check timed out'), context);
    }

    async stopContainer({ name, timeout = 10 }) {
        try {
            const container = this.docker.getContainer(name);
            await container.stop({ t: timeout });
            return success({ name });
        } catch (error) {
            if (error?.statusCode === 304 || error?.statusCode === 404) {
                return success({ name, skipped: true });
            }
            return failure('stopContainer', error, { name });
        }
    }

    async removeResources({
        containers = {},
        images = {},
        volumes = {},
        networks = {}
    } = {}) {
        const summary = {
            containers: [],
            images: [],
            volumes: [],
            networks: [],
            errors: []
        };

        const collectError = (operation, target, error) => {
            summary.errors.push({ operation, target, message: error?.message, code: error?.statusCode || error?.code });
        };

        try {
            if (containers?.names?.length || containers?.filters || containers?.match) {
                const listOptions = {
                    all: true,
                    ...(containers.filters ? { filters: containers.filters } : {})
                };
                if (!containers.filters && containers.names?.length) {
                    listOptions.filters = { name: containers.names };
                }
                const listed = await this.docker.listContainers(listOptions);
                for (const info of listed) {
                    const ref = this.docker.getContainer(info.Id);
                    try {
                        if (containers.match && !info.Names?.some(name => containers.match(name.replace(/^\//, '')))) {
                            continue;
                        }
                        await ref.remove({ force: true, v: Boolean(containers.removeVolumes) });
                        summary.containers.push(info.Names?.[0] || info.Id);
                    } catch (error) {
                        collectError('removeContainer', info.Names?.[0] || info.Id, error);
                    }
                }
            }
        } catch (error) {
            collectError('listContainers', 'containers', error);
        }

        try {
            if (images?.references?.length || images?.filters || images?.match) {
                const listed = await this.docker.listImages(images.filters ? { filters: images.filters } : {});
                const matched = listed.filter(img => {
                    const repoTags = img.RepoTags || [];
                    if (images.references?.length) {
                        return repoTags.some(tag => images.references.includes(tag));
                    }
                    if (images.match) {
                        return repoTags.some(tag => images.match(tag));
                    }
                    return false;
                });
                for (const img of matched) {
                    const tag = (img.RepoTags && img.RepoTags[0]) || img.Id;
                    try {
                        await this.docker.getImage(img.Id).remove({ force: true, noprune: false });
                        summary.images.push(tag);
                    } catch (error) {
                        collectError('removeImage', tag, error);
                    }
                }
            }
        } catch (error) {
            collectError('listImages', 'images', error);
        }

        try {
            if (volumes?.filters) {
                const { Volumes = [] } = await this.docker.listVolumes({ filters: volumes.filters });
                for (const volume of Volumes) {
                    try {
                        await this.docker.getVolume(volume.Name).remove({ force: true });
                        summary.volumes.push(volume.Name);
                    } catch (error) {
                        collectError('removeVolume', volume.Name, error);
                    }
                }
            }
        } catch (error) {
            collectError('listVolumes', 'volumes', error);
        }

        try {
            if (networks?.names?.length || networks?.filters) {
                const listed = await this.docker.listNetworks(networks.filters ? { filters: networks.filters } : {});
                const matched = listed.filter(net => {
                    if (networks.names?.length) {
                        return networks.names.includes(net.Name);
                    }
                    return true;
                });
                for (const net of matched) {
                    try {
                        await this.docker.getNetwork(net.Id).remove();
                        summary.networks.push(net.Name);
                    } catch (error) {
                        collectError('removeNetwork', net.Name, error);
                    }
                }
            }
        } catch (error) {
            collectError('listNetworks', 'networks', error);
        }

        if (summary.errors.length) {
            return {
                ok: false,
                data: summary,
                error: {
                    operation: 'removeResources',
                    message: 'Some resources could not be removed',
                    details: summary.errors
                }
            };
        }

        return success(summary);
    }

    async inspectNetwork(name) {
        try {
            const network = this.docker.getNetwork(name);
            const details = await network.inspect();
            return success(details);
        } catch (error) {
            if (error?.statusCode === 404) {
                return failure('inspectNetwork', error, { name, notFound: true });
            }
            return failure('inspectNetwork', error, { name });
        }
    }

    async createNetwork({ name, options = {} }) {
        try {
            const network = await this.docker.createNetwork({ Name: name, ...options });
            return success(await network.inspect());
        } catch (error) {
            return failure('createNetwork', error, { name });
        }
    }

    async listContainers(options = {}) {
        try {
            const containers = await this.docker.listContainers(options);
            return success(containers);
        } catch (error) {
            return failure('listContainers', error, options);
        }
    }
}

const dockerHost = new DockerHost();

const buildImage = options => dockerHost.buildImage(options);
const pushImage = options => dockerHost.pushImage(options);
const pullImage = options => dockerHost.pullImage(options);
const runContainer = options => dockerHost.runContainer(options);
const startService = options => dockerHost.startService(options);
const streamLogs = options => dockerHost.streamLogs(options);
const waitForHealth = options => dockerHost.waitForHealth(options);
const stopContainer = options => dockerHost.stopContainer(options);
const removeResources = options => dockerHost.removeResources(options);
const inspectNetwork = name => dockerHost.inspectNetwork(name);
const createNetwork = options => dockerHost.createNetwork(options);
const listContainers = options => dockerHost.listContainers(options);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const LOG_DIR = resolve(__dirname, 'logs');
const DOCKERHUB_USER = 'captainpax';
const SERVICES = ['moon', 'warden', 'raven', 'sage', 'vault', 'portal'];
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

const stripAnsi = input => typeof input === 'string'
    ? input.replace(/\u001B\[[0-9;]*m/g, '')
    : String(input ?? '');

const ensureLogDirectory = async () => {
    try {
        await mkdir(LOG_DIR, { recursive: true });
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }
    }
};

const pruneOldLogs = async () => {
    try {
        const entries = await readdir(LOG_DIR);
        const stats = await Promise.all(entries.map(async name => {
            const filePath = resolve(LOG_DIR, name);
            try {
                const fileStats = await stat(filePath);
                return { filePath, name, mtime: fileStats.mtimeMs, isFile: fileStats.isFile() };
            } catch {
                return null;
            }
        }));

        const files = stats
            .filter(Boolean)
            .filter(entry => entry.isFile)
            .sort((a, b) => b.mtime - a.mtime);

        const stale = files.slice(3);
        await Promise.all(stale.map(async entry => {
            try {
                await unlink(entry.filePath);
            } catch {
                // ignore deletion failures to avoid interrupting logging
            }
        }));
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            // Swallow errors silently to avoid recursive logging loops
        }
    }
};

const createTimestampedLogFile = async () => {
    await ensureLogDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = resolve(LOG_DIR, `deploy-${timestamp}.log`);
    try {
        await appendFile(filePath, `# Noona deployment log started ${new Date().toISOString()}\n`);
    } catch (error) {
        throw error;
    }
    await pruneOldLogs();
    return filePath;
};

let activeLogFilePath = null;

const getActiveDeploymentLogFile = async () => {
    if (!activeLogFilePath) {
        try {
            activeLogFilePath = await createTimestampedLogFile();
        } catch (error) {
            activeLogFilePath = null;
            throw error;
        }
    }
    return activeLogFilePath;
};

const appendDeploymentLogEntry = async (level = 'info', message = '') => {
    const text = stripAnsi(String(message ?? ''));
    if (!text.trim()) {
        return;
    }
    try {
        const filePath = await getActiveDeploymentLogFile();
        const timestamp = new Date().toISOString();
        await appendFile(filePath, `[${timestamp}] [${String(level).toUpperCase()}] ${text}\n`);
    } catch {
        // Ignore write errors to avoid interfering with CLI output
    }
};

const collectDetectedSockets = detectionResult => {
    const rawCandidates = Array.isArray(detectionResult)
        ? detectionResult
        : (typeof detectionResult === 'undefined' ? [] : [detectionResult]);

    return rawCandidates
        .map(candidate => normalizeDockerSocket(candidate, { allowRemote: true }))
        .filter(candidate => typeof candidate === 'string' && candidate.trim().length > 0);
};

const resolveDockerSocketBinding = ({
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
        appendDeploymentLogEntry('info', message).catch(() => {});
        if (typeof reporter.info === 'function') {
            reporter.info(message);
        } else {
            original.log(...args);
        }
    };
    console.warn = (...args) => {
        const message = formatConsoleArgs(args);
        appendDeploymentLogEntry('warn', message).catch(() => {});
        if (typeof reporter.warn === 'function') {
            reporter.warn(message);
        } else {
            original.warn(...args);
        }
    };
    console.error = (...args) => {
        const message = formatConsoleArgs(args);
        appendDeploymentLogEntry('error', message).catch(() => {});
        if (typeof reporter.error === 'function') {
            reporter.error(message);
        } else {
            original.error(...args);
        }
    };
    console.table = (data, columns) => {
        const tableSummary = util.inspect({ columns, data }, { depth: 3, colors: false });
        appendDeploymentLogEntry('table', tableSummary).catch(() => {});
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
    appendDeploymentLogEntry(kind, message).catch(() => {});
    if (activeReporter && typeof activeReporter[kind] === 'function') {
        activeReporter[kind](message);
        return;
    }
    fallback(message);
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

const normalizeHostDockerSocketOverride = value => {
    if (value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = normalizeDockerSocket(value, { allowRemote: true });
    return normalized || null;
};

const defaultDeploymentConfig = () => ({
    buildScheduler: {
        workerThreads: DEFAULT_WORKER_THREADS,
        subprocessesPerWorker: DEFAULT_SUBPROCESSES_PER_WORKER
    },
    defaults: {
        debugLevel: DEFAULT_DEBUG_LEVEL,
        bootMode: DEFAULT_BOOT_MODE
    },
    hostDockerSocketOverride: null
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

        if (Object.prototype.hasOwnProperty.call(parsed, 'hostDockerSocketOverride')) {
            config.hostDockerSocketOverride = normalizeHostDockerSocketOverride(parsed.hostDockerSocketOverride);
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
        },
        hostDockerSocketOverride: normalizeHostDockerSocketOverride(next.hostDockerSocketOverride ?? null)
    };

    cachedDeploymentConfig = normalized;
    await writeFile(BUILD_CONFIG_PATH, JSON.stringify(normalized, null, 2));
    return normalized;
};

const fetchSettings = async () => loadDeploymentConfig();

const updateSettings = async (updates = {}) => {
    const concurrencySource = updates.concurrency || updates.buildScheduler || updates;
    const defaultsSource = updates.defaults || updates;

    const workerThreads = concurrencySource.workerThreads ?? updates.workerThreads;
    const subprocessesPerWorker = concurrencySource.subprocessesPerWorker ?? updates.subprocessesPerWorker;
    const debugLevel = defaultsSource.debugLevel ?? updates.debugLevel;
    const bootMode = defaultsSource.bootMode ?? updates.bootMode;
    const hostDockerSocketOverride = Object.prototype.hasOwnProperty.call(updates, 'hostDockerSocketOverride')
        ? updates.hostDockerSocketOverride
        : Object.prototype.hasOwnProperty.call(updates?.defaults ?? {}, 'hostDockerSocketOverride')
            ? updates.defaults.hostDockerSocketOverride
            : undefined;

    return saveDeploymentConfig(config => ({
        ...config,
        buildScheduler: {
            workerThreads: workerThreads ?? config.buildScheduler.workerThreads,
            subprocessesPerWorker: subprocessesPerWorker ?? config.buildScheduler.subprocessesPerWorker
        },
        defaults: {
            debugLevel: debugLevel ?? config.defaults.debugLevel,
            bootMode: bootMode ?? config.defaults.bootMode
        },
        hostDockerSocketOverride: hostDockerSocketOverride !== undefined
            ? hostDockerSocketOverride
            : config.hostDockerSocketOverride
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

const createContainerOptions = (service, image, envVars = {}, {
    detectDockerSockets,
    platform,
    hostDockerSocketOverride,
    bindHostDockerSocket = true,
} = {}) => {
    const entries = Object.entries(envVars)
        .filter(([, value]) => typeof value === 'string' && value.trim() !== '');

    const normalizedEnv = Object.fromEntries(entries);
    if (!normalizedEnv.SERVICE_NAME) {
        normalizedEnv.SERVICE_NAME = `noona-${service}`;
    }

    const containerName = normalizedEnv.SERVICE_NAME;
    const hostConfig = { Binds: [] };
    const socketCandidates = new Set();

    if (bindHostDockerSocket) {
        const normalizedOverride = hostDockerSocketOverride !== undefined
            ? normalizeHostDockerSocketOverride(hostDockerSocketOverride)
            : null;

        let hostDockerSocket = normalizedOverride;
        if (!hostDockerSocket) {
            hostDockerSocket =
                typeof detectDockerSockets === 'function' || typeof platform === 'string'
                    ? resolveDockerSocketBinding({ detectSockets: detectDockerSockets, platform })
                    : getDefaultDockerSocketBinding();
        }

        if (typeof hostDockerSocket === 'string' && hostDockerSocket.trim()) {
            const trimmed = hostDockerSocket.trim();
            const remoteSocket = isTcpDockerSocket(trimmed);

            if (!remoteSocket) {
                hostConfig.Binds.push(`${trimmed}:${DOCKER_SOCKET_TARGET}`);
                socketCandidates.add(trimmed);
                socketCandidates.add(DOCKER_SOCKET_TARGET);
            } else {
                socketCandidates.add(trimmed);
                if (service === 'warden' && !normalizedEnv.DOCKER_HOST) {
                    normalizedEnv.DOCKER_HOST = trimmed;
                }
            }
        } else if (hostDockerSocket) {
            hostConfig.Binds.push(`${hostDockerSocket}:${DOCKER_SOCKET_TARGET}`);
            socketCandidates.add(DOCKER_SOCKET_TARGET);
        }
    }

    const exposedPorts = {};

    if (service === 'warden') {
        const apiPort = normalizedEnv.WARDEN_API_PORT?.trim() || '4001';
        const portKey = `${apiPort}/tcp`;
        hostConfig.PortBindings = { [portKey]: [{ HostPort: apiPort }] };
        exposedPorts[portKey] = {};

        if (bindHostDockerSocket && !normalizedEnv.NOONA_HOST_DOCKER_SOCKETS && socketCandidates.size > 0) {
            normalizedEnv.NOONA_HOST_DOCKER_SOCKETS = Array.from(socketCandidates).join(',');
        }
        if (bindHostDockerSocket && !normalizedEnv.HOST_DOCKER_SOCKETS && socketCandidates.size > 0) {
            normalizedEnv.HOST_DOCKER_SOCKETS = normalizedEnv.NOONA_HOST_DOCKER_SOCKETS;
        }
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

const stopAllContainers = async ({ reporter } = {}) => {
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

const cleanServices = async (services, { reporter } = {}) => {
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

const deleteDockerResources = async ({ reporter, confirm = false } = {}) => {
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

const buildServices = async (services, options = {}) => {
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

const pushServices = async (services, { reporter, onProgress } = {}) => {
    return runRegistryOperation({
        services,
        operation: pushImage,
        verb: '📤 Pushing',
        reporter,
        onProgress
    });
};

const pullServices = async (services, { reporter, onProgress } = {}) => {
    return runRegistryOperation({
        services,
        operation: pullImage,
        verb: '📥 Pulling',
        reporter,
        onProgress
    });
};

const resolveDebugDefaults = async ({ debugLevel, bootMode, config } = {}) => {
    const sourceConfig = config || await loadDeploymentConfig();
    const resolvedBoot = (bootMode || sourceConfig.defaults.bootMode || DEFAULT_BOOT_MODE).toLowerCase();
    const resolvedDebug = (debugLevel || sourceConfig.defaults.debugLevel || DEFAULT_DEBUG_LEVEL).toLowerCase();
    const effectiveDebug = resolvedBoot === 'super' ? 'super' : resolvedDebug;
    return { bootMode: resolvedBoot, debugLevel: effectiveDebug, requestedDebug: resolvedDebug };
};

const startServices = async (services, {
    reporter,
    debugLevel,
    bootMode,
    onProgress,
    onLog,
    hostDockerSocketOverride,
    bindHostDockerSocket = true
} = {}) => {
    const targets = normalizeServices(services);
    if (!targets.length) {
        print.error('No services selected for start.');
        return { ok: false, results: [] };
    }

    return withReporter(reporter, async () => {
        const results = [];
        const config = await loadDeploymentConfig();
        const resolvedHostDockerSocketOverride = bindHostDockerSocket
            ? (hostDockerSocketOverride !== undefined
                ? hostDockerSocketOverride
                : config.hostDockerSocketOverride)
            : undefined;

        for (const svc of targets) {
            if (svc !== 'warden') {
                print.error(`Start is currently supported for the warden orchestrator. Skipping ${svc}.`);
                results.push({ service: svc, ok: false, error: new Error('unsupported-service') });
                continue;
            }

            console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
            const logBuffer = [];
            let logStream;
            const settings = await resolveDebugDefaults({ debugLevel, bootMode, config });

            try {
                await ensureNetwork();
                if (settings.bootMode === 'super' && settings.requestedDebug !== 'super') {
                    console.log(`${colors.cyan}ℹ️  Forcing DEBUG="super" to match selected boot mode.${colors.reset}`);
                }

                const image = `${DOCKERHUB_USER}/noona-${svc}`;
                const options = createContainerOptions(svc, image, {
                    DEBUG: settings.debugLevel,
                    BOOT_MODE: settings.bootMode
                }, {
                    hostDockerSocketOverride: resolvedHostDockerSocketOverride,
                    bindHostDockerSocket
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

const listManagedContainers = async ({ includeStopped = true } = {}) => {
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

const listServices = async ({ includeContainers = false, includeHistory = false, includeStopped = true } = {}) => {
    const payload = {
        services: [...SERVICES]
    };
    const errors = [];

    if (includeContainers) {
        try {
            payload.containers = await listManagedContainers({ includeStopped });
        } catch (error) {
            errors.push({ scope: 'containers', message: error?.message || 'Unable to list containers' });
        }
    }

    if (includeHistory) {
        try {
            payload.history = await readLifecycleHistory();
        } catch (error) {
            errors.push({ scope: 'history', message: error?.message || 'Unable to read lifecycle history' });
        }
    }

    if (errors.length) {
        payload.errors = errors;
    }

    return {
        ok: errors.length === 0,
        ...payload
    };
};

const build = async ({ services, useNoCache = false, concurrency = {}, reporter, onProgress } = {}) => {
    return buildServices(services, { useNoCache, concurrency, reporter, onProgress });
};

const push = async ({ services, reporter, onProgress } = {}) => {
    return pushServices(services, { reporter, onProgress });
};

const pull = async ({ services, reporter, onProgress } = {}) => {
    return pullServices(services, { reporter, onProgress });
};

const start = async ({ services, reporter, debugLevel, bootMode, onProgress, onLog, hostDockerSocketOverride, bindHostDockerSocket } = {}) => {
    return startServices(services, { reporter, debugLevel, bootMode, onProgress, onLog, hostDockerSocketOverride, bindHostDockerSocket });
};

const stop = async ({ reporter } = {}) => {
    return stopAllContainers({ reporter });
};

const clean = async ({ services, reporter } = {}) => {
    return cleanServices(services, { reporter });
};

const deleteResources = async ({ reporter, confirm = false } = {}) => {
    return deleteDockerResources({ reporter, confirm });
};

const fetchSettingsResult = async () => {
    const settings = await fetchSettings();
    return { ok: true, settings };
};

const updateSettingsResult = async (updates = {}) => {
    const settings = await updateSettings(updates);
    return { ok: true, settings };
};

const dockerManager = Object.freeze({
    services: Object.freeze([...SERVICES]),
    get logDirectory() {
        return LOG_DIR;
    },
    logs: {
        directory: LOG_DIR,
        getActiveFile: () => getActiveDeploymentLogFile(),
        append: (level, message) => appendDeploymentLogEntry(level, message)
    },
    history: {
        read: () => readLifecycleHistory()
    },
    containers: {
        list: (options) => listManagedContainers(options)
    },
    listServices,
    build,
    push,
    pull,
    start,
    stop,
    clean,
    deleteResources,
    fetchSettings: fetchSettingsResult,
    updateSettings: updateSettingsResult,
    __internals: {
        BuildQueue,
        DockerHost,
        normalizeDockerfilePath,
        resolveDockerSocketBinding,
        createContainerOptions,
        buildImage,
        pushImage,
        pullImage,
        runContainer,
        startService,
        streamLogs,
        waitForHealth,
        stopContainer,
        removeResources,
        normalizeHostDockerSocketOverride,
        inspectNetwork,
        createNetwork,
        listContainers,
        dockerHost,
        getActiveDeploymentLogFile,
        appendDeploymentLogEntry,
        readLifecycleHistory,
        listManagedContainers,
        fetchSettings,
        updateSettings
    }
});

export default dockerManager;
export {
    listServices,
    build,
    push,
    pull,
    start,
    stop,
    clean,
    deleteResources,
    fetchSettingsResult as fetchSettings,
    updateSettingsResult as updateSettings
};

