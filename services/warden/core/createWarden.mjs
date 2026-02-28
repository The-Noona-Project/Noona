// services/warden/core/createWarden.mjs
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
    removeContainers,
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
import {createVaultPacketClient} from '../../sage/clients/vaultPacketClient.mjs';
import {createWizardStateClient, createWizardStatePublisher,} from '../../sage/wizard/wizardStateClient.mjs';
import {registerBootApi} from './registerBootApi.mjs';
import {registerDiagnosticsApi} from './registerDiagnosticsApi.mjs';
import {registerServiceManagementApi} from './registerServiceManagementApi.mjs';

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
const DEFAULT_SETTINGS_COLLECTION = 'noona_settings';
const SERVICE_CONFIG_SETTINGS_TYPE = 'service-runtime-config';
const SERVICE_CONFIG_SETTINGS_KEY_PREFIX = 'services.config.';

function normalizeServices(servicesOption = {}) {
    const {addon = addonDockers, core = noonaDockers} = servicesOption;
    return {addon, core};
}

function normalizeDockerUtils(utilsOption = {}) {
    return {
        attachSelfToNetwork,
        containerExists,
        ensureNetwork,
        formatDockerProgressMessage,
        pullImageIfNeeded,
        removeContainers,
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
        settings: settingsOption = {},
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
    let persistedServiceRuntimeConfigLoaded = false;
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
        'noona-vault',
        'noona-sage',
        'noona-moon',
        'noona-portal',
        'noona-raven',
        'noona-oracle',
    ];
    const minimalServiceNames = ['noona-sage', 'noona-moon'];
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

        return new Docker({socketPath: socketReference});
    });

    const baseSocketCandidates = Array.isArray(hostDockerSocketsOption)
        ? hostDockerSocketsOption
        : dockerSocketDetector({env, fs: fsModule});

    const normalizedHostDockerSockets = [];

    for (const candidate of baseSocketCandidates) {
        const normalized = normalizeSocketPath(candidate, {allowRemote: true});
        if (normalized) {
            normalizedHostDockerSockets.push(normalized);
        }
    }

    if (typeof env?.DOCKER_HOST === 'string') {
        const normalizedDockerHost = normalizeSocketPath(env.DOCKER_HOST, {allowRemote: true});
        if (normalizedDockerHost) {
            normalizedHostDockerSockets.push(normalizedDockerHost);
        }
    }

    const hostDockerSockets = Array.from(new Set(normalizedHostDockerSockets));

    const initialSocketPath = normalizeSocketPath(
        dockerInstance?.modem?.socketPath || env?.DOCKER_HOST || null,
        {allowRemote: true},
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
                ? normalizeSocketPath(context.socketPath, {allowRemote: true})
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
            const normalizedCandidate = normalizeSocketPath(candidate, {allowRemote: true});
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
            await client.listContainers({limit: 1});
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
                errors.push({description, message});
            }
        }

        const attempted = contexts.length ? contexts.map(describeDockerContext).join(', ') : 'none';
        const errorDetails = errors.length
            ? ` Errors: ${errors.map(({description, message}) => `${description}: ${message}`).join('; ')}`
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
    let settingsClient = settingsOption.client || null;
    const settingsEnv = settingsOption.env ?? env;
    const settingsCollection = (() => {
        const candidate =
            settingsOption.collection ??
            settingsEnv?.NOONA_SETTINGS_COLLECTION ??
            settingsEnv?.SETTINGS_COLLECTION ??
            DEFAULT_SETTINGS_COLLECTION;
        return typeof candidate === 'string' && candidate.trim()
            ? candidate.trim()
            : DEFAULT_SETTINGS_COLLECTION;
    })();

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

    if (!settingsClient) {
        const token =
            settingsOption.token ??
            settingsEnv?.VAULT_API_TOKEN ??
            settingsEnv?.VAULT_ACCESS_TOKEN ??
            null;

        if (token) {
            const baseCandidates = [];
            if (settingsOption.baseUrl) {
                baseCandidates.push(settingsOption.baseUrl);
            }
            if (Array.isArray(settingsOption.baseUrls)) {
                baseCandidates.push(...settingsOption.baseUrls);
            }

            try {
                settingsClient = createVaultPacketClient({
                    baseUrl: baseCandidates[0],
                    baseUrls: baseCandidates.slice(1),
                    token,
                    fetchImpl: settingsOption.fetchImpl ?? settingsOption.fetch ?? fetchImpl,
                    env: settingsEnv,
                    logger,
                    serviceName,
                    timeoutMs: settingsOption.timeoutMs,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn?.(`[${serviceName}] ⚠️ Settings client initialization failed: ${message}`);
            }
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
                .map((entry) => ({...entry}));

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

            return {items, percent, status};
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
                {mirrorToInstallation: false},
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

    const appendHistoryEntry = (name, entry = {}, {mirrorToInstallation = true} = {}) => {
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
                {mirrorToInstallation: false},
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
                {mirrorToInstallation: false},
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
                    const containers = await client.listContainers({all: true});
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

    const escapeRegExp = (value) => String(value ?? '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    const listRegisteredServiceNames = () =>
        Array.from(serviceCatalog.keys()).sort((left, right) => left.localeCompare(right));

    const orderServicesForLifecycle = (names = []) => {
        const seen = new Set();
        const normalized = [];

        const register = (name) => {
            if (typeof name !== 'string') {
                return;
            }

            const trimmed = name.trim();
            if (!trimmed || seen.has(trimmed) || !serviceCatalog.has(trimmed)) {
                return;
            }

            seen.add(trimmed);
            normalized.push(trimmed);
        };

        for (const name of names) {
            register(name);
        }

        const priority = Array.from(new Set([...bootOrder, ...minimalServiceNames, ...requiredServices]));
        const ordered = priority.filter((name) => seen.has(name));
        const extras = normalized
            .filter((name) => !priority.includes(name))
            .sort((left, right) => left.localeCompare(right));

        return [...ordered, ...extras];
    };

    const buildContainerNameMatcher = (target) => {
        const escaped = escapeRegExp(target);
        return new RegExp(`(^|[._-])${escaped}([._-]\\d+)?$`, 'i');
    };

    const findMatchingContainersByName = async (name, dockerClient) => {
        if (!name || !dockerClient || typeof dockerClient.listContainers !== 'function') {
            return [];
        }

        const trimmedName = typeof name === 'string' ? name.trim().toLowerCase() : '';
        if (!trimmedName) {
            return [];
        }

        const matcher = buildContainerNameMatcher(trimmedName);
        const containers = await dockerClient.listContainers({all: true});

        return containers.filter((container = {}) => {
            const names = Array.isArray(container?.Names) ? container.Names : [];
            return names.some((rawName) => {
                if (typeof rawName !== 'string') {
                    return false;
                }

                const normalized = rawName.replace(/^\//, '').toLowerCase();
                if (!normalized) {
                    return false;
                }

                return normalized === trimmedName || matcher.test(normalized);
            });
        });
    };

    const getContainerPresence = async (name, dockerClient) => {
        const matches = await findMatchingContainersByName(name, dockerClient);
        if (matches.length === 0) {
            return {exists: false, running: false};
        }

        const running = matches.some((container = {}) => {
            const state = typeof container?.State === 'string' ? container.State.trim().toLowerCase() : '';
            const status = typeof container?.Status === 'string' ? container.Status.trim().toLowerCase() : '';

            if (state === 'running') {
                return true;
            }

            return status.startsWith('up ');
        });

        return {exists: true, running};
    };

    const parsePersistedServiceSelection = (candidate) => {
        if (!Array.isArray(candidate)) {
            return [];
        }

        const names = [];
        const seen = new Set();

        for (const entry of candidate) {
            if (typeof entry !== 'string') {
                continue;
            }

            const trimmed = entry.trim();
            if (!trimmed || seen.has(trimmed) || !serviceCatalog.has(trimmed)) {
                continue;
            }

            seen.add(trimmed);
            names.push(trimmed);
        }

        return names;
    };

    const extractPersistedSetupServiceSelection = (state) => {
        const candidates = [
            state?.verification?.actor?.metadata?.selectedServices,
            state?.verification?.actor?.metadata?.selected,
            state?.foundation?.actor?.metadata?.selectedServices,
            state?.foundation?.actor?.metadata?.selected,
        ];

        for (const candidate of candidates) {
            const normalized = parsePersistedServiceSelection(candidate);
            if (normalized.length > 0) {
                return normalized;
            }
        }

        return [];
    };

    const resolvePersistedSetupServiceNames = async () => {
        if (!wizardStateClient || typeof wizardStateClient.loadState !== 'function') {
            return [];
        }

        try {
            const state = await wizardStateClient.loadState({fallbackToDefault: true});
            return extractPersistedSetupServiceSelection(state);
        } catch {
            return [];
        }
    };

    const listInstalledManagedServiceNames = async (dockerClient) => {
        if (!dockerClient) {
            return [];
        }

        const names = [];
        for (const name of listRegisteredServiceNames()) {
            const installed = await dockerUtils.containerExists(name, {dockerInstance: dockerClient});
            if (installed) {
                names.push(name);
            }
        }

        return orderServicesForLifecycle(names);
    };

    const resolveManagedLifecycleServices = async ({dockerClient = null, fallbackToAll = true} = {}) => {
        const persistedSelection = await resolvePersistedSetupServiceNames();
        if (persistedSelection.length > 0) {
            return orderServicesForLifecycle([
                ...requiredServices,
                ...minimalServiceNames,
                ...persistedSelection,
            ]);
        }

        if (dockerClient) {
            try {
                const installed = await listInstalledManagedServiceNames(dockerClient);
                if (installed.length > 0) {
                    return installed;
                }
            } catch (error) {
                markDockerConnectionStale(error);
            }
        }

        if (!fallbackToAll) {
            return [];
        }

        return orderServicesForLifecycle([
            ...requiredServices,
            ...minimalServiceNames,
            ...bootOrder,
            ...listRegisteredServiceNames(),
        ]);
    };

    const buildServiceConfigSettingsKey = (name) => `${SERVICE_CONFIG_SETTINGS_KEY_PREFIX}${name}`;

    const parsePersistedServiceConfigName = (document = {}) => {
        const directName = typeof document?.service === 'string' ? document.service.trim() : '';
        if (directName) {
            return directName;
        }

        const key = typeof document?.key === 'string' ? document.key.trim() : '';
        if (key.startsWith(SERVICE_CONFIG_SETTINGS_KEY_PREFIX)) {
            return key.slice(SERVICE_CONFIG_SETTINGS_KEY_PREFIX.length).trim();
        }

        return '';
    };

    const normalizePersistedRuntimeConfig = (runtime = {}) => ({
        env: normalizeEnvOverrideMap(runtime?.env),
        hostPort: normalizeHostPort(runtime?.hostPort),
    });

    const hasPersistedRuntimeConfig = (runtime = {}) => {
        const normalized = normalizePersistedRuntimeConfig(runtime);
        return Object.keys(normalized.env).length > 0 || normalized.hostPort != null;
    };

    const buildPersistedServiceConfigDocument = (name, runtime = {}) => {
        const normalized = normalizePersistedRuntimeConfig(runtime);
        return {
            key: buildServiceConfigSettingsKey(name),
            type: SERVICE_CONFIG_SETTINGS_TYPE,
            service: name,
            env: normalized.env,
            hostPort: normalized.hostPort,
            updatedAt: timestamp(),
        };
    };

    const persistServiceRuntimeConfig = async (name, runtime = {}) => {
        if (!settingsClient?.mongo?.update) {
            return {available: false, persisted: false};
        }

        const key = buildServiceConfigSettingsKey(name);
        if (!hasPersistedRuntimeConfig(runtime)) {
            if (typeof settingsClient?.mongo?.delete === 'function') {
                await settingsClient.mongo.delete(settingsCollection, {key});
            } else {
                await settingsClient.mongo.update(
                    settingsCollection,
                    {key},
                    {
                        $set: {
                            key,
                            type: SERVICE_CONFIG_SETTINGS_TYPE,
                            service: name,
                            env: {},
                            hostPort: null,
                            updatedAt: timestamp(),
                        },
                    },
                    {upsert: true},
                );
            }

            return {available: true, persisted: true, deleted: true};
        }

        await settingsClient.mongo.update(
            settingsCollection,
            {key},
            {$set: buildPersistedServiceConfigDocument(name, runtime)},
            {upsert: true},
        );

        return {available: true, persisted: true, deleted: false};
    };

    const persistServiceRuntimeConfigs = async (names = []) => {
        for (const name of names) {
            await persistServiceRuntimeConfig(name, resolveRuntimeConfig(name));
        }
    };

    const loadPersistedServiceRuntimeConfig = async () => {
        if (persistedServiceRuntimeConfigLoaded) {
            return [];
        }

        if (!settingsClient?.mongo?.findMany) {
            persistedServiceRuntimeConfigLoaded = true;
            return [];
        }

        const documents = await settingsClient.mongo.findMany(settingsCollection, {
            type: SERVICE_CONFIG_SETTINGS_TYPE,
        });

        const loaded = [];
        for (const document of documents) {
            const candidateName = parsePersistedServiceConfigName(document);
            if (!candidateName || !serviceCatalog.has(candidateName)) {
                continue;
            }

            const snapshot = writeRuntimeConfig(candidateName, {
                env: document?.env,
                hostPort: document?.hostPort,
            });

            if (!hasPersistedRuntimeConfig(snapshot)) {
                continue;
            }

            loaded.push({
                service: candidateName,
                ...snapshot,
            });
        }

        persistedServiceRuntimeConfigLoaded = true;
        return loaded;
    };

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
        const client = dockerClient || (await ensureDockerConnection());
        const installed = await dockerUtils.containerExists(name, {dockerInstance: client});
        if (!image) {
            const snapshot = {
                service: name,
                image: null,
                checkedAt: timestamp(),
                updateAvailable: false,
                remoteDigest: null,
                localDigests: [],
                installed,
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
                installed,
                supported: false,
                error: 'Update check currently supports Docker Hub images only.',
            };
            serviceUpdateSnapshots.set(name, snapshot);
            return snapshot;
        }

        const localDigests = await getLocalImageDigests(client, image);
        const remoteDigest = await fetchDockerHubDigest(resolvedImage);
        const updateAvailable = installed && Boolean(remoteDigest) && !localDigests.includes(remoteDigest);

        const snapshot = {
            service: name,
            image,
            checkedAt: timestamp(),
            updateAvailable,
            remoteDigest,
            localDigests,
            installed,
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

    const runtimeDebugState = {
        get value() {
            return runtimeDebug;
        },
        set value(nextValue) {
            runtimeDebug = nextValue;
        },
    };

    const persistedServiceRuntimeConfigLoadedState = {
        get value() {
            return persistedServiceRuntimeConfigLoaded;
        },
    };

    registerServiceManagementApi({
        api,
        appendHistoryEntry,
        applyEnvOverrides,
        applyVaultDataMountForService,
        buildEffectiveServiceDescriptor,
        cloneEnvConfig,
        cloneMeta,
        cloneServiceDescriptor,
        collectRavenDownloadMounts,
        deleteRavenDownloads,
        dependencyGraph,
        detectKavitaDataMount,
        dockerUtils,
        ensureDockerConnection,
        ensureHistory,
        findMatchingContainersByName,
        formatDockerProgressMessage,
        getContainerPresence,
        getInstallationProgressSnapshot,
        hostServiceBase,
        INSTALLATION_SERVICE,
        invokeWizard,
        isDebugFlagEnabled,
        isLoggerDebugEnabled,
        listInstalledManagedServiceNames,
        listRegisteredServiceNames,
        logger,
        markDockerConnectionStale,
        networkName,
        normalizeEnvOverrideMap,
        normalizeHostPort,
        parseEnvEntries,
        parsePositiveLimit,
        persistServiceRuntimeConfig,
        persistServiceRuntimeConfigs,
        recordContainerOutput,
        removeNoonaDockerArtifacts,
        requiredServiceSet,
        requiredServices,
        resetInstallationTracking,
        resolveManagedLifecycleServices,
        resolveRuntimeConfig,
        runtimeDebugState,
        serviceCatalog,
        serviceName,
        setLoggerDebug,
        timestamp,
        trackedContainers,
        writeRuntimeConfig,
    });

    registerDiagnosticsApi({
        api,
        appendHistoryEntry,
        buildEffectiveServiceDescriptor,
        checkServiceUpdate,
        detectKavitaDataMount,
        dockerUtils,
        ensureDockerConnection,
        fetchDockerHubDigest,
        fetchImpl,
        getLocalImageDigests,
        invokeWizard,
        listRegisteredServiceNames,
        logger,
        markDockerConnectionStale,
        parseImageReference,
        serviceCatalog,
        serviceName,
        serviceUpdateSnapshots,
        timestamp,
        wizardStateClient,
    });

    registerBootApi({
        api,
        bootOrder,
        buildEffectiveServiceDescriptor,
        dockerUtils,
        ensureDockerConnection,
        isPersistedServiceRuntimeConfigLoaded: () => persistedServiceRuntimeConfigLoadedState.value,
        loadPersistedServiceRuntimeConfig,
        logger,
        networkName,
        normalizeHostPort,
        orderServicesForLifecycle,
        parseEnvEntries,
        processExit,
        requiredServiceSet,
        resolveManagedLifecycleServices,
        serviceCatalog,
        startServiceUpdateTimer,
        stopServiceUpdateTimer,
        SUPER_MODE,
        trackedContainers,
    });

    return api;
}

export default createWarden;
export {defaultDockerSocketDetector};
