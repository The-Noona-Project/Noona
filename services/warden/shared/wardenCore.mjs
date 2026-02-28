// services/warden/shared/wardenCore.mjs
import fs from 'node:fs';
import path from 'node:path';

import Docker from 'dockerode';
import fetch from 'node-fetch';
import addonDockers from '../docker/addonDockers.mjs';
import noonaDockers from '../docker/noonaDockers.mjs';
import {
    attachSelfToNetwork,
    containerExists,
    ensureNetwork,
    formatDockerProgressMessage,
    pullImageIfNeeded,
    runContainerWithLogs,
    waitForHealthyStatus,
} from '../docker/dockerUtilties.mjs';
import {
    isDebugEnabled as isLoggerDebugEnabled,
    log,
    setDebug as setLoggerDebug,
    warn,
} from '../../../utilities/etc/logger.mjs';
import {
    defaultDockerSocketDetector,
    isTcpDockerSocket,
    isWindowsPipePath,
    normalizeDockerSocket as normalizeSocketPath,
    parseTcpDockerSocket,
} from '../../../utilities/etc/dockerSockets.mjs';
import {createWizardStateClient, createWizardStatePublisher,} from '../../sage/shared/wizardStateClient.mjs';

const describeSocketReference = (value) => {
    if (!value) {
        return 'default Docker instance';
    }

    const prefix = isTcpDockerSocket(value) ? 'endpoint' : 'socket';
    return `${prefix} ${value}`;
};

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const DEFAULT_VAULT_DATA_FOLDER_NAME = 'vault';
const DEFAULT_RAVEN_DATA_FOLDER_NAME = 'raven';
const RAVEN_CONTAINER_PATHS = new Set(['/kavita-data', '/data', '/app/downloads', '/downloads']);
const VAULT_REDIS_HOST_MOUNT_PATH_KEY = 'VAULT_REDIS_HOST_MOUNT_PATH';
const VAULT_MONGO_HOST_MOUNT_PATH_KEY = 'VAULT_MONGO_HOST_MOUNT_PATH';

function normalizeServices(servicesOption = {}) {
    const { addon = addonDockers, core = noonaDockers } = servicesOption;
    return { addon, core };
}

function normalizeDockerUtils(utilsOption = {}) {
    return {
        attachSelfToNetwork,
        containerExists,
        ensureNetwork,
        formatDockerProgressMessage,
        pullImageIfNeeded,
        runContainerWithLogs,
        waitForHealthyStatus,
        ...utilsOption,
    };
}

function createDefaultLogger(loggerOption = {}) {
    return {
        log,
        warn,
        ...loggerOption,
    };
}

function createServiceCatalog(services) {
    const catalog = new Map();

    for (const [category, entries] of Object.entries(services)) {
        for (const service of Object.values(entries)) {
            if (!service?.name) {
                continue;
            }

            catalog.set(service.name, {
                category,
                descriptor: service,
            });
        }
    }

    return catalog;
}

function cloneEnvConfig(config) {
    if (!Array.isArray(config)) {
        return [];
    }

    return config.map((entry) => ({
        key: entry?.key ?? null,
        label: entry?.label ?? entry?.key ?? null,
        defaultValue: entry?.defaultValue ?? '',
        description: entry?.description ?? null,
        warning: entry?.warning ?? null,
        required: entry?.required !== false,
        readOnly: entry?.readOnly === true,
    })).filter((entry) => typeof entry.key === 'string' && entry.key.trim().length > 0);
}

function applyEnvOverrides(descriptor, overrides) {
    if (!descriptor || !overrides || typeof overrides !== 'object') {
        return descriptor;
    }

    const envEntries = Array.isArray(descriptor.env) ? [...descriptor.env] : [];
    const order = [];
    const envMap = new Map();

    for (const entry of envEntries) {
        if (typeof entry !== 'string') {
            continue;
        }

        const [rawKey, ...rest] = entry.split('=');
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';

        if (!key) {
            continue;
        }

        if (!order.includes(key)) {
            order.push(key);
        }

        envMap.set(key, rest.join('=') ?? '');
    }

    for (const [candidateKey, candidateValue] of Object.entries(overrides)) {
        if (typeof candidateKey !== 'string') {
            continue;
        }

        const trimmedKey = candidateKey.trim();
        if (!trimmedKey) {
            continue;
        }

        if (!order.includes(trimmedKey)) {
            order.push(trimmedKey);
        }

        envMap.set(trimmedKey, candidateValue == null ? '' : String(candidateValue));
    }

    const mergedEnv = order.map((key) => `${key}=${envMap.get(key) ?? ''}`);

    return {
        ...descriptor,
        env: mergedEnv,
    };
}

function parseEnvEntries(entries = []) {
    const envMap = {};
    for (const entry of entries) {
        if (typeof entry !== 'string') {
            continue;
        }

        const [rawKey, ...rest] = entry.split('=');
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!key) {
            continue;
        }

        envMap[key] = rest.join('=') ?? '';
    }

    return envMap;
}

function normalizePathValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeContainerPath(value) {
    const normalized = normalizePathValue(value).replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }
    return normalized.replace(/\/+$/, '') || '/';
}

function isWindowsAbsolutePath(value) {
    return WINDOWS_DRIVE_PATH_PATTERN.test(value);
}

function toAbsoluteHostPath(value, {cwd = process.cwd()} = {}) {
    const trimmed = normalizePathValue(value);
    if (!trimmed) {
        return null;
    }

    if (isWindowsAbsolutePath(trimmed) || path.isAbsolute(trimmed)) {
        return path.normalize(trimmed);
    }

    return path.normalize(path.resolve(cwd, trimmed));
}

function isLikelyNamedDockerVolume(source) {
    const trimmed = normalizePathValue(source);
    if (!trimmed) {
        return true;
    }

    if (trimmed.startsWith('.')) {
        return false;
    }

    if (isWindowsAbsolutePath(trimmed) || path.isAbsolute(trimmed)) {
        return false;
    }

    return !trimmed.includes('/') && !trimmed.includes('\\');
}

function normalizeVaultFolderName(value, fallback = DEFAULT_VAULT_DATA_FOLDER_NAME) {
    const trimmed = normalizePathValue(value);
    if (!trimmed) {
        return fallback;
    }

    if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
        return fallback;
    }

    const cleaned = trimmed.replace(/[:*?"<>|]/g, '').trim();
    return cleaned || fallback;
}

function upsertEnvEntry(entries, key, value) {
    const list = Array.isArray(entries) ? [...entries] : [];
    const prefix = `${key}=`;
    const filtered = list.filter((entry) => !(typeof entry === 'string' && entry.startsWith(prefix)));
    filtered.push(`${key}=${value ?? ''}`);
    return filtered;
}

function upsertBindMount(entries, destination, mountEntry) {
    const list = Array.isArray(entries) ? [...entries] : [];
    const marker = `:${destination}`;
    const filtered = list.filter((entry) => {
        if (typeof entry !== 'string') {
            return true;
        }

        const trimmed = entry.trim();
        if (!trimmed) {
            return false;
        }

        return !(trimmed.endsWith(marker) || trimmed.includes(`${marker}:`));
    });

    filtered.push(mountEntry);
    return filtered;
}

function cloneServiceDescriptor(descriptor) {
    return {
        ...descriptor,
        env: Array.isArray(descriptor?.env) ? [...descriptor.env] : [],
        volumes: Array.isArray(descriptor?.volumes) ? [...descriptor.volumes] : undefined,
        envConfig: cloneEnvConfig(descriptor?.envConfig),
    };
}

function normalizeHostPort(value) {
    if (value == null || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    const rounded = Math.floor(parsed);
    if (rounded < 1 || rounded > 65535) {
        return null;
    }

    return rounded;
}

function parseImageReference(image) {
    if (typeof image !== 'string') {
        return null;
    }

    const trimmed = image.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.includes('@')) {
        const [withoutDigest] = trimmed.split('@');
        return parseImageReference(withoutDigest);
    }

    const firstSlashIndex = trimmed.indexOf('/');
    const firstSegment = firstSlashIndex >= 0 ? trimmed.slice(0, firstSlashIndex) : trimmed;
    const isExplicitRegistry = firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost';

    let registry = 'docker.io';
    let repositoryWithTag = trimmed;

    if (isExplicitRegistry && firstSlashIndex >= 0) {
        registry = firstSegment;
        repositoryWithTag = trimmed.slice(firstSlashIndex + 1);
    }

    const lastSlashIndex = repositoryWithTag.lastIndexOf('/');
    const lastColonIndex = repositoryWithTag.lastIndexOf(':');
    const hasTag = lastColonIndex > lastSlashIndex;
    const repository = hasTag ? repositoryWithTag.slice(0, lastColonIndex) : repositoryWithTag;
    const tag = hasTag ? repositoryWithTag.slice(lastColonIndex + 1) : 'latest';

    if (!repository) {
        return null;
    }

    const normalizedRepository =
        registry === 'docker.io' && !repository.includes('/')
            ? `library/${repository}`
            : repository;

    return {
        raw: trimmed,
        registry,
        repository: normalizedRepository,
        tag: tag || 'latest',
    };
}

const timestamp = () => new Date().toISOString();

const TRUTHY_DEBUG_VALUES = new Set(['1', 'true', 'yes', 'on', 'super']);
const NOONA_CONTAINER_NAME_PATTERN = /(^|[._-])noona-[a-z0-9-]+([._-]\d+)?$/i;
const NOONA_WARDEN_CONTAINER_PATTERN = /(^|[._-])noona-warden([._-]\d+)?$/i;
const NOONA_IMAGE_PATTERN = /(^|\/)noona-[a-z0-9-]+(?=[:@]|$)/i;
const NOONA_WARDEN_IMAGE_PATTERN = /(^|\/)noona-warden(?=[:@]|$)/i;

const isDebugFlagEnabled = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value > 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        return TRUTHY_DEBUG_VALUES.has(normalized);
    }

    return false;
};

