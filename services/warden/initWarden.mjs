import Docker from 'dockerode';
import noonaDockers from './docker/noonaDockers.mjs';
import addonDockers from './docker/addonDockers.mjs';
import {
    attachSelfToNetwork,
    containerExists,
    ensureNetwork,
    pullImageIfNeeded,
    runContainerWithLogs,
    waitForHealthyStatus
} from './docker/dockerUtilties.mjs';
import {errMSG, log, warn} from '../../utilities/etc/logger.mjs';

const docker = new Docker();
const networkName = 'noona-network';
const trackedContainers = new Set();

const DEBUG = process.env.DEBUG || 'false';
const SUPER_MODE = DEBUG === 'super';

async function startService(service, healthUrl = null) {
    if (!(await containerExists(service.name))) {
        await pullImageIfNeeded(service.image);
        await runContainerWithLogs(service, networkName, trackedContainers, DEBUG);
    } else {
        log(`${service.name} already running.`);
    }

    if (healthUrl) {
        await waitForHealthyStatus(service.name, healthUrl);
    }
}

async function bootMinimal() {
    const redis = addonDockers['noona-redis'];
    const moon = noonaDockers['noona-moon'];
    const sage = noonaDockers['noona-sage'];

    await startService(redis, 'http://noona-redis:8001/');
    await startService(sage, 'http://noona-sage:3004/health');
    await startService(moon, 'http://noona-moon:3000/');
}

async function bootFull() {
    const services = {
        ...addonDockers,
        ...noonaDockers
    };

    for (const name of Object.keys(services)) {
        const svc = services[name];
        const defaultHealthUrl = svc.port || svc.internalPort
            ? `http://${name}:${svc.internalPort || svc.port}/`
            : null;
        await startService(svc, defaultHealthUrl);
    }
}

/**
 * Gracefully shutdown all tracked containers
 */
async function shutdownAll() {
    warn(`Shutting down all containers...`);
    for (const name of trackedContainers) {
        try {
            const container = docker.getContainer(name);
            await container.stop();
            await container.remove();
            log(`Stopped & removed ${name}`);
        } catch (err) {
            warn(`Error stopping ${name}: ${err.message}`);
        }
    }
    process.exit(0);
}

process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);

async function init() {
    await ensureNetwork(docker, networkName);
    await attachSelfToNetwork(docker, networkName);

    if (SUPER_MODE) {
        log('[Warden] 💥 DEBUG=super — launching full stack...');
        await bootFull();
    } else {
        log('[Warden] 🧪 Minimal mode — launching redis, sage, moon only');
        await bootMinimal();
    }

    log(`✅ Warden is ready.`);
    setInterval(() => process.stdout.write('.'), 60000);
}

init().catch(err => errMSG(`[Warden Init] ❌ Fatal: ${err.message}`));
