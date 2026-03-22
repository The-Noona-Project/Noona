// services/warden/docker/dockerUtilties.mjs
import fs from 'node:fs';
import path from 'node:path';

import Docker from 'dockerode';
import fetch from 'node-fetch';
import {debugMSG, log, warn} from '../../../utilities/etc/logger.mjs';
import {isLikelyNamedDockerVolume} from './storageLayout.mjs';

const docker = new Docker();
const TRUTHY_BOOLEAN_VALUES = new Set(['1', 'true', 'yes', 'on']);

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

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

const parseBindMountEntry = (entry) => {
    if (typeof entry !== 'string') {
        return null;
    }

    const trimmed = entry.trim();
    if (!trimmed || trimmed.startsWith('\\\\.\\pipe\\')) {
        return null;
    }

    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed)) {
        const separatorIndex = trimmed.indexOf(':', 2);
        if (separatorIndex < 0) {
            return null;
        }

        return {
            source: trimmed.slice(0, separatorIndex),
        };
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex < 0) {
        return null;
    }

    return {
        source: trimmed.slice(0, separatorIndex),
    };
};

const ensureBindMountDirectories = (entries = []) => {
    for (const entry of entries) {
        const parsed = parseBindMountEntry(entry);
        if (!parsed?.source) {
            continue;
        }

        if (isLikelyNamedDockerVolume(parsed.source)) {
            continue;
        }

        const sourcePath = path.isAbsolute(parsed.source)
            ? parsed.source
            : path.resolve(process.cwd(), parsed.source);

        try {
            fs.mkdirSync(sourcePath, {recursive: true});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn(`[dockerUtil] Failed to ensure bind mount folder '${sourcePath}': ${message}`);
        }
    }
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
export const isWardenHostProcessMode = (env = process.env) =>
    TRUTHY_BOOLEAN_VALUES.has(String(env?.WARDEN_RUN_OUTSIDE_DOCKER ?? '').trim().toLowerCase());

/**
 * Attaches the running Warden container to the requested Docker network.
 *
 * When Warden is intentionally running outside Docker, callers must explicitly
 * opt into host-process mode via WARDEN_RUN_OUTSIDE_DOCKER=true (or
 * allowHostProcess) so missing container lookup is treated as an expected skip
 * rather than a silent bootstrap success.
 */
export async function attachSelfToNetwork(dockerInstance, networkName, options = {}) {
    const env = options?.env ?? process.env;
    const allowHostProcess = options?.allowHostProcess ?? isWardenHostProcessMode(env);
    const hostId = env?.HOSTNAME ?? process.env.HOSTNAME;
    const fallbackId = env?.SERVICE_NAME ?? process.env.SERVICE_NAME ?? 'noona-warden';
    let containerId = hostId;
    let info;

    if (hostId) {
        try {
            info = await dockerInstance.getContainer(hostId).inspect();
        } catch (error) {
            if (error?.statusCode === 404) {
                warn(`[dockerUtil] HOSTNAME '${hostId}' not found when attaching to ${networkName}. Falling back to SERVICE_NAME '${fallbackId}'.`);
                containerId = fallbackId;
            } else {
                throw error;
            }
        }
    } else {
        warn(`[dockerUtil] HOSTNAME env not set. Falling back to SERVICE_NAME '${fallbackId}'.`);
        containerId = fallbackId;
    }

    if (!info) {
        try {
            info = await dockerInstance.getContainer(containerId).inspect();
        } catch (error) {
            if (error?.statusCode === 404) {
                if (allowHostProcess) {
                    warn(
                        `[dockerUtil] Unable to locate container '${containerId}' while attaching to network '${networkName}', but Warden is configured to run outside Docker. Skipping self-attach.`,
                    );
                    return;
                }

                const attachError = new Error(
                    `[dockerUtil] Unable to locate Warden container '${containerId}' while attaching to network '${networkName}'. Containerized Warden must run as '${fallbackId}' (or set WARDEN_RUN_OUTSIDE_DOCKER=true when running directly on the host).`,
                );
                attachError.code = 'WARDEN_SELF_ATTACH_CONTAINER_NOT_FOUND';
                throw attachError;
            }
            throw error;
        }
    }

    const networks = info?.NetworkSettings?.Networks || {};

    if (!networks[networkName]) {
        log(`Attaching Warden to Docker network: ${networkName}`);
        await dockerInstance.getNetwork(networkName).connect({ Container: containerId });
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
 * Removes containers that match the provided service name.
 *
 * Uses the same matcher as containerExists so compose-style names such as
 * stack_noona-vault_1 are handled consistently.
 */
export async function removeContainers(name, options = {}) {
    if (!name) {
        return [];
    }

    const {dockerInstance = docker} = options;
    const list = await dockerInstance.listContainers({all: true});
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

    const matched = list.filter((container = {}) => {
        const names = Array.isArray(container.Names) ? container.Names : [];
        return names.some(matches);
    });

    for (const container of matched) {
        try {
            await dockerInstance.getContainer(container.Id).remove({force: true});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            debugMSG(`[dockerUtil] Failed to remove container ${container.Id}: ${message}`);
        }
    }

    return matched.map((container) => container.Id);
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

const normalizeDeviceMappings = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
        return undefined;
    }

    const devices = [];
    for (const entry of value) {
        if (!entry) {
            continue;
        }

        if (typeof entry === 'string') {
            const [hostPath = '', containerPath = '', permissions = 'rwm'] = entry.split(':');
            const normalizedHostPath = hostPath.trim();
            const normalizedContainerPath = (containerPath || hostPath || '').trim();
            if (!normalizedHostPath || !normalizedContainerPath) {
                continue;
            }
            devices.push({
                PathOnHost: normalizedHostPath,
                PathInContainer: normalizedContainerPath,
                CgroupPermissions: (permissions || 'rwm').trim() || 'rwm',
            });
            continue;
        }

        if (typeof entry === 'object') {
            const normalizedHostPath = String(entry.PathOnHost || entry.pathOnHost || '').trim();
            const normalizedContainerPath = String(entry.PathInContainer || entry.pathInContainer || '').trim();
            if (!normalizedHostPath || !normalizedContainerPath) {
                continue;
            }
            devices.push({
                PathOnHost: normalizedHostPath,
                PathInContainer: normalizedContainerPath,
                CgroupPermissions: String(entry.CgroupPermissions || entry.cgroupPermissions || 'rwm').trim() || 'rwm',
            });
        }
    }

    return devices.length > 0 ? devices : undefined;
};

const resolveServiceNetworks = (service, networkName) => {
    const configuredNetworks = Array.isArray(service?.networks) ? service.networks : [];
    const candidates = configuredNetworks.length > 0 ? configuredNetworks : [networkName];

    return Array.from(
        new Set(
            candidates
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean),
        ),
    );
};

const toDockerDurationNs = (value) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed * 1_000_000;
};