export function createWarden(options = {}) {
    const {
        dockerInstance = new Docker(),
        services: servicesOption,
        dockerUtils: dockerUtilsOption,
        logger: loggerOption,
        env = process.env,
        processExit = (code) => process.exit(code),
        networkName: networkNameOption,
        trackedContainers: trackedContainersOption,
        superBootOrder: superBootOrderOption,
        hostDockerSockets: hostDockerSocketsOption,
        dockerSocketDetector = defaultDockerSocketDetector,
        dockerFactory: dockerFactoryOption,
        fs: fsOption,
        logLimit: logLimitOption,
        fetchImpl = fetch,
        wizardState: wizardStateOption = {},
        setIntervalImpl = setInterval,
        clearIntervalImpl = clearInterval,
    } = options;

    const services = normalizeServices(servicesOption);
    const dockerUtils = normalizeDockerUtils(dockerUtilsOption);
    const logger = createDefaultLogger(loggerOption);
    const serviceCatalog = createServiceCatalog(services);
    const fsModule = fsOption || fs;
    const serviceName = env.SERVICE_NAME || 'noona-warden';
    const serviceRuntimeConfig = new Map();
    const serviceUpdateSnapshots = new Map();
    const updateCheckIntervalMs = (() => {
        const candidate = Number.parseInt(env.SERVICE_UPDATE_CHECK_INTERVAL_MS ?? '3600000', 10);
        if (Number.isFinite(candidate) && candidate >= 60000) {
            return candidate;
        }
        return 3600000;
    })();
    let serviceUpdateTimer = null;

    const trackedContainers = trackedContainersOption || new Set();
    const networkName = networkNameOption || 'noona-network';
    const rawBootMode = typeof env.BOOT_MODE === 'string' ? env.BOOT_MODE.trim().toLowerCase() : null;
    const rawDebug = typeof env.DEBUG === 'string' ? env.DEBUG.trim().toLowerCase() : 'false';
    const BOOT_MODE = rawBootMode === 'super' ? 'super' : 'minimal';
    const DEBUG = rawBootMode === 'super' ? 'super' : (rawDebug || 'false');
    const SUPER_MODE = BOOT_MODE === 'super' || DEBUG === 'super';
    let runtimeDebug = DEBUG;
    setLoggerDebug(isDebugFlagEnabled(runtimeDebug));
    const hostServiceBase = env.HOST_SERVICE_URL ?? 'http://localhost';
    const bootOrder = superBootOrderOption || [
        'noona-redis',
        'noona-mongo',
        'noona-sage',
        'noona-moon',
        'noona-vault',
        'noona-portal',
        'noona-raven',
        'noona-oracle',
    ];
    const dependencyGraph = new Map([
        ['noona-vault', ['noona-mongo', 'noona-redis']],
    ]);
    const requiredServices = ['noona-mongo', 'noona-redis', 'noona-vault'];
    const requiredServiceSet = new Set(requiredServices);

    const dockerFactory = dockerFactoryOption || ((socketReference) => {
        if (socketReference && isTcpDockerSocket(socketReference)) {
            const parsed = parseTcpDockerSocket(socketReference);
            if (!parsed) {
                throw new Error(`Invalid Docker endpoint: ${socketReference}`);
            }

            return new Docker({
                protocol: parsed.protocol,
                host: parsed.host,
                port: parsed.port,
            });
        }

        return new Docker({ socketPath: socketReference });
    });

    const baseSocketCandidates = Array.isArray(hostDockerSocketsOption)
        ? hostDockerSocketsOption
        : dockerSocketDetector({ env, fs: fsModule });

    const normalizedHostDockerSockets = [];

    for (const candidate of baseSocketCandidates) {
        const normalized = normalizeSocketPath(candidate, { allowRemote: true });
        if (normalized) {
            normalizedHostDockerSockets.push(normalized);
        }
    }

    if (typeof env?.DOCKER_HOST === 'string') {
        const normalizedDockerHost = normalizeSocketPath(env.DOCKER_HOST, { allowRemote: true });
        if (normalizedDockerHost) {
            normalizedHostDockerSockets.push(normalizedDockerHost);
        }
    }

    const hostDockerSockets = Array.from(new Set(normalizedHostDockerSockets));

    const initialSocketPath = normalizeSocketPath(
        dockerInstance?.modem?.socketPath || env?.DOCKER_HOST || null,
        { allowRemote: true },
    );

    let activeDockerInstance = dockerInstance;
    let activeDockerContext = {
        client: dockerInstance,
        socketPath: initialSocketPath,
        label: describeSocketReference(initialSocketPath),
    };
    let dockerConnectionVerified = false;

    const describeDockerContext = (context = {}) => {
        if (context.socketPath) {
            return describeSocketReference(context.socketPath);
        }

        if (context.label) {
            return context.label;
        }

        return 'Docker client';
    };

    const buildDockerContexts = () => {
        const contexts = [];
        const visited = new Set();

        const pushContext = (context) => {
            if (!context?.client) {
                return;
            }

            const normalized = context.socketPath
                ? normalizeSocketPath(context.socketPath, { allowRemote: true })
                : null;
            const key = normalized || context.label;
            if (key && visited.has(key)) {
                return;
            }

            contexts.push({
                client: context.client,
                socketPath: normalized,
                label: context.label ?? null,
            });

            if (key) {
                visited.add(key);
            }
        };

        pushContext(activeDockerContext);

        for (const candidate of hostDockerSockets) {
            const normalizedCandidate = normalizeSocketPath(candidate, { allowRemote: true });
            if (!normalizedCandidate || visited.has(normalizedCandidate)) {
                continue;
            }

            const candidateIsPipe = isWindowsPipePath(normalizedCandidate);
            const candidateIsRemote = isTcpDockerSocket(normalizedCandidate);

            if (!candidateIsPipe && !candidateIsRemote && typeof fsModule?.existsSync === 'function') {
                try {
                    if (!fsModule.existsSync(normalizedCandidate)) {
                        continue;
                    }
                } catch {
                    continue;
                }
            }

            if (!candidateIsPipe && !candidateIsRemote && typeof fsModule?.statSync === 'function') {
                try {
                    const stats = fsModule.statSync(normalizedCandidate);
                    if (typeof stats?.isSocket === 'function' && !stats.isSocket()) {
                        continue;
                    }
                } catch {
                    continue;
                }
            }

            try {
                const client = dockerFactory(normalizedCandidate);
                if (client) {
                    pushContext({
                        client,
                        socketPath: normalizedCandidate,
                        label: describeSocketReference(normalizedCandidate),
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn?.(
                    `[${serviceName}] ⚠️ Failed to initialize Docker client for socket ${candidate}: ${message}`,
                );
            }
        }

        return contexts;
    };

    const verifyDockerContext = async (context) => {
        const client = context?.client;
        if (!client) {
            throw new Error('Docker client unavailable');
        }

        if (typeof client.ping === 'function') {
            await client.ping();
            return;
        }

        if (typeof client.version === 'function') {
            await client.version();
            return;
        }

        if (typeof client.listContainers === 'function') {
            await client.listContainers({ limit: 1 });
            return;
        }

        throw new Error('Docker client does not expose ping, version, or listContainers');
    };

    const ensureDockerConnection = async () => {
        if (dockerConnectionVerified && activeDockerInstance) {
            return activeDockerInstance;
        }

        const contexts = buildDockerContexts();
        const errors = [];

        for (const context of contexts) {
            try {
                await verifyDockerContext(context);
                activeDockerInstance = context.client;
                activeDockerContext = {
                    client: context.client,
                    socketPath: context.socketPath ?? null,
                    label: describeDockerContext(context),
                };
                dockerConnectionVerified = true;

                const description = describeDockerContext(context);
                logger.log?.(`[${serviceName}] 🐳 Docker connection established via ${description}.`);
                return activeDockerInstance;
            } catch (error) {
                dockerConnectionVerified = false;
                const message = error instanceof Error ? error.message : String(error);
                const description = describeDockerContext(context);
                logger.warn?.(`[${serviceName}] ⚠️ Docker check failed for ${description}: ${message}`);
                errors.push({ description, message });
            }
        }

        const attempted = contexts.length ? contexts.map(describeDockerContext).join(', ') : 'none';
        const errorDetails = errors.length
            ? ` Errors: ${errors.map(({ description, message }) => `${description}: ${message}`).join('; ')}`
            : '';

        const failure = new Error(
            `Unable to connect to Docker using any configured socket (${attempted}).${errorDetails}`,
        );
        failure.code = 'DOCKER_CONNECTION_FAILED';
        throw failure;
    };

    const markDockerConnectionStale = (error) => {
        if (!error) {
            return;
        }

        const code = error.code || error.errno || null;
        const message = typeof error.message === 'string' ? error.message : '';

        if (code === 'ECONNREFUSED' || code === 'ENOENT' || /ECONNREFUSED|ENOENT/.test(message)) {
            dockerConnectionVerified = false;
        }
    };

    const normalizeContainerName = (rawName) =>
        typeof rawName === 'string' ? rawName.replace(/^\//, '').trim().toLowerCase() : '';

    const isNoonaContainerName = (rawName) => NOONA_CONTAINER_NAME_PATTERN.test(normalizeContainerName(rawName));
    const isWardenContainerName = (rawName) =>
        NOONA_WARDEN_CONTAINER_PATTERN.test(normalizeContainerName(rawName));

    const normalizeImageReference = (value) =>
        typeof value === 'string' ? value.trim().toLowerCase() : '';

    const isNoonaImageReference = (value) => NOONA_IMAGE_PATTERN.test(normalizeImageReference(value));
    const isWardenImageReference = (value) => NOONA_WARDEN_IMAGE_PATTERN.test(normalizeImageReference(value));

    const parseEnvArray = (entries = []) => {
        const out = {};
        for (const entry of entries) {
            if (typeof entry !== 'string') {
                continue;
            }

            const [rawKey, ...rest] = entry.split('=');
            const key = typeof rawKey === 'string' ? rawKey.trim() : '';
            if (!key) {
                continue;
            }

            out[key] = rest.join('=') ?? '';
        }
        return out;
    };

    const isUnsafeDeletionPath = (candidate) => {
        if (typeof candidate !== 'string') {
            return true;
        }

        const trimmed = candidate.trim();
        if (!trimmed) {
            return true;
        }

        if (trimmed === '/' || trimmed === '\\' || trimmed === '.' || trimmed === '..') {
            return true;
        }

        if (/^[A-Za-z]:[\\\\/]*$/.test(trimmed)) {
            return true;
        }

        return false;
    };

    const inspectContainerSafe = async (dockerClient, name) => {
        if (!dockerClient || typeof dockerClient.getContainer !== 'function') {
            return null;
        }

        try {
            return await dockerClient.getContainer(name).inspect();
        } catch (error) {
            const statusCode = Number(error?.statusCode);
            if (statusCode === 404) {
                return null;
            }
            throw error;
        }
    };

    const collectRavenDownloadMounts = async (dockerClient) => {
        const inspection = await inspectContainerSafe(dockerClient, 'noona-raven');
        if (!inspection) {
            return [];
        }

        const envMap = parseEnvArray(inspection?.Config?.Env || []);
        const appData = typeof envMap.APPDATA === 'string' ? envMap.APPDATA.trim() : '';
        const defaultDestinations = new Set(['/kavita-data', '/data', '/app/downloads']);
        if (appData && appData.startsWith('/')) {
            defaultDestinations.add(appData);
        }

        const mounts = Array.isArray(inspection?.Mounts) ? inspection.Mounts : [];
        return mounts
            .map((mount) => ({
                type: typeof mount?.Type === 'string' ? mount.Type.trim().toLowerCase() : '',
                name: typeof mount?.Name === 'string' ? mount.Name.trim() : '',
                source: typeof mount?.Source === 'string' ? mount.Source.trim() : '',
                destination: typeof mount?.Destination === 'string' ? mount.Destination.trim() : '',
            }))
            .filter((mount) => mount.destination && defaultDestinations.has(mount.destination));
    };

    const hasNoonaWorkspaceMarkers = (candidateRoot) => {
        if (typeof fsModule?.existsSync !== 'function') {
            return false;
        }

        try {
            return fsModule.existsSync(path.join(candidateRoot, 'services', 'raven'));
        } catch {
            return false;
        }
    };

    const resolveNoonaWorkspaceRoot = () => {
        const seen = new Set();
        const candidates = [];

        const pushCandidate = (candidate) => {
            const trimmed = normalizePathValue(candidate);
            if (!trimmed) {
                return;
            }

            const normalized = path.normalize(trimmed);
            if (seen.has(normalized)) {
                return;
            }

            seen.add(normalized);
            candidates.push(normalized);
        };

        pushCandidate(env.NOONA_ROOT_DIR);
        pushCandidate(env.NOONA_DATA_DIR);
        pushCandidate(process.cwd());
        pushCandidate(path.resolve(process.cwd(), '..'));
        pushCandidate(path.resolve(process.cwd(), '..', '..'));

        for (const candidate of candidates) {
            if (hasNoonaWorkspaceMarkers(candidate)) {
                return candidate;
            }
        }

        return candidates[0] || path.resolve(process.cwd());
    };

    const defaultRavenHostMountPath = path.join(resolveNoonaWorkspaceRoot(), DEFAULT_RAVEN_DATA_FOLDER_NAME);

    const isLikelyRavenContainerPath = (candidate, appData = '') => {
        const normalizedCandidate = normalizeContainerPath(candidate).toLowerCase();
        if (!normalizedCandidate) {
            return false;
        }

        if (RAVEN_CONTAINER_PATHS.has(normalizedCandidate)) {
            return true;
        }

        const normalizedAppData = normalizeContainerPath(appData).toLowerCase();
        if (normalizedAppData && normalizedCandidate === normalizedAppData && normalizedCandidate.startsWith('/')) {
            return true;
        }

        return false;
    };

    const resolveRavenHostMountFromEnv = (envMap = {}, options = {}) => {
        const appData = normalizePathValue(envMap?.APPDATA);
        const rawMount = normalizePathValue(envMap?.KAVITA_DATA_MOUNT);

        if (rawMount && !isLikelyRavenContainerPath(rawMount, appData)) {
            return toAbsoluteHostPath(rawMount, options);
        }

        if (appData && !isLikelyRavenContainerPath(appData, appData)) {
            return toAbsoluteHostPath(appData, options);
        }

        return null;
    };

    const resolveRavenHostMountFromInstallOverrides = (installOverridesByName) => {
        if (!(installOverridesByName instanceof Map)) {
            return null;
        }

        const ravenOverrides = installOverridesByName.get('noona-raven');
        if (!ravenOverrides || typeof ravenOverrides !== 'object') {
            return null;
        }

        return resolveRavenHostMountFromEnv(ravenOverrides, {cwd: process.cwd()});
    };

    const resolveVaultDataFolderName = (installOverridesByName) => {
        if (installOverridesByName instanceof Map) {
            const installVaultEnv = installOverridesByName.get('noona-vault');
            if (installVaultEnv && typeof installVaultEnv === 'object') {
                const fromInstall = normalizePathValue(installVaultEnv.VAULT_DATA_FOLDER);
                if (fromInstall) {
                    return normalizeVaultFolderName(fromInstall);
                }
            }
        }

        const runtimeVaultEnv = resolveRuntimeConfig('noona-vault').env;
        const fromRuntime = normalizePathValue(runtimeVaultEnv?.VAULT_DATA_FOLDER);
        if (fromRuntime) {
            return normalizeVaultFolderName(fromRuntime);
        }

        const fromProcessEnv = normalizePathValue(env.VAULT_DATA_FOLDER);
        return normalizeVaultFolderName(fromProcessEnv || DEFAULT_VAULT_DATA_FOLDER_NAME);
    };

    const resolveExplicitVaultHostMountPath = ({envKey, installOverridesByName} = {}) => {
        if (!envKey) {
            return null;
        }

        if (installOverridesByName instanceof Map) {
            const installVaultEnv = installOverridesByName.get('noona-vault');
            if (installVaultEnv && typeof installVaultEnv === 'object') {
                const fromInstall = normalizePathValue(installVaultEnv[envKey]);
                if (fromInstall) {
                    return toAbsoluteHostPath(fromInstall, {cwd: process.cwd()});
                }
            }
        }

        const runtimeVaultEnv = resolveRuntimeConfig('noona-vault').env;
        const fromRuntime = normalizePathValue(runtimeVaultEnv?.[envKey]);
        if (fromRuntime) {
            return toAbsoluteHostPath(fromRuntime, {cwd: process.cwd()});
        }

        return null;
    };

    const resolveRavenHostMountForVaultData = async (dockerClient, installOverridesByName) => {
        const fromInstall = resolveRavenHostMountFromInstallOverrides(installOverridesByName);
        if (fromInstall) {
            return fromInstall;
        }

        const runtimeRavenEnv = resolveRuntimeConfig('noona-raven').env;
        const fromRuntime = resolveRavenHostMountFromEnv(runtimeRavenEnv, {cwd: process.cwd()});
        if (fromRuntime) {
            return fromRuntime;
        }

        const mounts = await collectRavenDownloadMounts(dockerClient);
        const bindMount = mounts.find((mount) => mount?.type === 'bind' && mount?.source);
        if (bindMount?.source && !isLikelyNamedDockerVolume(bindMount.source)) {
            const fromContainer = toAbsoluteHostPath(bindMount.source, {cwd: process.cwd()});
            if (fromContainer) {
                return fromContainer;
            }
        }

        return path.normalize(defaultRavenHostMountPath);
    };

    const applyVaultDataMountForService = async (service, {dockerClient, installOverridesByName} = {}) => {
        if (!service?.name) {
            return service;
        }

        const mountSpecByService = {
            'noona-redis': {
                destination: '/data',
                subdir: 'redis',
                vaultMountEnvKey: VAULT_REDIS_HOST_MOUNT_PATH_KEY,
            },
            'noona-mongo': {
                destination: '/data/db',
                subdir: 'mongo',
                vaultMountEnvKey: VAULT_MONGO_HOST_MOUNT_PATH_KEY,
            },
        };

        const mountSpec = mountSpecByService[service.name];
        if (!mountSpec) {
            return service;
        }

        const folderName = resolveVaultDataFolderName(installOverridesByName);
        const explicitHostMount = resolveExplicitVaultHostMountPath({
            envKey: mountSpec.vaultMountEnvKey,
            installOverridesByName,
        });
        let hostMount = explicitHostMount;
        if (!hostMount) {
            const ravenHostMount = await resolveRavenHostMountForVaultData(dockerClient, installOverridesByName);
            const noonaRoot = path.dirname(ravenHostMount);
            const vaultRoot = path.join(noonaRoot, folderName);
            hostMount = path.join(vaultRoot, mountSpec.subdir);
        }

        const bind = `${hostMount}:${mountSpec.destination}`;

        return {
            ...service,
            env: upsertEnvEntry(service.env, 'VAULT_DATA_FOLDER', folderName),
            volumes: upsertBindMount(service.volumes, mountSpec.destination, bind),
        };
    };

    const wipePathWithFs = async (targetPath) => {
        if (isUnsafeDeletionPath(targetPath)) {
            return {
                deleted: false,
                path: targetPath,
                reason: 'unsafe-path',
            };
        }

        const rmFn = fsModule?.promises?.rm;
        if (typeof rmFn !== 'function') {
            return {
                deleted: false,
                path: targetPath,
                reason: 'fs-rm-unavailable',
            };
        }

        try {
            await rmFn(targetPath, {recursive: true, force: true});
            return {deleted: true, path: targetPath, via: 'fs'};
        } catch (error) {
            return {
                deleted: false,
                path: targetPath,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    };

    const wipePathWithHelperContainer = async (dockerClient, sourcePath) => {
        if (isUnsafeDeletionPath(sourcePath)) {
            return {
                deleted: false,
                path: sourcePath,
                reason: 'unsafe-path',
            };
        }

        const helperImage = 'busybox:1.36';
        const helperName = `noona-factory-reset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

        try {
            await dockerUtils.pullImageIfNeeded?.(helperImage, {dockerInstance: dockerClient});
        } catch {
            // Continue without forcing an image pull; createContainer may still work if image exists locally.
        }

        let helperContainer = null;
        try {
            helperContainer = await dockerClient.createContainer({
                name: helperName,
                Image: helperImage,
                Cmd: ['sh', '-lc', 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} +'],
                HostConfig: {
                    AutoRemove: true,
                    Binds: [`${sourcePath}:/target`],
                },
            });

            await helperContainer.start();
            await helperContainer.wait();
            return {deleted: true, path: sourcePath, via: 'helper-container'};
        } catch (error) {
            return {
                deleted: false,
                path: sourcePath,
                reason: error instanceof Error ? error.message : String(error),
            };
        } finally {
            try {
                if (helperContainer) {
                    await helperContainer.remove({force: true});
                }
            } catch {
                // ignore cleanup errors
            }
        }
    };

    const deleteRavenDownloads = async (dockerClient, mounts = []) => {
        const entries = [];

        for (const mount of mounts) {
            if (mount?.type === 'volume' && mount.name) {
                try {
                    await dockerClient.getVolume(mount.name).remove({force: true});
                    entries.push({
                        target: mount.name,
                        destination: mount.destination,
                        type: 'volume',
                        deleted: true,
                        via: 'docker-volume-remove',
                    });
                } catch (error) {
                    entries.push({
                        target: mount.name,
                        destination: mount.destination,
                        type: 'volume',
                        deleted: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                continue;
            }

            if (mount?.type === 'bind' && mount.source) {
                let result = await wipePathWithFs(mount.source);
                if (!result.deleted) {
                    result = await wipePathWithHelperContainer(dockerClient, mount.source);
                }

                entries.push({
                    target: mount.source,
                    destination: mount.destination,
                    type: 'bind',
                    ...result,
                });
            }
        }

        return {
            requested: true,
            mountCount: mounts.length,
            entries,
            deleted: entries.every((entry) => entry.deleted === true),
        };
    };

    const removeNoonaDockerArtifacts = async (dockerClient) => {
        const removedContainers = [];
        const removedImages = [];
        const containerErrors = [];
        const imageErrors = [];

        try {
            const containers = await dockerClient.listContainers({all: true});
            for (const container of containers) {
                const names = Array.isArray(container?.Names) ? container.Names : [];
                const matchesNoona = names.some((name) => isNoonaContainerName(name));
                const isWarden = names.some((name) => isWardenContainerName(name));
                if (!matchesNoona || isWarden) {
                    continue;
                }

                try {
                    await dockerClient.getContainer(container.Id).remove({force: true});
                    removedContainers.push(container.Id);
                } catch (error) {
                    containerErrors.push({
                        id: container.Id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        } catch (error) {
            containerErrors.push({
                id: null,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        try {
            const images = await dockerClient.listImages({all: true});
            for (const image of images) {
                const tags = Array.isArray(image?.RepoTags) ? image.RepoTags : [];
                const digests = Array.isArray(image?.RepoDigests) ? image.RepoDigests : [];
                const references = [...tags, ...digests];
                const hasNoonaReference = references.some((ref) => isNoonaImageReference(ref));
                const hasWardenReference = references.some((ref) => isWardenImageReference(ref));

                if (!hasNoonaReference || hasWardenReference) {
                    continue;
                }

                try {
                    await dockerClient.getImage(image.Id).remove({force: true});
                    removedImages.push(image.Id);
                } catch (error) {
                    imageErrors.push({
                        id: image.Id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        } catch (error) {
            imageErrors.push({
                id: null,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return {
            requested: true,
            containersRemoved: removedContainers,
            imagesRemoved: removedImages,
            containerErrors,
            imageErrors,
        };
    };

    const resolvedLogLimit = (() => {
        if (typeof logLimitOption === 'number' && Number.isFinite(logLimitOption) && logLimitOption > 0) {
            return Math.floor(logLimitOption);
        }

        const parsed = Number.parseInt(logLimitOption, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }

        return 500;
    })();

    const LOG_ENTRY_LIMIT = resolvedLogLimit;
    const INSTALLATION_SERVICE = 'installation';

    const serviceHistories = new Map();
    const installationOrder = [];
    const installationStatuses = new Map();
    let wizardStateClient = wizardStateOption.client || null;
    let wizardStatePublisher = wizardStateOption.publisher || null;

    if (!wizardStateClient) {
        const wizardEnv = wizardStateOption.env ?? env;
        const token =
            wizardStateOption.token ??
            wizardEnv?.VAULT_API_TOKEN ??
            wizardEnv?.VAULT_ACCESS_TOKEN ??
            null;

        if (token) {
            const baseCandidates = [];
            if (wizardStateOption.baseUrl) {
                baseCandidates.push(wizardStateOption.baseUrl);
            }
            if (Array.isArray(wizardStateOption.baseUrls)) {
                baseCandidates.push(...wizardStateOption.baseUrls);
            }

            try {
                wizardStateClient = createWizardStateClient({
                    baseUrl: baseCandidates[0],
                    baseUrls: baseCandidates.slice(1),
                    token,
                    fetchImpl: wizardStateOption.fetchImpl ?? wizardStateOption.fetch ?? fetchImpl,
                    env: wizardEnv,
                    logger,
                    serviceName,
                    redisKey: wizardStateOption.redisKey,
                    timeoutMs: wizardStateOption.timeoutMs,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn?.(`[${serviceName}] ⚠️ Wizard state client initialization failed: ${message}`);
            }
        }
    }

    if (!wizardStatePublisher && wizardStateClient) {
        try {
            wizardStatePublisher = createWizardStatePublisher({
                client: wizardStateClient,
                logger,
                stepServices: wizardStateOption.stepServices,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] ⚠️ Wizard state publisher initialization failed: ${message}`);
            wizardStatePublisher = null;
        }
    }

    const invokeWizard = (method, ...args) => {
        const handler = wizardStatePublisher?.[method];
        if (typeof handler !== 'function') {
            return;
        }

        Promise.resolve(handler(...args)).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] ⚠️ Wizard state ${method} failed: ${message}`);
        });
    };

    const parsePositiveLimit = (candidate) => {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            return Math.floor(candidate);
        }

        if (typeof candidate === 'string') {
            const parsed = Number.parseInt(candidate, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return null;
    };

    const cloneMeta = (meta) => {
        if (meta == null) {
            return null;
        }

        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(meta);
            }
        } catch {
            // Fallback to manual cloning when structuredClone is unavailable or fails.
        }

        if (Array.isArray(meta)) {
            return meta.map((value) => (value && typeof value === 'object' ? cloneMeta(value) : value));
        }

        if (typeof meta === 'object') {
            const cloned = {};
            for (const [key, value] of Object.entries(meta)) {
                cloned[key] = value && typeof value === 'object' ? cloneMeta(value) : value;
            }
            return cloned;
        }

        return meta;
    };

    const ensureHistory = (name) => {
        if (!name) {
            return {
                service: null,
                entries: [],
                summary: {
                    status: 'idle',
                    percent: null,
                    detail: null,
                    updatedAt: null,
                },
            };
        }

        if (!serviceHistories.has(name)) {
            serviceHistories.set(name, {
                service: name,
                entries: [],
                summary: {
                    status: 'idle',
                    percent: null,
                    detail: null,
                    updatedAt: null,
                },
            });
        }

        return serviceHistories.get(name);
    };

    ensureHistory(INSTALLATION_SERVICE);

    const refreshInstallationSummary = () => {
        const summary = (() => {
            const items = installationOrder
                .map((name) => installationStatuses.get(name))
                .filter(Boolean)
                .map((entry) => ({ ...entry }));

            const total = items.length;
            const completed = items.filter((item) => item.status === 'installed').length;
            const hasError = items.some((item) => item.status === 'error');

            const percent = total > 0 ? Math.round((completed / total) * 100) : null;
            const status = hasError
                ? 'error'
                : completed === total && total > 0
                    ? 'complete'
                    : total > 0
                        ? 'installing'
                        : 'idle';

            return { items, percent, status };
        })();

        const history = ensureHistory(INSTALLATION_SERVICE);
        history.summary = {
            status: summary.status,
            percent: summary.percent,
            detail: history.summary?.detail ?? null,
            updatedAt: new Date().toISOString(),
        };

        return summary;
    };

    const resetInstallationTracking = (names = []) => {
        installationOrder.length = 0;
        installationStatuses.clear();

        for (const name of names) {
            if (!name || installationOrder.includes(name)) {
                continue;
            }

            installationOrder.push(name);
            installationStatuses.set(name, {
                name,
                label: name,
                status: 'pending',
                detail: null,
                updatedAt: null,
            });
        }

        if (names.length > 0) {
            const message = `Preparing installation for: ${names.join(', ')}`;
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'status',
                    status: 'pending',
                    message,
                    detail: null,
                    clearError: true,
                },
                { mirrorToInstallation: false },
            );
        }

        refreshInstallationSummary();
        invokeWizard('reset', Array.from(installationOrder));
    };

    const updateInstallationStatus = (name, status, extra = {}) => {
        if (!name) {
            return;
        }

        if (!installationStatuses.has(name)) {
            installationOrder.push(name);
        }

        const previous = installationStatuses.get(name) || {
            name,
            label: name,
            status: 'pending',
            detail: null,
            percent: null,
            updatedAt: null,
        };

        installationStatuses.set(name, {
            ...previous,
            ...extra,
            name,
            status,
            updatedAt: new Date().toISOString(),
        });

        refreshInstallationSummary();
    };

    const INSTALLATION_STATUS_RANK = Object.freeze({
        pending: 0,
        downloading: 1,
        installing: 2,
        installed: 3,
    });

    const resolveInstallationStatusRank = (status) => {
        if (!status || typeof status !== 'string') {
            return null;
        }

        return INSTALLATION_STATUS_RANK[status] ?? null;
    };

    const mapStatusForInstallation = (status) => {
        if (!status || typeof status !== 'string') {
            return null;
        }

        const normalized = status.trim().toLowerCase();

        if (
            [
                'installed',
                'ready',
                'healthy',
                'running',
            ].includes(normalized)
        ) {
            return 'installed';
        }

        if (['error', 'failed', 'failure'].includes(normalized)) {
            return 'error';
        }

        if (['pending', 'idle', 'detecting', 'not-found', 'configured', 'detected'].includes(normalized)) {
            return 'pending';
        }

        // Docker pull / download phases
        if (
            [
                'pulling',
                'pulling fs layer',
                'downloading',
                'verifying checksum',
                'waiting',
                'download complete',
                'pull complete',
            ].includes(normalized)
        ) {
            return 'downloading';
        }

        // Docker extraction transitions from download -> install preparation.
        if (['extracting', 'already-present', 'already exists', 'complete'].includes(normalized)) {
            return 'installing';
        }

        if (
            [
                'installing',
                'starting',
                'started',
                'recreating',
                'exists',
                'health-check',
                'waiting for health check',
                'launching',
                'launched',
            ].includes(normalized)
        ) {
            return 'installing';
        }

        return null;
    };

    const normalizeInstallationDetail = (normalized) => {
        if (!normalized || typeof normalized !== 'object') {
            return null;
        }

        const rawDetail = typeof normalized.detail === 'string' ? normalized.detail.trim() : '';
        const rawMessage = typeof normalized.message === 'string' ? normalized.message.trim() : '';

        let detail = rawDetail || rawMessage || '';

        // Docker pull progress can emit bare numbers (current bytes without total). Prefer the richer message in those cases.
        if (rawMessage && (!rawDetail || /^\d+(?:\/\d+)?$/.test(rawDetail))) {
            detail = rawMessage;
        }

        if (!detail) {
            return null;
        }

        const hostServiceMatch = detail.match(/^host_service_url:\s*(.+)$/i);
        if (hostServiceMatch) {
            const url = hostServiceMatch[1]?.trim();
            detail = url ? `URL: ${url}` : 'URL ready';
        }

        // Strip docker layer/image identifiers like "[4f4fb700ef54] ".
        detail = detail.replace(/^\[[^\]]+\]\s*/, '').trim();

        // Drop trailing bare numbers like "Downloading 3".
        if (/\s\d+$/.test(detail) && !/\d+\/\d+/.test(detail)) {
            detail = detail.replace(/\s\d+$/, '').trim();
        }

        // If we still only have numbers, skip showing it in the install progress readout.
        if (!detail || /^\d+(?:\/\d+)?$/.test(detail)) {
            return null;
        }

        return detail;
    };

    const appendHistoryEntry = (name, entry = {}, { mirrorToInstallation = true } = {}) => {
        if (!name) {
            return;
        }

        const history = ensureHistory(name);
        const timestamp = entry.timestamp ?? new Date().toISOString();
        const normalized = {
            type: entry.type ?? 'log',
            message: entry.message != null ? String(entry.message) : '',
            status: entry.status ?? null,
            detail: entry.detail ?? null,
            stream: entry.stream ?? null,
            level: entry.level ?? null,
            timestamp,
        };

        if (entry.error) {
            normalized.error = entry.error;
        }

        if (entry.percent != null) {
            normalized.percent = entry.percent;
        }

        if (entry.meta && typeof entry.meta === 'object') {
            const clonedMeta = cloneMeta(entry.meta);
            if (clonedMeta && Object.keys(clonedMeta).length > 0) {
                normalized.meta = clonedMeta;
            }
        }

        history.entries.push(normalized);
        if (history.entries.length > LOG_ENTRY_LIMIT) {
            history.entries.splice(0, history.entries.length - LOG_ENTRY_LIMIT);
        }

        const summary = history.summary ?? {
            status: 'idle',
            percent: null,
            detail: null,
            updatedAt: null,
        };

        if (['status', 'progress', 'error'].includes(normalized.type) && normalized.status) {
            summary.status = normalized.status;
        }

        if (normalized.type === 'error' && normalized.error) {
            summary.error = normalized.error;
        } else if (normalized.type === 'status' && entry.clearError) {
            delete summary.error;
        }

        if (normalized.detail) {
            summary.detail = normalized.detail;
        }

        if (entry.percent != null) {
            summary.percent = entry.percent;
        }

        summary.updatedAt = timestamp;
        history.summary = summary;

        if (
            mirrorToInstallation &&
            name !== INSTALLATION_SERVICE &&
            ['status', 'progress', 'error'].includes(normalized.type)
        ) {
            const mirroredEntry = {
                ...entry,
                type: normalized.type,
                status: normalized.status,
                detail: normalized.detail,
                error: normalized.error,
                message: `[${name}] ${normalized.message || normalized.status || ''}`.trim(),
            };

            if (normalized.meta) {
                mirroredEntry.meta = cloneMeta(normalized.meta);
            } else if (mirroredEntry.meta !== undefined) {
                delete mirroredEntry.meta;
            }

            appendHistoryEntry(
                INSTALLATION_SERVICE,
                mirroredEntry,
                { mirrorToInstallation: false },
            );
        }

        if (name !== INSTALLATION_SERVICE) {
            const mappedStatus = mapStatusForInstallation(normalized.status);
            if (mappedStatus) {
                const detail = normalizeInstallationDetail(normalized);
                const previous = installationStatuses.get(name);

                if (
                    !previous ||
                    previous.status !== 'error' ||
                    mappedStatus === 'error'
                ) {
                    const previousRank = resolveInstallationStatusRank(previous?.status);
                    const nextRank = resolveInstallationStatusRank(mappedStatus);
                    const isRegression =
                        previousRank != null &&
                        nextRank != null &&
                        nextRank < previousRank;

                    const isInstalled = previous?.status === 'installed';
                    const shouldUpdate =
                        mappedStatus === 'error' ||
                        !isInstalled ||
                        mappedStatus === 'installed';

                    if (shouldUpdate && !isRegression) {
                        updateInstallationStatus(name, mappedStatus, {
                            label: name,
                            detail,
                        });
                    }
                }

                invokeWizard('trackServiceStatus', name, mappedStatus, normalized);
            }
        }
    };

    const recordContainerOutput = (serviceName, raw, context = {}) => {
        if (!serviceName || !raw) {
            return;
        }

        const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = normalized.split('\n');

        for (const part of parts) {
            const trimmed = part.replace(/\u0000/g, '').trim();
            if (!trimmed) {
                continue;
            }

            appendHistoryEntry(
                serviceName,
                {
                    type: 'log',
                    message: trimmed,
                    stream: context.level === 'error' ? 'stderr' : 'stdout',
                    level: context.level ?? 'info',
                },
                { mirrorToInstallation: false },
            );
        }
    };

    const getInstallationProgressSnapshot = () => {
        const summary = refreshInstallationSummary();
        return {
            items: summary.items.map((entry) => ({
                name: entry.name,
                label: entry.label ?? entry.name,
                status: entry.status,
                detail: entry.detail ?? null,
                updatedAt: entry.updatedAt ?? null,
            })),
            percent: summary.percent,
            status: summary.status,
        };
    };

    async function detectKavitaDataMount() {
        try {
            const contexts = buildDockerContexts();
            let foundContainer = false;

            for (const context of contexts) {
                const client = context?.client;
                if (!client) {
                    continue;
                }

                const contextLabel = describeDockerContext(context);

                try {
                    const containers = await client.listContainers({ all: true });
                    const kavitaContainer = containers.find((container) => {
                        const image = typeof container?.Image === 'string' ? container.Image.toLowerCase() : '';
                        if (image.includes('kavita')) {
                            return true;
                        }

                        const names = Array.isArray(container?.Names) ? container.Names : [];
                        return names.some((name) => typeof name === 'string' && name.toLowerCase().includes('kavita'));
                    });

                    if (!kavitaContainer) {
                        continue;
                    }

                    foundContainer = true;

                    const inspected = await client.getContainer(kavitaContainer.Id).inspect();
                    const mounts = inspected?.Mounts || [];
                    const dataMount = mounts.find((mount) => mount?.Destination === '/data');

                    if (dataMount?.Source) {
                        const rawName = Array.isArray(kavitaContainer?.Names)
                            ? kavitaContainer.Names.find(Boolean)
                            : inspected?.Name;
                        const cleanName = typeof rawName === 'string' ? rawName.replace(/^\//, '') : null;

                        const details = [];

                        if (contextLabel) {
                            details.push(contextLabel);
                        }

                        if (cleanName) {
                            details.push(`container ${cleanName}`);
                        }

                        const suffix = details.length ? ` (${details.join(', ')})` : '';

                        logger.log?.(`[${serviceName}] Kavita data mount detected at ${dataMount.Source}${suffix}.`);

                        return {
                            mountPath: dataMount.Source,
                            socketPath: context.socketPath ?? null,
                            containerId: kavitaContainer.Id ?? null,
                            containerName: cleanName ?? null,
                        };
                    }

                    logger.warn?.(
                        `[${serviceName}] Kavita container found on ${contextLabel} but /data mount was not detected.`,
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.warn?.(`[${serviceName}] ⚠️ Failed to inspect Docker via ${contextLabel}: ${message}`);
                }
            }

            if (!foundContainer) {
                logger.warn?.(`[${serviceName}] Kavita container not found while detecting data mount.`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] ⚠️ Failed to detect Kavita data mount: ${message}`);
        }

        return null;
    }

    const normalizeEnvOverrideMap = (overrides) => {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
            return {};
        }

        const normalized = {};
        for (const [rawKey, rawValue] of Object.entries(overrides)) {
            if (typeof rawKey !== 'string') {
                continue;
            }

            const key = rawKey.trim();
            if (!key) {
                continue;
            }

            normalized[key] = rawValue == null ? '' : String(rawValue);
        }

        return normalized;
    };

    const listRegisteredServiceNames = () =>
        Array.from(serviceCatalog.keys()).sort((left, right) => left.localeCompare(right));

    const resolveRuntimeConfig = (name) => {
        const current = serviceRuntimeConfig.get(name);
        if (!current || typeof current !== 'object') {
            return {env: {}, hostPort: null};
        }

        return {
            env: normalizeEnvOverrideMap(current.env),
            hostPort: normalizeHostPort(current.hostPort),
        };
    };

    const writeRuntimeConfig = (name, next = {}) => {
        const envOverrides = normalizeEnvOverrideMap(next.env);
        const hostPort = normalizeHostPort(next.hostPort);

        if (Object.keys(envOverrides).length === 0 && hostPort == null) {
            serviceRuntimeConfig.delete(name);
            return {env: {}, hostPort: null};
        }

        const snapshot = {
            env: envOverrides,
            hostPort,
        };

        serviceRuntimeConfig.set(name, snapshot);
        return snapshot;
    };

    const applyMoonWebGuiPort = (descriptor) => {
        if (!descriptor || descriptor.name !== 'noona-moon') {
            return descriptor;
        }

        const envMap = parseEnvEntries(descriptor.env);
        const webGuiPort = normalizeHostPort(envMap.WEBGUI_PORT);
        if (webGuiPort == null) {
            return descriptor;
        }

        return {
            ...descriptor,
            port: webGuiPort,
            internalPort: webGuiPort,
            hostServiceUrl: `${hostServiceBase}:${webGuiPort}`,
            health: `http://noona-moon:${webGuiPort}/`,
            exposed: {[`${webGuiPort}/tcp`]: {}},
            ports: {[`${webGuiPort}/tcp`]: [{HostPort: String(webGuiPort)}]},
        };
    };

    const buildEffectiveServiceDescriptor = (name, {envOverrides = null} = {}) => {
        const entry = serviceCatalog.get(name);
        if (!entry) {
            throw new Error(`Service ${name} is not registered with Warden.`);
        }

        const baseDescriptor = cloneServiceDescriptor(entry.descriptor);
        const runtime = resolveRuntimeConfig(name);
        const mergedOverrides = {
            ...runtime.env,
            ...normalizeEnvOverrideMap(envOverrides),
        };

        let descriptor = applyEnvOverrides(baseDescriptor, mergedOverrides);
        descriptor = applyMoonWebGuiPort(descriptor);
        const internalPort = descriptor.internalPort || descriptor.port || null;
        const hostPort = normalizeHostPort(runtime.hostPort);

        if (hostPort != null) {
            descriptor = {
                ...descriptor,
                port: hostPort,
                hostServiceUrl: `${hostServiceBase}:${hostPort}`,
                exposed: internalPort ? {[`${internalPort}/tcp`]: {}} : {},
                ports:
                    internalPort && hostPort
                        ? {[`${internalPort}/tcp`]: [{HostPort: String(hostPort)}]}
                        : {},
            };
        }

        return {
            entry,
            descriptor,
            envOverrides: mergedOverrides,
            runtime: {
                env: mergedOverrides,
                hostPort,
            },
        };
    };

    const getLocalImageDigests = async (dockerClient, image) => {
        if (!dockerClient || !image) {
            return [];
        }

        try {
            const inspected = await dockerClient.getImage(image).inspect();
            const values = Array.isArray(inspected?.RepoDigests) ? inspected.RepoDigests : [];
            return values
                .map((entry) => {
                    if (typeof entry !== 'string') {
                        return null;
                    }
                    const digest = entry.includes('@') ? entry.split('@')[1] : entry;
                    const trimmed = digest ? digest.trim() : '';
                    return trimmed || null;
                })
                .filter(Boolean);
        } catch (error) {
            const statusCode = Number(error?.statusCode);
            if (statusCode === 404) {
                return [];
            }
            throw error;
        }
    };

    const fetchDockerHubDigest = async (imageReference) => {
        if (!imageReference || imageReference.registry !== 'docker.io') {
            return null;
        }

        const scope = `repository:${imageReference.repository}:pull`;
        const tokenResponse = await fetchImpl(
            `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`,
            {method: 'GET'},
        );

        if (!tokenResponse.ok) {
            throw new Error(`Docker Hub token request failed with status ${tokenResponse.status}`);
        }

        const tokenPayload = await tokenResponse.json().catch(() => ({}));
        const token = typeof tokenPayload?.token === 'string' ? tokenPayload.token.trim() : '';
        if (!token) {
            throw new Error('Docker Hub token response did not include a token.');
        }

        const manifestResponse = await fetchImpl(
            `https://registry-1.docker.io/v2/${imageReference.repository}/manifests/${encodeURIComponent(imageReference.tag)}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: [
                        'application/vnd.docker.distribution.manifest.v2+json',
                        'application/vnd.docker.distribution.manifest.list.v2+json',
                        'application/vnd.oci.image.manifest.v1+json',
                        'application/vnd.oci.image.index.v1+json',
                    ].join(', '),
                },
            },
        );

        if (!manifestResponse.ok) {
            throw new Error(`Docker Hub manifest request failed with status ${manifestResponse.status}`);
        }

        const remoteDigest = manifestResponse.headers.get('docker-content-digest');
        return typeof remoteDigest === 'string' && remoteDigest.trim()
            ? remoteDigest.trim()
            : null;
    };

    const checkServiceUpdate = async (name, {dockerClient = null} = {}) => {
        const entry = serviceCatalog.get(name);
        if (!entry) {
            throw new Error(`Service ${name} is not registered with Warden.`);
        }

        const descriptor = buildEffectiveServiceDescriptor(name).descriptor;
        const image = typeof descriptor.image === 'string' ? descriptor.image.trim() : '';
        if (!image) {
            const snapshot = {
                service: name,
                image: null,
                checkedAt: timestamp(),
                updateAvailable: false,
                remoteDigest: null,
                localDigests: [],
                supported: false,
                error: 'Service image is not configured.',
            };
            serviceUpdateSnapshots.set(name, snapshot);
            return snapshot;
        }

        const resolvedImage = parseImageReference(image);
        if (!resolvedImage || resolvedImage.registry !== 'docker.io') {
            const snapshot = {
                service: name,
                image,
                checkedAt: timestamp(),
                updateAvailable: false,
                remoteDigest: null,
                localDigests: [],
                supported: false,
                error: 'Update check currently supports Docker Hub images only.',
            };
            serviceUpdateSnapshots.set(name, snapshot);
            return snapshot;
        }

        const client = dockerClient || (await ensureDockerConnection());
        const localDigests = await getLocalImageDigests(client, image);
        const remoteDigest = await fetchDockerHubDigest(resolvedImage);
        const updateAvailable = Boolean(remoteDigest) && !localDigests.includes(remoteDigest);

        const snapshot = {
            service: name,
            image,
            checkedAt: timestamp(),
            updateAvailable,
            remoteDigest,
            localDigests,
            supported: true,
            error: null,
        };

        serviceUpdateSnapshots.set(name, snapshot);
        return snapshot;
    };

    const runScheduledServiceUpdateRefresh = () => {
        Promise.resolve(api.refreshServiceUpdates()).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] âšï¸ Scheduled service update check failed: ${message}`);
        });
    };

    const startServiceUpdateTimer = () => {
        if (typeof setIntervalImpl !== 'function' || serviceUpdateTimer) {
            return;
        }

        runScheduledServiceUpdateRefresh();

        serviceUpdateTimer = setIntervalImpl(() => {
            runScheduledServiceUpdateRefresh();
        }, updateCheckIntervalMs);

        if (serviceUpdateTimer && typeof serviceUpdateTimer.unref === 'function') {
            serviceUpdateTimer.unref();
        }
    };

    const stopServiceUpdateTimer = () => {
        if (!serviceUpdateTimer || typeof clearIntervalImpl !== 'function') {
            return;
        }

        clearIntervalImpl(serviceUpdateTimer);
        serviceUpdateTimer = null;
    };

    const api = {
        trackedContainers,
        networkName,
        SUPER_MODE,
        BOOT_MODE,
    };

    Object.defineProperty(api, 'DEBUG', {
        enumerable: true,
        get: () => runtimeDebug,
    });

    api.getDebug = function getDebug() {
        return {
            enabled: isLoggerDebugEnabled(),
            value: runtimeDebug,
        };
    };

    api.setDebug = function setDebug(enabled, options = {}) {
        const nextEnabled = isDebugFlagEnabled(enabled);
        runtimeDebug = nextEnabled ? 'true' : 'false';
        setLoggerDebug(nextEnabled);

        if (options?.persist !== false) {
            const nextDebugValue = runtimeDebug;
            for (const registeredServiceName of listRegisteredServiceNames()) {
                const runtime = resolveRuntimeConfig(registeredServiceName);
                writeRuntimeConfig(registeredServiceName, {
                    env: {
                        ...runtime.env,
                        DEBUG: nextDebugValue,
                    },
                    hostPort: runtime.hostPort,
                });
            }
        }

        return {
            enabled: nextEnabled,
            value: runtimeDebug,
        };
    };

    api.resolveHostServiceUrl = function resolveHostServiceUrl(service) {
        if (!service) {
            return null;
        }

        const runtimeHostPort = normalizeHostPort(
            service?.name ? resolveRuntimeConfig(service.name).hostPort : null,
        );
        if (runtimeHostPort != null) {
            return `${hostServiceBase}:${runtimeHostPort}`;
        }

        if (service.hostServiceUrl) {
            return service.hostServiceUrl;
        }

        if (service.port) {
            return `${hostServiceBase}:${service.port}`;
        }

        return null;
    };

    api.startService = async function startService(service, healthUrl = null, options = {}) {
        if (!service) {
            throw new Error('Service descriptor is required.');
        }

        const serviceName = service.name;
        if (!serviceName) {
            throw new Error('Service descriptor must include a name.');
        }

        appendHistoryEntry(serviceName, {
            type: 'status',
            status: 'pending',
            message: 'Preparing to start service',
            detail: null,
        });

        const dockerClient = await ensureDockerConnection();
        const installOverridesByName = options?.installOverridesByName;
        const effectiveService = await applyVaultDataMountForService(service, {
            dockerClient,
            installOverridesByName,
        });
        const hostServiceUrl = api.resolveHostServiceUrl(effectiveService);
        const recreate = options?.recreate === true;
        let alreadyRunning = false;

        try {
            alreadyRunning = await dockerUtils.containerExists(serviceName, { dockerInstance: dockerClient });
        } catch (error) {
            markDockerConnectionStale(error);
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(serviceName, {
                type: 'error',
                status: 'error',
                message: 'Failed to verify existing container state',
                detail: message,
                error: message,
            });
            throw error;
        }

        if (alreadyRunning && recreate) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'recreating',
                message: 'Recreating container to apply updated configuration',
                detail: null,
            });

            try {
                if (typeof dockerUtils.removeContainers === 'function') {
                    await dockerUtils.removeContainers(serviceName, {dockerInstance: dockerClient});
                } else {
                    await dockerClient.getContainer(serviceName).remove({force: true});
                }
                alreadyRunning = false;
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(serviceName, {
                    type: 'error',
                    status: 'error',
                    message: 'Failed to remove existing container',
                    detail: message,
                    error: message,
                });
                throw error;
            }
        }

        if (!alreadyRunning) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'pulling',
                message: `Checking Docker image ${effectiveService.image}`,
                detail: effectiveService.image,
            });

            try {
                await dockerUtils.pullImageIfNeeded(effectiveService.image, {
                    dockerInstance: dockerClient,
                    onProgress: (event = {}) => {
                        const explicitLayerId =
                            event.layerId != null ? String(event.layerId).trim() : '';
                        const fallbackLayerId = event.id != null ? String(event.id).trim() : '';
                        const layerId = explicitLayerId || fallbackLayerId || null;
                        const phase =
                            typeof event.phase === 'string' && event.phase.trim()
                                ? event.phase.trim()
                                : null;
                        const rawStatus = event.status || phase || 'progress';
                        const status =
                            typeof rawStatus === 'string'
                                ? rawStatus.trim() || 'progress'
                                : String(rawStatus ?? 'progress');
                        const detail = event.detail != null ? String(event.detail).trim() : '';
                        const explicitMessage = typeof event.message === 'string' ? event.message.trim() : '';
                        const message =
                            explicitMessage ||
                            formatDockerProgressMessage({
                                layerId,
                                phase,
                                status,
                                detail,
                            }) ||
                            status;

                        const meta = {};

                        if (layerId) {
                            meta.layerId = layerId;
                        }

                        if (phase) {
                            meta.phase = phase;
                        }

                        if (event.progressDetail && typeof event.progressDetail === 'object') {
                            meta.progressDetail = cloneMeta(event.progressDetail);
                        }

                        if (explicitMessage) {
                            meta.message = explicitMessage;
                        }

                        const metaPayload = Object.keys(meta).length > 0 ? meta : undefined;
                        appendHistoryEntry(serviceName, {
                            type: 'progress',
                            status,
                            message,
                            detail: detail || null,
                            ...(metaPayload ? { meta: metaPayload } : {}),
                        });
                    },
                });
            } catch (error) {
                markDockerConnectionStale(error);
                throw error;
            }

            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'starting',
                message: 'Starting container',
                detail: null,
            });

            try {
                await dockerUtils.runContainerWithLogs(
                    effectiveService,
                    networkName,
                    trackedContainers,
                    runtimeDebug,
                    {
                        dockerInstance: dockerClient,
                        onLog: (raw, context = {}) => {
                            recordContainerOutput(serviceName, raw, context);
                        },
                    },
                );
            } catch (error) {
                markDockerConnectionStale(error);
                throw error;
            }

            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'started',
                message: 'Container start initiated',
                detail: null,
            });
        } else {
            logger.log(`${serviceName} already running.`);
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'running',
                message: 'Container already running',
                detail: 'Container already running',
                clearError: true,
            });
        }

        if (healthUrl) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'health-check',
                message: `Waiting for health check: ${healthUrl}`,
                detail: healthUrl,
            });

            try {
                await dockerUtils.waitForHealthyStatus(serviceName, healthUrl);
                appendHistoryEntry(serviceName, {
                    type: 'status',
                    status: 'healthy',
                    message: 'Health check passed',
                    detail: healthUrl,
                });
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(serviceName, {
                    type: 'error',
                    status: 'error',
                    message: 'Health check failed',
                    detail: message,
                    error: message,
                });
                throw error;
            }
        }

        const readyMessage = hostServiceUrl
            ? `[${serviceName}] ✅ Ready (host_service_url: ${hostServiceUrl})`
            : `[${serviceName}] ✅ Ready.`;

        if (hostServiceUrl) {
            logger.log(readyMessage);
        } else {
            logger.log(readyMessage);
        }

        appendHistoryEntry(serviceName, {
            type: 'status',
            status: 'ready',
            message: 'Service ready',
            detail: hostServiceUrl ? `host_service_url: ${hostServiceUrl}` : null,
            clearError: true,
        });
    };

    api.listServices = async function listServices(options = {}) {
        const { includeInstalled = true } = options;

        const formatted = Array.from(serviceCatalog.values())
            .map(({category, descriptor}) => {
                const effectiveDescriptor = buildEffectiveServiceDescriptor(descriptor.name).descriptor;

                return {
                    name: descriptor.name,
                    category,
                    image: effectiveDescriptor.image,
                    port: effectiveDescriptor.port ?? null,
                    hostServiceUrl: api.resolveHostServiceUrl(effectiveDescriptor),
                    description: effectiveDescriptor.description ?? null,
                    health: effectiveDescriptor.health ?? null,
                    envConfig: cloneEnvConfig(effectiveDescriptor.envConfig),
                    required: requiredServiceSet.has(descriptor.name),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        let dockerClient = null;
        try {
            dockerClient = await ensureDockerConnection();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] ⚠️ Unable to establish Docker connection for listServices: ${message}`);
        }

        const entries = await Promise.all(
            formatted.map(async (service) => {
                let installed = false;

                if (dockerClient) {
                    try {
                        installed = await dockerUtils.containerExists(service.name, { dockerInstance: dockerClient });
                    } catch (error) {
                        markDockerConnectionStale(error);
                        const message = error instanceof Error ? error.message : String(error);
                        logger.warn?.(
                            `[${serviceName}] Failed to determine install status for ${service.name}: ${message}`,
                        );
                    }
                }

                return { ...service, installed };
            }),
        );

        if (includeInstalled) {
            return entries;
        }

        return entries.filter((service) => service.installed !== true);
    };

    const buildInstallationList = (candidates = []) => {
        const invalidEntries = [];
        const seen = new Set();
        const prioritized = [];
        const envOverrides = new Map();

        const register = (name) => {
            if (!seen.has(name)) {
                seen.add(name);
                prioritized.push(name);
            }
        };

        for (const required of requiredServices) {
            register(required);
        }

        for (const candidate of candidates) {
            if (typeof candidate === 'string' || typeof candidate === 'number') {
                const trimmed = String(candidate).trim();

                if (!trimmed) {
                    invalidEntries.push({
                        name: typeof candidate === 'string' ? candidate.trim() : candidate ?? null,
                        status: 'error',
                        error: 'Invalid service name provided.',
                    });
                    continue;
                }

                register(trimmed);
                continue;
            }

            if (!candidate || typeof candidate !== 'object') {
                invalidEntries.push({
                    name: candidate ?? null,
                    status: 'error',
                    error: 'Service entry must be a string name or object descriptor.',
                });
                continue;
            }

            const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : '';

            if (!rawName) {
                invalidEntries.push({
                    name: candidate.name ?? null,
                    status: 'error',
                    error: 'Service descriptor is missing a valid "name" field.',
                });
                continue;
            }

            if (candidate.env != null && (typeof candidate.env !== 'object' || Array.isArray(candidate.env))) {
                invalidEntries.push({
                    name: rawName,
                    status: 'error',
                    error: 'Environment overrides must be provided as an object map.',
                });
                continue;
            }

            register(rawName);

            if (candidate.env) {
                const normalized = {};

                for (const [key, value] of Object.entries(candidate.env)) {
                    if (typeof key !== 'string') {
                        continue;
                    }

                    const trimmedKey = key.trim();
                    if (!trimmedKey) {
                        continue;
                    }

                    normalized[trimmedKey] = value == null ? '' : String(value);
                }

                if (Object.keys(normalized).length > 0) {
                    const existing = envOverrides.get(rawName) || {};
                    envOverrides.set(rawName, { ...existing, ...normalized });
                }
            }
        }

        return { prioritized, invalidEntries, overridesByName: envOverrides };
    };

    const resolveInstallOrder = (names = []) => {
        const order = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (name) => {
            if (visited.has(name)) {
                return;
            }

            if (visiting.has(name)) {
                const chain = [...visiting, name].join(' -> ');
                throw new Error(`Circular dependency detected: ${chain}`);
            }

            visiting.add(name);

            const dependencies = dependencyGraph.get(name) || [];
            for (const dependency of dependencies) {
                visit(dependency);
            }

            visiting.delete(name);
            visited.add(name);
            order.push(name);
        };

        for (const name of names) {
            visit(name);
        }

        return order;
    };

    const installSingleServiceByName = async (name, envOverrides = null, options = {}) => {
        const installOverridesByName =
            options?.installOverridesByName instanceof Map ? options.installOverridesByName : null;
        const {entry, descriptor, envOverrides: combinedOverrides, runtime} = buildEffectiveServiceDescriptor(name, {
            envOverrides,
        });
        const {category} = entry;
        const healthUrl = descriptor.health || null;
        let kavitaDetection = null;
        let kavitaDataMount = null;
        let serviceDescriptor = cloneServiceDescriptor(descriptor);
        let normalizedOverrides = {...combinedOverrides};
        let launchStartedAt = null;
        const upsertEnvValue = (entries, key, value) => {
            const list = Array.isArray(entries) ? [...entries] : [];
            const prefix = `${key}=`;
            const filtered = list.filter((entry) => !(typeof entry === 'string' && entry.startsWith(prefix)));
            filtered.push(`${key}=${value ?? ''}`);
            return filtered;
        };
        const ensureVolumeEntry = (entries, mount) => {
            const list = Array.isArray(entries) ? [...entries] : [];
            if (!list.includes(mount)) {
                list.push(mount);
            }
            return list;
        };

        if (descriptor.name === 'noona-raven') {
            const detectionStartedAt = timestamp();
            const detectionMessage = 'Detecting Kavita data mount…';
            appendHistoryEntry(descriptor.name, {
                type: 'status',
                status: 'detecting',
                message: detectionMessage,
                detail: null,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    detection: {
                        status: 'detecting',
                        message: detectionMessage,
                        mountPath: null,
                        updatedAt: detectionStartedAt,
                    },
                    message: detectionMessage,
                },
                { status: 'in-progress', error: null },
            );

            try {
                kavitaDetection = await detectKavitaDataMount();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: 'error',
                    message: 'Failed to detect Kavita data mount',
                    detail: message,
                    error: message,
                });
                invokeWizard('recordRavenDetail', {
                    detection: {
                        status: 'error',
                        message,
                        mountPath: null,
                        updatedAt: timestamp(),
                    },
                    message,
                }, { status: 'error', error: message });
                throw error;
            }

            kavitaDataMount = kavitaDetection?.mountPath ?? null;

            if (kavitaDataMount) {
                const envWithAppData = upsertEnvValue(serviceDescriptor.env, 'APPDATA', '/kavita-data');
                const envWithKavita = upsertEnvValue(envWithAppData, 'KAVITA_DATA_MOUNT', '/kavita-data');
                const volumes = ensureVolumeEntry(serviceDescriptor.volumes, `${kavitaDataMount}:/kavita-data`);

                serviceDescriptor = {
                    ...serviceDescriptor,
                    env: envWithKavita,
                    volumes,
                };

                const detectedMessage = `Kavita data mount detected at ${kavitaDataMount}`;
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: 'detected',
                    message: detectedMessage,
                    detail: kavitaDataMount,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'detected',
                            message: detectedMessage,
                            mountPath: kavitaDataMount,
                            updatedAt: timestamp(),
                        },
                        message: detectedMessage,
                    },
                    { status: 'in-progress', error: null },
                );
            } else {
                const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');
                const manualAppData = trimValue(normalizedOverrides?.APPDATA);
                const manualMount = trimValue(normalizedOverrides?.KAVITA_DATA_MOUNT);
                const containerPath = manualAppData || (manualMount ? '/kavita-data' : null);
                const hostPath = manualMount || manualAppData || null;

                if (hostPath && containerPath) {
                    const envWithAppData = upsertEnvValue(serviceDescriptor.env, 'APPDATA', containerPath);
                    const envWithMount = upsertEnvValue(envWithAppData, 'KAVITA_DATA_MOUNT', containerPath);
                    const volumes = ensureVolumeEntry(serviceDescriptor.volumes, `${hostPath}:${containerPath}`);

                    serviceDescriptor = {
                        ...serviceDescriptor,
                        env: envWithMount,
                        volumes,
                    };

                    normalizedOverrides = normalizedOverrides ? { ...normalizedOverrides } : {};
                    normalizedOverrides.APPDATA = containerPath;
                    normalizedOverrides.KAVITA_DATA_MOUNT = containerPath;
                    kavitaDataMount = hostPath;
                }

                const manualMessage = kavitaDataMount
                    ? `Configured Kavita mount from overrides at ${kavitaDataMount}`
                    : 'Kavita data mount not detected automatically';
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: kavitaDataMount ? 'configured' : 'installing',
                    message: manualMessage,
                    detail: kavitaDataMount ?? null,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: kavitaDataMount ? 'detected' : 'not-found',
                            message: manualMessage,
                            mountPath: kavitaDataMount ?? null,
                            updatedAt: timestamp(),
                        },
                        message: manualMessage,
                    },
                    { status: 'in-progress', error: null },
                );
            }
        }

        serviceDescriptor = applyEnvOverrides(serviceDescriptor, normalizedOverrides);

        if (descriptor.name === 'noona-raven') {
            launchStartedAt = timestamp();
            invokeWizard(
                'recordRavenDetail',
                {
                    launch: {
                        status: 'launching',
                        startedAt: launchStartedAt,
                        completedAt: null,
                        error: null,
                    },
                    message: 'Requesting Raven installation…',
                },
                { status: 'in-progress', error: null },
            );
        }

        appendHistoryEntry(descriptor.name, {
            type: 'status',
            status: 'pending',
            message: 'Starting installation',
            detail: null,
        });

        try {
            const recreate = normalizedOverrides && Object.keys(normalizedOverrides).length > 0;
            await api.startService(serviceDescriptor, healthUrl, {
                recreate,
                installOverridesByName,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(descriptor.name, {
                type: 'error',
                status: 'error',
                message: 'Installation failed',
                detail: message,
                error: message,
            });
            if (descriptor.name === 'noona-raven') {
                const failureMessage = message;
                invokeWizard(
                    'recordRavenDetail',
                    {
                        launch: {
                            status: 'error',
                            startedAt: launchStartedAt ?? timestamp(),
                            completedAt: null,
                            error: failureMessage,
                        },
                        message: failureMessage,
                    },
                    { status: 'error', error: failureMessage },
                );
            }
            throw error;
        }

        const result = {
            name: descriptor.name,
            category,
            status: 'installed',
            hostServiceUrl: api.resolveHostServiceUrl(serviceDescriptor),
            image: descriptor.image,
            port: serviceDescriptor.port ?? null,
            required: requiredServiceSet.has(descriptor.name),
        };

        writeRuntimeConfig(descriptor.name, {
            env: normalizedOverrides,
            hostPort: runtime.hostPort,
        });

        if (descriptor.name === 'noona-raven') {
            result.kavitaDataMount = kavitaDataMount;
            result.kavitaDetection = kavitaDetection;
            const completedAt = timestamp();
            appendHistoryEntry(descriptor.name, {
                type: 'status',
                status: 'installed',
                message: kavitaDetection
                    ? `Kavita data mount detected at ${kavitaDetection.mountPath}`
                    : 'Kavita data mount not detected automatically',
                detail: kavitaDetection?.mountPath ?? null,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    launch: {
                        status: 'launched',
                        startedAt: launchStartedAt ?? completedAt,
                        completedAt,
                        error: null,
                    },
                    message: 'Raven installation requested.',
                },
                { status: 'in-progress', error: null },
            );
        }

        return result;
    };

    api.installService = async function installService(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();

        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const { prioritized, overridesByName } = buildInstallationList([trimmedName]);
        const order = resolveInstallOrder(prioritized);
        resetInstallationTracking(order);

        if (order.length > 0) {
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'status',
                    status: 'installing',
                    message: `Installing ${order.join(', ')}`,
                    detail: null,
                    clearError: true,
                },
                { mirrorToInstallation: false },
            );
        }
        const attempted = new Set();
        let targetResult = null;

        for (const serviceName of order) {
            if (attempted.has(serviceName)) {
                continue;
            }

            attempted.add(serviceName);
            const overrides = overridesByName.get(serviceName) || null;
            const result = await installSingleServiceByName(serviceName, overrides, {
                installOverridesByName: overridesByName,
            });

            if (serviceName === trimmedName) {
                targetResult = result;
            }
        }

        appendHistoryEntry(
            INSTALLATION_SERVICE,
            {
                type: 'status',
                status: targetResult ? 'complete' : 'error',
                message: targetResult
                    ? `Installation complete for ${trimmedName}`
                    : `Installation failed for ${trimmedName}`,
                detail: targetResult?.status === 'installed' ? 'installed' : null,
            },
            { mirrorToInstallation: false },
        );

        const hasErrors = !targetResult || targetResult.status === 'error';
        invokeWizard('completeInstall', { hasErrors });

        if (!targetResult) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        return targetResult;
    };

    api.installServices = async function installServices(names = []) {
        const { prioritized, invalidEntries, overridesByName } = buildInstallationList(names);
        const results = [];
        let order;

        try {
            order = resolveInstallOrder(prioritized);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'error',
                    status: 'error',
                    message: 'Failed to resolve installation order',
                    detail: message,
                    error: message,
                },
                { mirrorToInstallation: false },
            );
            return [
                ...results,
                ...invalidEntries,
                {
                    name: 'installation',
                    status: 'error',
                    error: message,
                },
            ];
        }

        resetInstallationTracking(order);

        if (order.length > 0) {
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'status',
                    status: 'installing',
                    message: `Installing ${order.join(', ')}`,
                    detail: null,
                    clearError: true,
                },
                { mirrorToInstallation: false },
            );
        }

        const attempted = new Set();

        for (const serviceName of order) {
            if (attempted.has(serviceName)) {
                continue;
            }

            attempted.add(serviceName);

            try {
                const overrides = overridesByName.get(serviceName) || null;
                const result = await installSingleServiceByName(serviceName, overrides, {
                    installOverridesByName: overridesByName,
                });
                results.push(result);
            } catch (error) {
                results.push({
                    name: serviceName,
                    status: 'error',
                    error: error.message,
                });
            }
        }

        const hasErrors = results.some((entry) => entry.status === 'error');
        appendHistoryEntry(
            INSTALLATION_SERVICE,
            {
                type: 'status',
                status: hasErrors ? 'error' : 'complete',
                message: hasErrors
                    ? 'Installation finished with errors'
                    : 'Installation complete',
                detail: hasErrors ? 'One or more services failed to install' : null,
            },
            { mirrorToInstallation: false },
        );

        invokeWizard('completeInstall', { hasErrors });

        return [...results, ...invalidEntries];
    };

    api.getInstallationProgress = function getInstallationProgress() {
        return getInstallationProgressSnapshot();
    };

    api.getServiceHistory = function getServiceHistory(name, options = {}) {
        const serviceName = typeof name === 'string' ? name.trim() : '';

        if (!serviceName) {
            return {
                service: name ?? null,
                entries: [],
                summary: {
                    status: 'idle',
                    percent: null,
                    detail: null,
                    updatedAt: null,
                },
            };
        }

        const history = ensureHistory(serviceName);
        const limit = parsePositiveLimit(options.limit);
        const sliceSource = limit
            ? history.entries.slice(-limit)
            : history.entries.slice();
        const entries = sliceSource.map((entry) => ({ ...entry }));
        const summary = history.summary
            ? { ...history.summary }
            : {
                status: 'idle',
                percent: null,
                detail: null,
                updatedAt: null,
            };

        return {
            service: serviceName,
            entries,
            summary,
        };
    };

    api.getServiceConfig = function getServiceConfig(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const entry = serviceCatalog.get(trimmedName);
        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        const runtime = resolveRuntimeConfig(trimmedName);

        return {
            name: descriptor.name,
            image: descriptor.image ?? null,
            port: descriptor.port ?? null,
            internalPort: descriptor.internalPort ?? descriptor.port ?? null,
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            description: descriptor.description ?? null,
            health: descriptor.health ?? null,
            env: parseEnvEntries(descriptor.env),
            envConfig: cloneEnvConfig(descriptor.envConfig),
            runtimeConfig: {
                hostPort: runtime.hostPort,
                env: runtime.env,
            },
        };
    };

    api.updateServiceConfig = async function updateServiceConfig(name, updates = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        if (!serviceCatalog.has(trimmedName)) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const runtime = resolveRuntimeConfig(trimmedName);
        const nextRuntime = {
            env: {...runtime.env},
            hostPort: runtime.hostPort,
        };

        if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'env')) {
            nextRuntime.env = normalizeEnvOverrideMap(updates?.env);
        }

        if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'hostPort')) {
            const parsedHostPort = normalizeHostPort(updates?.hostPort);
            if (updates?.hostPort != null && parsedHostPort == null) {
                throw new Error('hostPort must be a valid TCP port between 1 and 65535.');
            }
            nextRuntime.hostPort = parsedHostPort;
        }

        writeRuntimeConfig(trimmedName, nextRuntime);

        const restart = updates?.restart === true;
        let restartResult = null;
        if (restart) {
            restartResult = await api.restartService(trimmedName);
        }

        return {
            service: api.getServiceConfig(trimmedName),
            restarted: Boolean(restartResult),
        };
    };

    api.restartService = async function restartService(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        await api.startService(descriptor, descriptor.health || null, {recreate: true});

        return {
            service: trimmedName,
            status: 'restarted',
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
        };
    };

    api.stopService = async function stopService(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const removeContainer = options.remove !== false;
        const dockerClient = await ensureDockerConnection();
        const exists = await dockerUtils.containerExists(trimmedName, {dockerInstance: dockerClient});

        if (!exists) {
            trackedContainers.delete(trimmedName);
            return {
                service: trimmedName,
                stopped: false,
                removed: false,
                reason: 'not-running',
            };
        }

        if (removeContainer && typeof dockerUtils.removeContainers === 'function') {
            await dockerUtils.removeContainers(trimmedName, {dockerInstance: dockerClient});
        } else {
            const container = dockerClient.getContainer(trimmedName);
            try {
                await container.stop();
            } catch (error) {
                const statusCode = Number(error?.statusCode);
                if (statusCode !== 304 && statusCode !== 404) {
                    throw error;
                }
            }

            if (removeContainer) {
                await container.remove({force: true});
            }
        }

        trackedContainers.delete(trimmedName);
        appendHistoryEntry(trimmedName, {
            type: 'status',
            status: 'stopped',
            message: removeContainer ? 'Service stopped and removed.' : 'Service stopped.',
            detail: null,
            clearError: true,
        });

        return {
            service: trimmedName,
            stopped: true,
            removed: removeContainer,
            reason: null,
        };
    };

    api.stopEcosystem = async function stopEcosystem(options = {}) {
        const includeTrackedOnly = options?.trackedOnly === true;
        const onResult = typeof options?.onResult === 'function' ? options.onResult : null;
        const names = includeTrackedOnly
            ? Array.from(trackedContainers)
            : Array.from(new Set([
                ...bootOrder,
                ...listRegisteredServiceNames(),
                ...Array.from(trackedContainers),
            ]));

        const normalizedNames = names
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim());
        const stopOrder = includeTrackedOnly
            ? normalizedNames
            : [...normalizedNames].reverse();

        const results = [];

        for (const service of stopOrder) {
            let result;
            try {
                result = await api.stopService(service, {remove: true});
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                result = {
                    service,
                    stopped: false,
                    removed: false,
                    reason: message,
                    error: message,
                };
            }

            results.push(result);

            if (onResult) {
                await onResult(result);
            }
        }

        return results;
    };

    api.restartEcosystem = async function restartEcosystem(options = {}) {
        const stopResults = await api.stopEcosystem({...options, trackedOnly: false});
        const startResults = await api.startEcosystem(options);

        return {
            stopped: stopResults,
            started: startResults,
        };
    };

    api.factoryResetEcosystem = async function factoryResetEcosystem(options = {}) {
        const deleteRavenDownloadsRequested = options?.deleteRavenDownloads === true;
        const deleteDockersRequested = options?.deleteDockers === true;
        const dockerClient = await ensureDockerConnection();

        let ravenMounts = [];
        if (deleteRavenDownloadsRequested) {
            try {
                ravenMounts = await collectRavenDownloadMounts(dockerClient);
            } catch (error) {
                logger.warn?.(
                    `[${serviceName}] Failed to inspect Raven mounts during factory reset: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        const stopped = await api.stopEcosystem({
            trackedOnly: false,
        });

        const ravenDownloads = deleteRavenDownloadsRequested
            ? await deleteRavenDownloads(dockerClient, ravenMounts)
            : {
                requested: false,
                mountCount: 0,
                entries: [],
                deleted: false,
            };

        const dockerCleanup = deleteDockersRequested
            ? await removeNoonaDockerArtifacts(dockerClient)
            : {
                requested: false,
                containersRemoved: [],
                imagesRemoved: [],
                containerErrors: [],
                imageErrors: [],
            };

        const started = await api.startEcosystem({
            setupCompleted: false,
            forceFull: false,
        });

        return {
            ok: true,
            stopped,
            ravenDownloads,
            dockerCleanup,
            started,
        };
    };

    api.isSetupCompleted = async function isSetupCompleted() {
        if (!wizardStateClient || typeof wizardStateClient.loadState !== 'function') {
            return false;
        }

        try {
            const state = await wizardStateClient.loadState({fallbackToDefault: false});
            return state?.completed === true;
        } catch {
            return false;
        }
    };

    api.refreshServiceUpdates = async function refreshServiceUpdates(options = {}) {
        const requestedServices = Array.isArray(options?.services)
            ? options.services
            : listRegisteredServiceNames();

        let dockerClient = null;
        try {
            dockerClient = await ensureDockerConnection();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] âš ï¸ Unable to connect to Docker for update check: ${message}`);
        }

        const results = [];
        for (const candidate of requestedServices) {
            const name = typeof candidate === 'string' ? candidate.trim() : '';
            if (!name) {
                continue;
            }

            if (!serviceCatalog.has(name)) {
                results.push({
                    service: name,
                    checkedAt: timestamp(),
                    supported: false,
                    updateAvailable: false,
                    error: 'Service is not registered with Warden.',
                });
                continue;
            }

            try {
                const snapshot = await checkServiceUpdate(name, {dockerClient});
                results.push(snapshot);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const snapshot = {
                    service: name,
                    image: buildEffectiveServiceDescriptor(name).descriptor.image ?? null,
                    checkedAt: timestamp(),
                    updateAvailable: false,
                    remoteDigest: null,
                    localDigests: [],
                    supported: true,
                    error: message,
                };
                serviceUpdateSnapshots.set(name, snapshot);
                results.push(snapshot);
            }
        }

        return results;
    };

    api.listServiceUpdates = function listServiceUpdates() {
        const snapshots = [];
        for (const name of listRegisteredServiceNames()) {
            const current = serviceUpdateSnapshots.get(name);
            if (current) {
                snapshots.push({...current});
            } else {
                snapshots.push({
                    service: name,
                    image: buildEffectiveServiceDescriptor(name).descriptor.image ?? null,
                    checkedAt: null,
                    updateAvailable: false,
                    remoteDigest: null,
                    localDigests: [],
                    supported: true,
                    error: null,
                });
            }
        }

        return snapshots;
    };

    api.updateServiceImage = async function updateServiceImage(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        const image = typeof descriptor.image === 'string' ? descriptor.image.trim() : '';
        if (!image) {
            throw new Error(`Service ${trimmedName} does not define an image.`);
        }

        const dockerClient = await ensureDockerConnection();
        const getImageId = async () => {
            try {
                const inspected = await dockerClient.getImage(image).inspect();
                return typeof inspected?.Id === 'string' ? inspected.Id : null;
            } catch (error) {
                const statusCode = Number(error?.statusCode);
                if (statusCode === 404) {
                    return null;
                }
                throw error;
            }
        };

        const beforeImageId = await getImageId();
        await new Promise((resolve, reject) => {
            dockerClient.pull(image, (error, stream) => {
                if (error) {
                    reject(error);
                    return;
                }

                dockerClient.modem.followProgress(stream, (progressError) => {
                    if (progressError) {
                        reject(progressError);
                        return;
                    }
                    resolve();
                });
            });
        });
        const afterImageId = await getImageId();

        const restart = options?.restart !== false;
        let restarted = false;
        if (restart) {
            await api.restartService(trimmedName);
            restarted = true;
        }

        await api.refreshServiceUpdates({services: [trimmedName]}).catch(() => null);

        return {
            service: trimmedName,
            image,
            beforeImageId,
            afterImageId,
            updated: beforeImageId !== afterImageId,
            restarted,
        };
    };

    api.detectKavitaMount = async function detectKavitaMount() {
        const detectionStartedAt = timestamp();
        appendHistoryEntry('noona-raven', {
            type: 'status',
            status: 'detecting',
            message: 'Detecting Kavita data mount',
            detail: null,
        });
        invokeWizard(
            'recordRavenDetail',
            {
                detection: {
                    status: 'detecting',
                    message: 'Detecting Kavita data mount…',
                    mountPath: null,
                    updatedAt: detectionStartedAt,
                },
                message: 'Detecting Kavita data mount…',
            },
            { status: 'in-progress', error: null },
        );

        try {
            const detection = await detectKavitaDataMount();

            if (detection?.mountPath) {
                appendHistoryEntry('noona-raven', {
                    type: 'status',
                    status: 'detected',
                    message: `Kavita data mount detected at ${detection.mountPath}`,
                    detail: detection.mountPath,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'detected',
                            message: `Kavita data mount detected at ${detection.mountPath}`,
                            mountPath: detection.mountPath,
                            updatedAt: timestamp(),
                        },
                        message: `Kavita data mount detected at ${detection.mountPath}`,
                    },
                    { status: 'in-progress', error: null },
                );
            } else {
                appendHistoryEntry('noona-raven', {
                    type: 'status',
                    status: 'not-found',
                    message: 'Kavita data mount not detected automatically',
                    detail: null,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'not-found',
                            message: 'Kavita data mount not detected automatically',
                            mountPath: null,
                            updatedAt: timestamp(),
                        },
                        message: 'Kavita data mount not detected automatically',
                    },
                    { status: 'in-progress', error: null },
                );
            }

            return detection;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry('noona-raven', {
                type: 'status',
                status: 'error',
                message: 'Failed to detect Kavita data mount',
                detail: message,
                error: message,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    detection: {
                        status: 'error',
                        message,
                        mountPath: null,
                        updatedAt: timestamp(),
                    },
                    message,
                },
                { status: 'error', error: message },
            );
            throw error;
        }
    };

    api.getServiceHealth = async function getServiceHealth(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const entry = serviceCatalog.get(trimmedName);
        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const descriptor = entry.descriptor;
        const candidateUrls = [];
        const seen = new Set();
        const addCandidate = (candidate) => {
            if (typeof candidate !== 'string') {
                return;
            }

            const trimmed = candidate.trim();
            if (!trimmed || seen.has(trimmed)) {
                return;
            }

            seen.add(trimmed);
            candidateUrls.push(trimmed);
        };

        const resolveHealthFromHostBase = (baseUrl) => {
            if (typeof baseUrl !== 'string') {
                return null;
            }

            const trimmed = baseUrl.trim();
            if (!trimmed) {
                return null;
            }

            if (/\/health\/?$/i.test(trimmed)) {
                return trimmed;
            }

            try {
                const parsed = new URL(trimmed);
                const pathName = parsed.pathname ?? '';
                if (!pathName || pathName === '/' || pathName === '//') {
                    parsed.pathname = '/health';
                } else {
                    parsed.pathname = `${pathName.replace(/\/$/, '')}/health`;
                }
                return parsed.toString();
            } catch {
                return `${trimmed.replace(/\/$/, '')}/health`;
            }
        };

        const hostBase = api.resolveHostServiceUrl(descriptor);
        const hostHealth = resolveHealthFromHostBase(hostBase);
        if (hostHealth) {
            addCandidate(hostHealth);
        }

        if (typeof descriptor.health === 'string' && descriptor.health.trim()) {
            addCandidate(descriptor.health.trim());
        }

        if (candidateUrls.length === 0) {
            throw new Error(`Health endpoint is not defined for ${trimmedName}.`);
        }

        const attemptErrors = [];

        for (const url of candidateUrls) {
            try {
                const response = await fetchImpl(url, { method: 'GET' });
                const rawBody = await response.text();
                let detailMessage = rawBody ? rawBody.trim() : '';
                let normalizedStatus = response.ok ? 'healthy' : 'error';

                if (detailMessage) {
                    try {
                        const parsed = JSON.parse(detailMessage);
                        if (parsed && typeof parsed === 'object') {
                            const record = parsed;
                            if (typeof record.status === 'string' && record.status.trim()) {
                                normalizedStatus = record.status.trim().toLowerCase();
                            }
                            if (typeof record.message === 'string' && record.message.trim()) {
                                detailMessage = record.message.trim();
                            } else if (typeof record.detail === 'string' && record.detail.trim()) {
                                detailMessage = record.detail.trim();
                            }
                        }
                    } catch {
                        // keep raw body as detail
                    }
                }

                if (!detailMessage) {
                    detailMessage = response.ok
                        ? 'Health check succeeded.'
                        : `Health check failed with status ${response.status}`;
                }

                if (!response.ok) {
                    throw new Error(detailMessage);
                }

                if (trimmedName === 'noona-raven') {
                    invokeWizard(
                        'recordRavenDetail',
                        {
                            health: {
                                status: normalizedStatus,
                                message: detailMessage,
                                updatedAt: timestamp(),
                            },
                            message: detailMessage,
                        },
                        { status: 'in-progress', error: null },
                    );
                }

                return { status: normalizedStatus, detail: detailMessage, url };
            } catch (error) {
                attemptErrors.push({ url, error });
            }
        }

        const errorMessage = attemptErrors
            .map((entry) => {
                const reason = entry.error instanceof Error ? entry.error.message : String(entry.error);
                return `${entry.url}: ${reason}`;
            })
            .join(' | ') || 'Unable to verify service health.';

        if (trimmedName === 'noona-raven') {
            invokeWizard(
                'recordRavenDetail',
                {
                    health: {
                        status: 'error',
                        message: errorMessage,
                        updatedAt: timestamp(),
                    },
                    message: errorMessage,
                },
                { status: 'error', error: errorMessage },
            );
        }

        throw new Error(errorMessage);
    };

    api.testService = async function testService(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const entry = serviceCatalog.get(trimmedName);
        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const descriptor = entry.descriptor;
        const formatServiceLabel = (service) =>
            service
                .replace(/^noona-/, '')
                .split('-')
                .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
                .join(' ');

        const httpTestConfig = {
            'noona-portal': {
                displayName: formatServiceLabel('noona-portal'),
                defaultPath: '/health',
                successMessage: 'Portal health check succeeded',
                failurePrefix: 'Portal',
            },
            'noona-vault': {
                displayName: formatServiceLabel('noona-vault'),
                defaultPath: '/v1/vault/health',
                successMessage: 'Vault health check succeeded',
                failurePrefix: 'Vault',
            },
            'noona-redis': {
                displayName: formatServiceLabel('noona-redis'),
                defaultPath: '/',
                successMessage: 'Redis health check succeeded',
                failurePrefix: 'Redis',
            },
            'noona-raven': {
                displayName: formatServiceLabel('noona-raven'),
                defaultPath: '/v1/library/health',
                successMessage: 'Raven health check succeeded',
                failurePrefix: 'Raven',
            },
        }[trimmedName];

        const ensurePath = (path) => {
            if (!path) {
                return '/health';
            }
            if (path === '/') {
                return '/';
            }
            return path.startsWith('/') ? path : `/${path}`;
        };

        const resolveHealthFromHostBase = (baseUrl, fallbackPath) => {
            if (typeof baseUrl !== 'string') {
                return null;
            }

            const trimmed = baseUrl.trim();
            if (!trimmed) {
                return null;
            }

            const normalizedPath = ensurePath(fallbackPath);

            if (!fallbackPath && /\/health\/?$/i.test(trimmed)) {
                return trimmed;
            }

            if (fallbackPath && trimmed.toLowerCase().endsWith(normalizedPath.toLowerCase())) {
                return trimmed;
            }

            try {
                return new URL(normalizedPath, trimmed).toString();
            } catch {
                const base = trimmed.replace(/\/$/, '');
                if (normalizedPath === '/') {
                    return `${base}/`;
                }
                return `${base}${normalizedPath}`;
            }
        };

        if (httpTestConfig) {
            const {
                path: pathOverride,
                url: urlOverride,
                method = 'GET',
                headers = {},
                body: requestBody = null,
            } = options ?? {};
            const candidateUrls = [];
            const seenCandidates = new Set();

            const addCandidate = (candidate) => {
                if (typeof candidate !== 'string') {
                    return;
                }

                const trimmedCandidate = candidate.trim();
                if (!trimmedCandidate || seenCandidates.has(trimmedCandidate)) {
                    return;
                }

                seenCandidates.add(trimmedCandidate);
                candidateUrls.push(trimmedCandidate);
            };

            const hostBase = api.resolveHostServiceUrl(descriptor);
            const hostHealthUrl = hostBase
                ? resolveHealthFromHostBase(hostBase, httpTestConfig.defaultPath)
                : null;

            if (typeof urlOverride === 'string' && urlOverride.trim()) {
                addCandidate(urlOverride);
            }

            if (!urlOverride && typeof pathOverride === 'string' && pathOverride.trim()) {
                if (hostBase) {
                    try {
                        addCandidate(new URL(pathOverride, hostBase).toString());
                    } catch {
                        const normalizedPath = ensurePath(pathOverride);
                        const base = hostBase.replace(/\/$/, '');
                        addCandidate(
                            normalizedPath === '/'
                                ? `${base}/`
                                : `${base}${normalizedPath}`,
                        );
                    }
                }
            }

            addCandidate(hostHealthUrl);

            if (typeof descriptor.health === 'string' && descriptor.health.trim()) {
                addCandidate(descriptor.health.trim());
            }

            if (!candidateUrls.length) {
                const errorMessage = `${httpTestConfig.displayName} health endpoint is not defined.`;
                appendHistoryEntry(trimmedName, {
                    type: 'error',
                    status: 'error',
                    message: errorMessage,
                    detail: errorMessage,
                    error: errorMessage,
                });

                return {
                    service: trimmedName,
                    success: false,
                    supported: true,
                    error: errorMessage,
                };
            }

            const attemptErrors = [];

            for (const targetUrl of candidateUrls) {
                appendHistoryEntry(trimmedName, {
                    type: 'status',
                    status: 'testing',
                    message: `Testing ${httpTestConfig.displayName} via ${targetUrl}`,
                    detail: targetUrl,
                });

                const start = Date.now();

                try {
                    const response = await fetchImpl(targetUrl, {
                        method,
                        headers,
                        body: requestBody,
                    });

                    const duration = Date.now() - start;
                    const rawBody = await response.text();
                    let parsedBody = rawBody;

                    try {
                        parsedBody = rawBody ? JSON.parse(rawBody) : null;
                    } catch {
                        // Ignore JSON parse failures and preserve raw body.
                    }

                    if (!response.ok) {
                        const errorMessage = `${httpTestConfig.displayName} responded with status ${response.status}`;
                        appendHistoryEntry(trimmedName, {
                            type: 'error',
                            status: 'error',
                            message: errorMessage,
                            detail: typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody),
                            error: errorMessage,
                        });

                        return {
                            service: trimmedName,
                            success: false,
                            supported: true,
                            status: response.status,
                            duration,
                            error: errorMessage,
                            body: parsedBody,
                        };
                    }

                    appendHistoryEntry(trimmedName, {
                        type: 'status',
                        status: 'tested',
                        message: httpTestConfig.successMessage,
                        detail: targetUrl,
                    });

                    return {
                        service: trimmedName,
                        success: true,
                        supported: true,
                        status: response.status,
                        duration,
                        body: parsedBody,
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    attemptErrors.push({ url: targetUrl, message });

                    appendHistoryEntry(trimmedName, {
                        type: 'error',
                        status: 'error',
                        message: `${httpTestConfig.failurePrefix} test failed`,
                        detail: message,
                        error: message,
                    });
                }
            }

            const formattedErrors = attemptErrors.map(({ url, message }) => `${url} (${message})`);
            const aggregatedMessage = attemptErrors.length
                ? `${httpTestConfig.failurePrefix} test failed for all candidates: ${formattedErrors.join('; ')}`
                : `${httpTestConfig.failurePrefix} test failed for all candidates.`;

            return {
                service: trimmedName,
                success: false,
                supported: true,
                error: aggregatedMessage,
            };
        }

        if (trimmedName === 'noona-mongo') {
            appendHistoryEntry(trimmedName, {
                type: 'status',
                status: 'testing',
                message: 'Inspecting Mongo container status',
                detail: null,
            });

            try {
                const dockerClient = await ensureDockerConnection();
                const container = dockerClient.getContainer(trimmedName);
                const inspection = await container.inspect();
                const state = inspection?.State || {};
                const running = state.Running === true;
                const status = state.Status || (running ? 'running' : 'stopped');
                const healthStatus = state.Health?.Status || null;
                const detailMessage = running
                    ? `Mongo container is ${status}${healthStatus ? ` (health: ${healthStatus})` : ''}.`
                    : `Mongo container is not running (status: ${status}).`;

                appendHistoryEntry(trimmedName, {
                    type: running ? 'status' : 'error',
                    status: running ? 'tested' : 'error',
                    message: running ? 'Mongo container inspection succeeded' : 'Mongo container reported inactive',
                    detail: detailMessage,
                    error: running ? null : detailMessage,
                });

                return {
                    service: trimmedName,
                    success: running,
                    supported: true,
                    status,
                    detail: detailMessage,
                    body: {
                        state,
                    },
                    error: running ? undefined : detailMessage,
                };
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(trimmedName, {
                    type: 'error',
                    status: 'error',
                    message: 'Mongo inspection failed',
                    detail: message,
                    error: message,
                });

                return {
                    service: trimmedName,
                    success: false,
                    supported: true,
                    error: message,
                };
            }
        }

        return {
            service: trimmedName,
            success: false,
            supported: false,
            error: `Test action not supported for ${trimmedName}.`,
        };
    };

    api.bootMinimal = async function bootMinimal() {
        const moon = buildEffectiveServiceDescriptor('noona-moon').descriptor;
        const sage = buildEffectiveServiceDescriptor('noona-sage').descriptor;
        const moonHealthUrl = moon.health || (() => {
            const moonEnv = parseEnvEntries(moon.env);
            const moonPort = normalizeHostPort(moon.internalPort || moon.port || moonEnv.WEBGUI_PORT || 3000);
            if (moonPort == null) {
                return null;
            }

            return `http://${moon.name}:${moonPort}/`;
        })();

        await api.startService(sage, 'http://noona-sage:3004/health');
        await api.startService(moon, moonHealthUrl);
    };

    api.bootFull = async function bootFull() {
        for (const name of bootOrder) {
            if (!serviceCatalog.has(name)) {
                continue;
            }

            const svc = buildEffectiveServiceDescriptor(name).descriptor;
            const healthUrl =
                name === 'noona-redis'
                    ? 'http://noona-redis:8001/'
                    : name === 'noona-sage'
                        ? 'http://noona-sage:3004/health'
                        : svc.health || null;

            await api.startService(svc, healthUrl);
        }
    };

    api.startEcosystem = async function startEcosystem(options = {}) {
        const setupCompleted = options?.setupCompleted === true
            ? true
            : options?.setupCompleted === false
                ? false
                : await api.isSetupCompleted();
        const shouldBootFull = options?.forceFull === true || SUPER_MODE || setupCompleted;

        if (shouldBootFull) {
            await api.bootFull();
        } else {
            await api.bootMinimal();
        }

        return {
            mode: shouldBootFull ? 'full' : 'minimal',
            setupCompleted,
        };
    };

    api.shutdownAll = async function shutdownAll(options = {}) {
        const shouldExit = options?.exit !== false;
        const trackedOnly = options?.trackedOnly !== false;
        logger.warn(`Shutting down all containers...`);
        stopServiceUpdateTimer();

        const results = await api.stopEcosystem({
            trackedOnly,
            onResult: async (result) => {
                if (result?.stopped === true) {
                    logger.log(`Stopped & removed ${result.service}`);
                } else if (result?.reason && result?.reason !== 'not-running') {
                    logger.warn(`Error stopping ${result.service}: ${result.reason}`);
                }
            },
        });

        trackedContainers.clear();

        if (shouldExit) {
            processExit(0);
        }

        return {results};
    };

    api.init = async function init() {
        const dockerClient = await ensureDockerConnection();
        await dockerUtils.ensureNetwork(dockerClient, networkName);
        await dockerUtils.attachSelfToNetwork(dockerClient, networkName);

        const setupCompleted = await api.isSetupCompleted();
        const shouldBootFull = SUPER_MODE || setupCompleted;

        if (shouldBootFull) {
            if (SUPER_MODE) {
                logger.log('[Warden] 💥 DEBUG=super — launching full stack in superBootOrder...');
            } else {
                logger.log('[Warden] Setup marked complete — launching full stack.');
            }
            await api.bootFull();
        } else {
            logger.log('[Warden] 🧪 Minimal mode — launching sage and moon only');
            await api.bootMinimal();
        }

        startServiceUpdateTimer();
        logger.log(`✅ Warden is ready.`);
        return {mode: shouldBootFull ? 'full' : 'minimal', setupCompleted};
    };

    return api;
}

export default createWarden;
export { defaultDockerSocketDetector };
