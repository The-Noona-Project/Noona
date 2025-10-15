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
    pullImageIfNeeded,
    runContainerWithLogs,
    waitForHealthyStatus,
} from '../docker/dockerUtilties.mjs';
import { log, warn } from '../../../utilities/etc/logger.mjs';
import {
    createWizardStateClient,
    createWizardStatePublisher,
} from '../../sage/shared/wizardStateClient.mjs';

function normalizeServices(servicesOption = {}) {
    const { addon = addonDockers, core = noonaDockers } = servicesOption;
    return { addon, core };
}

function normalizeDockerUtils(utilsOption = {}) {
    return {
        attachSelfToNetwork,
        containerExists,
        ensureNetwork,
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

function normalizeSocketPath(candidate) {
    if (!candidate || typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();

    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('unix://')) {
        return trimmed.slice('unix://'.length);
    }

    if (trimmed.startsWith('tcp://')) {
        return null;
    }

    return trimmed;
}

function defaultDockerSocketDetector({ env = process.env, fs: fsModule = fs } = {}) {
    const sockets = new Set();

    const envCandidates = [env?.NOONA_HOST_DOCKER_SOCKETS, env?.HOST_DOCKER_SOCKETS]
        .filter(value => typeof value === 'string' && value.trim().length > 0)
        .flatMap(value => value.split(',').map(entry => normalizeSocketPath(entry)));

    for (const candidate of envCandidates) {
        if (candidate) {
            sockets.add(candidate);
        }
    }

    const dockerHost = normalizeSocketPath(env?.DOCKER_HOST);
    if (dockerHost) {
        sockets.add(dockerHost);
    }

    const defaultCandidates = [
        '/var/run/docker.sock',
        '/var/run/docker/docker.sock',
        '/run/docker.sock',
        '/run/docker/docker.sock',
        '/var/run/podman/podman.sock',
        '/run/podman/podman.sock',
    ];

    for (const candidate of defaultCandidates) {
        const normalized = normalizeSocketPath(candidate);
        if (normalized) {
            sockets.add(normalized);
        }
    }

    if (typeof fsModule?.readdirSync === 'function') {
        const directories = [
            '/var/run',
            '/run',
            '/var/run/docker',
            '/run/docker',
            '/var/run/podman',
            '/run/podman',
        ];

        for (const directory of directories) {
            try {
                const entries = fsModule.readdirSync(directory, { withFileTypes: true });

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }

                    const isSocket = typeof entry.isSocket === 'function' && entry.isSocket();
                    const isFile = typeof entry.isFile === 'function' && entry.isFile();

                    if (!isSocket && !isFile) {
                        continue;
                    }

                    const name = entry.name;
                    if (!name || !name.toLowerCase().includes('sock')) {
                        continue;
                    }

                    if (!/(docker|podman)/i.test(name)) {
                        continue;
                    }

                    const fullPath = path.posix.join(directory, name);
                    sockets.add(fullPath);
                }
            } catch (error) {
                // Ignore inaccessible directories.
            }
        }
    }

    return Array.from(sockets);
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

const timestamp = () => new Date().toISOString();

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
    } = options;

    const services = normalizeServices(servicesOption);
    const dockerUtils = normalizeDockerUtils(dockerUtilsOption);
    const logger = createDefaultLogger(loggerOption);
    const serviceCatalog = createServiceCatalog(services);
    const fsModule = fsOption || fs;
    const serviceName = env.SERVICE_NAME || 'noona-warden';

    const trackedContainers = trackedContainersOption || new Set();
    const networkName = networkNameOption || 'noona-network';
    const DEBUG = env.DEBUG ?? 'false';
    const SUPER_MODE = DEBUG === 'super';
    const hostServiceBase = env.HOST_SERVICE_URL ?? 'http://localhost';
    const bootOrder = superBootOrderOption || [
        'noona-redis',
        'noona-mongo',
        'noona-sage',
        'noona-moon',
        'noona-vault',
        'noona-raven',
    ];
    const dependencyGraph = new Map([
        ['noona-vault', ['noona-mongo', 'noona-redis']],
    ]);
    const requiredServices = ['noona-mongo', 'noona-redis', 'noona-vault'];
    const requiredServiceSet = new Set(requiredServices);

    const dockerFactory = dockerFactoryOption || ((socketPath) => new Docker({ socketPath }));

    const hostDockerSockets = Array.from(new Set((Array.isArray(hostDockerSocketsOption)
        ? hostDockerSocketsOption
        : dockerSocketDetector({ env, fs: fsModule }))
        .map(normalizeSocketPath)
        .filter(Boolean)));

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
                'complete',
                'completed',
                'detected',
                'configured',
            ].includes(normalized)
        ) {
            return 'installed';
        }

        if (['error', 'failed', 'failure'].includes(normalized)) {
            return 'error';
        }

        if (
            [
                'pending',
                'installing',
                'pulling',
                'starting',
                'exists',
                'health-check',
                'waiting',
                'detecting',
                'not-found',
            ].includes(normalized)
        ) {
            return 'installing';
        }

        return null;
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
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    ...entry,
                    type: normalized.type,
                    status: normalized.status,
                    detail: normalized.detail,
                    error: normalized.error,
                    message: `[${name}] ${normalized.message || normalized.status || ''}`.trim(),
                },
                { mirrorToInstallation: false },
            );
        }

        if (name !== INSTALLATION_SERVICE) {
            const mappedStatus = mapStatusForInstallation(normalized.status);
            if (mappedStatus) {
                const detail = normalized.detail || normalized.message || null;
                const previous = installationStatuses.get(name);

                if (
                    !previous ||
                    previous.status !== 'error' ||
                    mappedStatus === 'error'
                ) {
                    if (!(previous?.status === 'installed' && mappedStatus === 'installing')) {
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
            const contexts = [];
            const visitedSockets = new Set();

            const primarySocketPath = normalizeSocketPath(
                dockerInstance?.modem?.socketPath || env?.DOCKER_HOST || null,
            );

            contexts.push({
                client: dockerInstance,
                socketPath: primarySocketPath,
                label: 'default Docker instance',
            });

            if (primarySocketPath) {
                visitedSockets.add(primarySocketPath);
            }

            for (const candidate of hostDockerSockets) {
                if (!candidate || visitedSockets.has(candidate)) {
                    continue;
                }

                if (typeof fsModule?.existsSync === 'function') {
                    try {
                        if (!fsModule.existsSync(candidate)) {
                            continue;
                        }
                    } catch {
                        continue;
                    }
                }

                if (typeof fsModule?.statSync === 'function') {
                    try {
                        const stats = fsModule.statSync(candidate);
                        if (typeof stats?.isSocket === 'function' && !stats.isSocket()) {
                            continue;
                        }
                    } catch {
                        continue;
                    }
                }

                try {
                    const client = dockerFactory(candidate);
                    if (client) {
                        contexts.push({ client, socketPath: candidate, label: `socket ${candidate}` });
                        visitedSockets.add(candidate);
                    }
                } catch (error) {
                    logger.warn(`[Warden] Failed to initialize Docker client for socket ${candidate}: ${error.message}`);
                }
            }

            let foundContainer = false;

            for (const context of contexts) {
                const contextLabel = context.socketPath ? `socket ${context.socketPath}` : context.label;

                try {
                    const containers = await context.client.listContainers({ all: true });
                    const kavitaContainer = containers.find(container => {
                        const image = typeof container?.Image === 'string' ? container.Image.toLowerCase() : '';
                        if (image.includes('kavita')) {
                            return true;
                        }

                        const names = Array.isArray(container?.Names) ? container.Names : [];
                        return names.some(name => typeof name === 'string' && name.toLowerCase().includes('kavita'));
                    });

                    if (!kavitaContainer) {
                        continue;
                    }

                    foundContainer = true;

                    const inspected = await context.client
                        .getContainer(kavitaContainer.Id)
                        .inspect();
                    const mounts = inspected?.Mounts || [];
                    const dataMount = mounts.find(mount => mount?.Destination === '/data');

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

                        logger.log(`[Warden] Kavita data mount detected at ${dataMount.Source}${suffix}.`);

                        return {
                            mountPath: dataMount.Source,
                            socketPath: context.socketPath ?? null,
                            containerId: kavitaContainer.Id ?? null,
                            containerName: cleanName ?? null,
                        };
                    }

                    logger.warn(`[Warden] Kavita container found on ${contextLabel} but /data mount was not detected.`);
                } catch (error) {
                    logger.warn(`[Warden] Failed to query Docker on ${contextLabel}: ${error.message}`);
                }
            }

            if (!foundContainer) {
                logger.warn('[Warden] Kavita container not found while detecting data mount.');
            }
        } catch (error) {
            logger.warn(`[Warden] Failed to detect Kavita data mount: ${error.message}`);
        }

        return null;
    }

    const api = {
        trackedContainers,
        networkName,
        DEBUG,
        SUPER_MODE,
    };

    api.resolveHostServiceUrl = function resolveHostServiceUrl(service) {
        if (!service) {
            return null;
        }

        if (service.hostServiceUrl) {
            return service.hostServiceUrl;
        }

        if (service.port) {
            return `${hostServiceBase}:${service.port}`;
        }

        return null;
    };

    api.startService = async function startService(service, healthUrl = null) {
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

        const hostServiceUrl = api.resolveHostServiceUrl(service);
        let alreadyRunning = false;

        try {
            alreadyRunning = await dockerUtils.containerExists(serviceName);
        } catch (error) {
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

        if (!alreadyRunning) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'pulling',
                message: `Checking Docker image ${service.image}`,
                detail: service.image,
            });

            await dockerUtils.pullImageIfNeeded(service.image, {
                onProgress: (event = {}) => {
                    const status = event.status || 'progress';
                    const detail = event.detail ? String(event.detail).trim() : '';
                    const messageParts = [status, detail].filter(Boolean);

                    appendHistoryEntry(serviceName, {
                        type: 'progress',
                        status,
                        message: messageParts.join(' - '),
                        detail: detail || null,
                    });
                },
            });

            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'starting',
                message: 'Starting container',
                detail: null,
            });

            await dockerUtils.runContainerWithLogs(
                service,
                networkName,
                trackedContainers,
                DEBUG,
                {
                    onLog: (raw, context = {}) => {
                        recordContainerOutput(serviceName, raw, context);
                    },
                },
            );

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
            .map(({ category, descriptor }) => ({
                name: descriptor.name,
                category,
                image: descriptor.image,
                port: descriptor.port ?? null,
                hostServiceUrl: api.resolveHostServiceUrl(descriptor),
                description: descriptor.description ?? null,
                health: descriptor.health ?? null,
                envConfig: cloneEnvConfig(descriptor.envConfig),
                required: requiredServiceSet.has(descriptor.name),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const entries = await Promise.all(
            formatted.map(async (service) => {
                let installed = false;

                try {
                    installed = await dockerUtils.containerExists(service.name);
                } catch (error) {
                    logger.warn?.(
                        `[Warden] Failed to determine install status for ${service.name}: ${error.message}`,
                    );
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

    const installSingleServiceByName = async (name, envOverrides = null) => {
        const entry = serviceCatalog.get(name);

        if (!entry) {
            throw new Error(`Service ${name} is not registered with Warden.`);
        }

        const { descriptor, category } = entry;
        const healthUrl = descriptor.health || null;
        let kavitaDetection = null;
        let kavitaDataMount = null;
        let serviceDescriptor = {
            ...descriptor,
            env: Array.isArray(descriptor.env) ? [...descriptor.env] : descriptor.env,
            volumes: Array.isArray(descriptor.volumes) ? [...descriptor.volumes] : descriptor.volumes,
        };
        let normalizedOverrides = envOverrides ? { ...envOverrides } : null;
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
                    status: 'installed',
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
            status: 'installing',
            message: 'Starting installation',
            detail: null,
        });

        try {
            await api.startService(serviceDescriptor, healthUrl);
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
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            image: descriptor.image,
            port: descriptor.port ?? null,
            required: requiredServiceSet.has(descriptor.name),
        };

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
            const result = await installSingleServiceByName(serviceName, overrides);

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
                const result = await installSingleServiceByName(serviceName, overrides);
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
                const container = dockerInstance.getContainer(trimmedName);
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
        const moon = services.core['noona-moon'];
        const sage = services.core['noona-sage'];

        await api.startService(sage, 'http://noona-sage:3004/health');
        await api.startService(moon, 'http://noona-moon:3000/');
    };

    api.bootFull = async function bootFull() {
        const servicesMap = {
            ...services.addon,
            ...services.core,
        };

        for (const name of bootOrder) {
            const svc = servicesMap[name];
            if (!svc) {
                logger.warn(`Service ${name} not found in addonDockers or noonaDockers.`);
                continue;
            }

            const healthUrl =
                name === 'noona-redis'
                    ? 'http://noona-redis:8001/'
                    : name === 'noona-sage'
                        ? 'http://noona-sage:3004/health'
                        : svc.health || null;

            await api.startService(svc, healthUrl);
        }
    };

    api.shutdownAll = async function shutdownAll() {
        logger.warn(`Shutting down all containers...`);
        for (const name of trackedContainers) {
            try {
                const container = dockerInstance.getContainer(name);
                await container.stop();
                await container.remove();
                logger.log(`Stopped & removed ${name}`);
            } catch (err) {
                logger.warn(`Error stopping ${name}: ${err.message}`);
            }
        }

        trackedContainers.clear();
        processExit(0);
    };

    api.init = async function init() {
        await dockerUtils.ensureNetwork(dockerInstance, networkName);
        await dockerUtils.attachSelfToNetwork(dockerInstance, networkName);

        if (SUPER_MODE) {
            logger.log('[Warden] 💥 DEBUG=super — launching full stack in superBootOrder...');
            await api.bootFull();
        } else {
            logger.log('[Warden] 🧪 Minimal mode — launching sage and moon only');
            await api.bootMinimal();
        }

        logger.log(`✅ Warden is ready.`);
        return { mode: SUPER_MODE ? 'super' : 'minimal' };
    };

    return api;
}

export default createWarden;