const normalizeDockerHealthcheck = (healthCheck) => {
    if (!healthCheck || typeof healthCheck !== 'object' || healthCheck.type !== 'docker') {
        return undefined;
    }

    const test = Array.isArray(healthCheck.test)
        ? healthCheck.test.map((entry) => String(entry))
        : null;
    if (!test || test.length === 0) {
        return undefined;
    }

    return {
        Test: test,
        Interval: toDockerDurationNs(healthCheck.intervalMs),
        Timeout: toDockerDurationNs(healthCheck.timeoutMs),
        StartPeriod: toDockerDurationNs(healthCheck.startPeriodMs),
        Retries: Number.isFinite(Number(healthCheck.retries))
            ? Math.max(1, Math.floor(Number(healthCheck.retries)))
            : undefined,
    };
};

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
    const { dockerInstance = docker, onLog } = options;
    const binds = service.volumes || [];
    ensureBindMountDirectories(binds);

    // Avoid double-injecting SERVICE_NAME
    const envVars = [...(service.env || [])];
    if (!envVars.some(e => e.startsWith('SERVICE_NAME='))) {
        envVars.push(`SERVICE_NAME=${service.name}`);
    }

    const exposed = service.exposed || {};
    const ports = service.ports || {};
    const capAdd = Array.isArray(service.capAdd) && service.capAdd.length > 0 ? service.capAdd : undefined;
    const devices = normalizeDeviceMappings(service.devices);
    const serviceNetworks = resolveServiceNetworks(service, networkName);
    const primaryNetwork = serviceNetworks[0];
    const healthcheck = normalizeDockerHealthcheck(service.healthCheck);

    const debugValue = (DEBUG || '').toString().toLowerCase();
    const shouldStreamLogs = ['true', '1', 'yes', 'super'].includes(debugValue);

    const container = await dockerInstance.createContainer({
        name: service.name,
        Image: service.image,
        Env: envVars,
        ExposedPorts: exposed,
        HostConfig: {
            PortBindings: ports,
            Binds: binds.length ? binds : undefined,
            RestartPolicy: service.restartPolicy || undefined,
            CapAdd: capAdd,
            Devices: devices,
            NetworkMode: primaryNetwork,
        },
        User: service.user || undefined,
        Healthcheck: healthcheck,
        NetworkingConfig: {
            EndpointsConfig: {
                [primaryNetwork]: {},
            },
        },
    });

    trackedContainers.add(service.name);
    await container.start();

    for (const extraNetwork of serviceNetworks.slice(1)) {
        try {
            await dockerInstance.getNetwork(extraNetwork).connect({Container: container.id || service.name});
        } catch (error) {
            const statusCode = Number.parseInt(String(error?.statusCode ?? error?.status ?? ''), 10);
            const message = error instanceof Error ? error.message : String(error);
            if (statusCode !== 409 && !/already exists|already connected/i.test(message)) {
                throw error;
            }
        }
    }

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

export async function waitForContainerHealthy(name, options = {}) {
    const {
        dockerInstance = docker,
        tries = 20,
        delay = 1000,
    } = options;

    for (let attempt = 0; attempt < tries; attempt += 1) {
        try {
            const inspection = await dockerInstance.getContainer(name).inspect();
            const state = inspection?.State || {};
            const running = state.Running === true;
            const healthStatus = typeof state?.Health?.Status === 'string'
                ? state.Health.Status.trim().toLowerCase()
                : '';

            if (running && healthStatus === 'healthy') {
                debugMSG(`[dockerUtil] ${name} is healthy after ${attempt + 1} tries`);
                return inspection;
            }

            if (!running) {
                debugMSG(`[dockerUtil] Waiting for ${name} to start... attempt ${attempt + 1}`);
            } else {
                debugMSG(`[dockerUtil] Waiting for ${name} Docker health (${healthStatus || 'starting'})... attempt ${attempt + 1}`);
            }
        } catch (error) {
            debugMSG(`[dockerUtil] Waiting for ${name} Docker health... attempt ${attempt + 1}`);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        process.stdout.write('.');
    }

    throw new Error(`[dockerUtil] ${name} did not report a healthy Docker status in time`);
}
