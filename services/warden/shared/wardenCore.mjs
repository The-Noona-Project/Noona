// services/warden/shared/wardenCore.mjs
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
    } = options;

    const services = normalizeServices(servicesOption);
    const dockerUtils = normalizeDockerUtils(dockerUtilsOption);
    const logger = createDefaultLogger(loggerOption);
    const serviceCatalog = createServiceCatalog(services);

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

    api.listServices = function listServices() {
        const formatted = Array.from(serviceCatalog.values()).map(({ category, descriptor }) => ({
            name: descriptor.name,
            category,
            image: descriptor.image,
            port: descriptor.port ?? null,
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            description: descriptor.description ?? null,
            health: descriptor.health ?? null,
        }));

        return formatted.sort((a, b) => a.name.localeCompare(b.name));
    };

    api.installService = async function installService(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        const entry = serviceCatalog.get(trimmedName);

        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const { descriptor, category } = entry;
        const healthUrl = descriptor.health || null;
        await api.startService(descriptor, healthUrl);

        return {
            name: descriptor.name,
            category,
            status: 'installed',
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            image: descriptor.image,
            port: descriptor.port ?? null,
        };
    };

    api.installServices = async function installServices(names = []) {
        const results = [];

        for (const candidate of names) {
            const name = typeof candidate === 'string' ? candidate.trim() : '';

            if (!name) {
                results.push({
                    name: candidate ?? null,
                    status: 'error',
                    error: 'Invalid service name provided.',
                });
                continue;
            }

            try {
                const result = await api.installService(name);
                results.push(result);
            } catch (error) {
                results.push({
                    name,
                    status: 'error',
                    error: error.message,
                });
            }
        }

        return results;
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
