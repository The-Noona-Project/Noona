// services/warden/docker/dockerUtilties.mjs
import Docker from 'dockerode';
import fetch from 'node-fetch';
import { debugMSG, log, warn } from '../../../utilities/etc/logger.mjs';

const docker = new Docker();

/**
 * Ensures the Docker network exists (idempotent)
 */
export async function ensureNetwork(dockerInstance, networkName) {
    const networks = await dockerInstance.listNetworks();
    if (!networks.some(n => n.Name === networkName)) {
        log(`Creating Docker network: ${networkName}`);
        await dockerInstance.createNetwork({ Name: networkName });
    }
}

/**
 * Attaches the Warden container to the Docker network if not already connected
 */
export async function attachSelfToNetwork(dockerInstance, networkName) {
    const id = process.env.HOSTNAME;
    const info = await dockerInstance.getContainer(id).inspect();
    const networks = info?.NetworkSettings?.Networks || {};

    if (!networks[networkName]) {
        log(`Attaching Warden to Docker network: ${networkName}`);
        await dockerInstance.getNetwork(networkName).connect({ Container: id });
    }
}

/**
 * Checks whether a container by name exists (running or stopped)
 */
export async function containerExists(name) {
    const list = await docker.listContainers({ all: true });
    return list.some(c => c.Names.includes(`/${name}`));
}

/**
 * Pulls a Docker image if not already present
 */
export async function pullImageIfNeeded(image) {
    const images = await docker.listImages();
    const exists = images.some(i => i.RepoTags?.includes(image));

    if (exists) {
        debugMSG(`[dockerUtil] 🐳 Image already present: ${image}`);
        return;
    }

    log(`Pulling image: ${image}`);
    await new Promise((resolve, reject) => {
        docker.pull(image, (err, stream) => {
            if (err) return reject(err);
            docker.modem.followProgress(
                stream,
                resolve,
                (event) => {
                    if (event.status) {
                        process.stdout.write(`\r[warden] ${event.status} ${event.progress || ''}  `);
                    }
                }
            );
        });
    });

    log(`\nPull complete for ${image}`);
}

/**
 * Creates and starts a container, attaches logs if DEBUG=true or required
 */
export async function runContainerWithLogs(service, networkName, trackedContainers, DEBUG) {
    const binds = service.volumes || [];

    // Avoid double-injecting SERVICE_NAME
    const envVars = [...(service.env || [])];
    if (!envVars.some(e => e.startsWith('SERVICE_NAME='))) {
        envVars.push(`SERVICE_NAME=${service.name}`);
    }

    const exposed = service.exposed || {};
    const ports = service.ports || {};

    const container = await docker.createContainer({
        name: service.name,
        Image: service.image,
        Env: envVars,
        ExposedPorts: exposed,
        HostConfig: {
            PortBindings: ports,
            Binds: binds.length ? binds : undefined,
        },
        NetworkingConfig: {
            EndpointsConfig: {
                [networkName]: {},
            },
        },
    });

    trackedContainers.add(service.name);
    await container.start();

    const showLogs = service.name !== 'noona-redis' || DEBUG;
    if (showLogs) {
        const logs = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 10,
        });

        logs.on('data', chunk => {
            const line = chunk.toString().trim();
            if (line) process.stdout.write(`[${service.name}] ${line}\n`);
        });
    }

    log(`${service.name} is now running.`);
}

/**
 * Waits for a service's HTTP healthcheck to return 200 OK
 */
export async function waitForHealthyStatus(name, url, tries = 20, delay = 1000) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                debugMSG(`[dockerUtil] ✅ ${name} is healthy after ${i + 1} tries`);
                return;
            }
        } catch (err) {
            debugMSG(`[dockerUtil] Waiting for ${name}... attempt ${i + 1}`);
        }

        await new Promise(r => setTimeout(r, delay));
        process.stdout.write('.');
    }

    throw new Error(`[dockerUtil] ❌ ${name} did not become healthy in time`);
}
