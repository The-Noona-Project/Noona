// services/warden/docker/dockerUtilties.mjs
import Docker from 'dockerode';
import fetch from 'node-fetch';
import { debugMSG, log, warn } from '../../../utilities/etc/logger.mjs';

const docker = new Docker();

const escapeRegExp = (value) => String(value ?? '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const formatProgressDetail = (event = {}) => {
    if (typeof event.progress === 'string') {
        const trimmed = event.progress.trim();
        if (trimmed) {
            return trimmed;
        }
    }

    const detail = event.progressDetail;
    if (detail && typeof detail === 'object') {
        const { current, total } = detail;

        const isFiniteNumber = (value) => Number.isFinite(value) && value >= 0;
        if (isFiniteNumber(current) && isFiniteNumber(total) && total > 0) {
            return `${current}/${total}`;
        }

        if (isFiniteNumber(current)) {
            return `${current}`;
        }
    }

    if (event.detail != null) {
        const stringified = String(event.detail).trim();
        if (stringified) {
            return stringified;
        }
    }

    return '';
};

export const formatDockerProgressMessage = ({ layerId, phase, status, detail } = {}) => {
    const parts = [];
    const label = phase || status || '';

    if (layerId) {
        parts.push(`[${layerId}]`);
    }

    if (label) {
        parts.push(label);
    }

    if (detail) {
        parts.push(detail);
    }

    return parts.join(' ').trim();
};

export const normalizeDockerProgressEvent = (event = {}, { fallbackId } = {}) => {
    const rawId = event.id ?? fallbackId ?? null;
    const hasStatus = typeof event.status === 'string' && event.status.trim();
    const phase = hasStatus ? event.status.trim() : null;
    const status = hasStatus ? phase : 'progress';
    const detail = formatProgressDetail(event);
    const progressDetail =
        event.progressDetail && typeof event.progressDetail === 'object'
            ? { ...event.progressDetail }
            : null;

    const payload = {
        id: rawId ?? fallbackId ?? null,
        status,
        detail,
        layerId: rawId ?? null,
        phase,
        progressDetail,
    };

    const message = formatDockerProgressMessage(payload);
    if (message) {
        payload.message = message;
    }

    return payload;
};

const buildNameMatcher = (target) => {
    const escaped = escapeRegExp(target);
    // Matches exact container names as well as common docker-compose naming patterns:
    //   project_service_1, project-service-1, etc.
    return new RegExp(`(^|[._-])${escaped}([._-]\\d+)?$`, 'i');
};

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
export async function containerExists(name, options = {}) {
    if (!name) {
        return false;
    }

    const { dockerInstance = docker } = options;
    const list = await dockerInstance.listContainers({ all: true });
    const target = name.toLowerCase();
    const matcher = buildNameMatcher(target);

    const matches = (rawName = '') => {
        if (!rawName) {
            return false;
        }

        const normalized = rawName.replace(/^\//, '').toLowerCase();
        if (normalized === target) {
            return true;
        }

        return matcher.test(normalized);
    };

    return list.some((container = {}) => {
        const names = Array.isArray(container.Names) ? container.Names : [];
        return names.some(matches);
    });
}

/**
 * Pulls a Docker image if not already present
 */
export async function pullImageIfNeeded(image, options = {}) {
    const { dockerInstance = docker, onProgress } = options;

    const images = await dockerInstance.listImages();
    const exists = images.some(i => i.RepoTags?.includes(image));

    if (exists) {
        debugMSG(`[dockerUtil] 🐳 Image already present: ${image}`);
        const payload = normalizeDockerProgressEvent(
            { id: image, status: 'exists', detail: 'Image already present' },
            { fallbackId: image },
        );
        onProgress?.(payload);
        return;
    }

    log(`Pulling image: ${image}`);
    await new Promise((resolve, reject) => {
        dockerInstance.pull(image, (err, stream) => {
            if (err) return reject(err);
            dockerInstance.modem.followProgress(
                stream,
                resolve,
                (event) => {
                    const payload = normalizeDockerProgressEvent(event, { fallbackId: image });
                    if (payload.message) {
                        process.stdout.write(`\r[warden] ${payload.message}  `);
                    }
                    onProgress?.(payload);
                }
            );
        });
    });

    const completionMessage = `\nPull complete for ${image}`;
    log(completionMessage);
    const payload = normalizeDockerProgressEvent(
        { id: image, status: 'complete', detail: 'Image pulled successfully' },
        { fallbackId: image },
    );
    onProgress?.(payload);
}

/**
 * Create and start a Docker container for the given service and optionally stream its logs.
 *
 * Ensures the service's environment includes `SERVICE_NAME`, creates the container attached to the specified network,
 * records the service name in `trackedContainers`, starts the container, and conditionally streams its stdout/stderr
 * to stdout when `DEBUG` is set to a truthy debug value (`"true"`, `"1"`, `"yes"`, or `"super"`).
 *
 * @param {Object} service - Service descriptor with properties such as `name`, `image`, `env`, `volumes`, `exposed`, and `ports`.
 * @param {string} networkName - Name of the Docker network to attach the container to.
 * @param {Set<string>} trackedContainers - Set used to record the started container's service name.
 * @param {string|boolean|undefined} DEBUG - Debug flag that enables log streaming when set to a recognized truthy value.
 */
export async function runContainerWithLogs(
    service,
    networkName,
    trackedContainers,
    DEBUG,
    options = {},
) {
    const binds = service.volumes || [];

    // Avoid double-injecting SERVICE_NAME
    const envVars = [...(service.env || [])];
    if (!envVars.some(e => e.startsWith('SERVICE_NAME='))) {
        envVars.push(`SERVICE_NAME=${service.name}`);
    }

    const exposed = service.exposed || {};
    const ports = service.ports || {};

    const debugValue = (DEBUG || '').toString().toLowerCase();
    const shouldStreamLogs = ['true', '1', 'yes', 'super'].includes(debugValue);

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

    const { onLog } = options;

    try {
        const logs = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 10,
        });

        logs.on('data', chunk => {
            const raw = chunk.toString();
            if (!raw) {
                return;
            }

            onLog?.(raw, { service });

            if (shouldStreamLogs) {
                const line = raw.trim();
                if (line) {
                    process.stdout.write(`[${service.name}] ${line}\n`);
                }
            }
        });

        logs.on('error', error => {
            onLog?.(`Log stream error: ${error.message}`, { service, level: 'error' });
        });
    } catch (error) {
        debugMSG(`[dockerUtil] Unable to tail logs for ${service.name}: ${error.message}`);
        onLog?.(`Failed to stream logs: ${error.message}`, { service, level: 'error' });
    }

    if (!shouldStreamLogs) {
        debugMSG(`[dockerUtil] Log streaming disabled for ${service.name}`);
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
