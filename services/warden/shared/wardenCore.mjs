// services/warden/shared/wardenCore.mjs
import fs from 'node:fs';
import path from 'node:path';

import Docker from 'dockerode';
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
    } = options;

    const services = normalizeServices(servicesOption);
    const dockerUtils = normalizeDockerUtils(dockerUtilsOption);
    const logger = createDefaultLogger(loggerOption);
    const serviceCatalog = createServiceCatalog(services);
    const fsModule = fsOption || fs;

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
    const requiredServices = ['noona-vault'];

    const dockerFactory = dockerFactoryOption || ((socketPath) => new Docker({ socketPath }));

    const hostDockerSockets = Array.from(new Set((Array.isArray(hostDockerSocketsOption)
        ? hostDockerSocketsOption
        : dockerSocketDetector({ env, fs: fsModule }))
        .map(normalizeSocketPath)
        .filter(Boolean)));

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

        const hostServiceUrl = api.resolveHostServiceUrl(service);
        const alreadyRunning = await dockerUtils.containerExists(service.name);

        if (!alreadyRunning) {
            await dockerUtils.pullImageIfNeeded(service.image);
            await dockerUtils.runContainerWithLogs(service, networkName, trackedContainers, DEBUG);
        } else {
            logger.log(`${service.name} already running.`);
        }

        if (healthUrl) {
            await dockerUtils.waitForHealthyStatus(service.name, healthUrl);
        }

        if (hostServiceUrl) {
            logger.log(`[${service.name}] ✅ Ready (host_service_url: ${hostServiceUrl})`);
        } else {
            logger.log(`[${service.name}] ✅ Ready.`);
        }
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

        if (descriptor.name === 'noona-raven') {
            kavitaDetection = await detectKavitaDataMount();
            kavitaDataMount = kavitaDetection?.mountPath ?? null;

            if (kavitaDataMount) {
                const baseEnv = Array.isArray(serviceDescriptor.env) ? [...serviceDescriptor.env] : [];
                const volumes = Array.isArray(serviceDescriptor.volumes) ? [...serviceDescriptor.volumes] : [];

                volumes.push(`${kavitaDataMount}:/kavita-data`);
                baseEnv.push('APPDATA=/kavita-data', 'KAVITA_DATA_MOUNT=/kavita-data');

                serviceDescriptor = {
                    ...descriptor,
                    env: baseEnv,
                    volumes,
                };
            }
        }

        serviceDescriptor = applyEnvOverrides(serviceDescriptor, envOverrides);

        await api.startService(serviceDescriptor, healthUrl);

        const result = {
            name: descriptor.name,
            category,
            status: 'installed',
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            image: descriptor.image,
            port: descriptor.port ?? null,
        };

        if (descriptor.name === 'noona-raven') {
            result.kavitaDataMount = kavitaDataMount;
            result.kavitaDetection = kavitaDetection;
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
            return [
                ...results,
                ...invalidEntries,
                {
                    name: 'installation',
                    status: 'error',
                    error: error.message,
                },
            ];
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

        return [...results, ...invalidEntries];
    };

    api.bootMinimal = async function bootMinimal() {
        const redis = services.addon['noona-redis'];
        const moon = services.core['noona-moon'];
        const sage = services.core['noona-sage'];

        await api.startService(redis, 'http://noona-redis:8001/');
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
            logger.log('[Warden] 🧪 Minimal mode — launching redis, sage, moon only');
            await api.bootMinimal();
        }

        logger.log(`✅ Warden is ready.`);
        return { mode: SUPER_MODE ? 'super' : 'minimal' };
    };

    return api;
}

export default createWarden;
