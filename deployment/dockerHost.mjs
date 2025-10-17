import Docker from 'dockerode';
import { pack } from 'tar-fs';
import ignore from 'ignore';
import { access, readFile } from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';
import { normalizeDockerSocket } from '../utilities/etc/dockerSockets.mjs';

const DEFAULT_SOCKET = '/var/run/docker.sock';

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

export class DockerHost {
    constructor(options = {}) {
        const { createDocker = (cfg) => new Docker(cfg), ...dockerOptions } = options;
        const hasOwn = (key) => Object.prototype.hasOwnProperty.call(dockerOptions, key);

        const config = { socketPath: DEFAULT_SOCKET, ...dockerOptions };

        if (typeof config.socketPath === 'string') {
            const normalized = normalizeDockerSocket(config.socketPath);
            if (normalized) {
                config.socketPath = normalized;
            }
        }

        if (process.env.DOCKER_HOST && !hasOwn('host') && !hasOwn('socketPath')) {
            const host = process.env.DOCKER_HOST;
            const normalizedSocket = normalizeDockerSocket(host);

            if (normalizedSocket) {
                config.socketPath = normalizedSocket;
                delete config.host;
                delete config.port;
                delete config.protocol;
            } else {
                const url = new URL(host);
                config.host = url.hostname;
                config.port = url.port || 2375;
                config.protocol = url.protocol.replace(':', '');
                delete config.socketPath;
            }
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
                dockerfile: relative(context, dockerfile) || dockerfile,
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

export const buildImage = options => dockerHost.buildImage(options);
export const pushImage = options => dockerHost.pushImage(options);
export const pullImage = options => dockerHost.pullImage(options);
export const runContainer = options => dockerHost.runContainer(options);
export const startService = options => dockerHost.startService(options);
export const streamLogs = options => dockerHost.streamLogs(options);
export const waitForHealth = options => dockerHost.waitForHealth(options);
export const stopContainer = options => dockerHost.stopContainer(options);
export const removeResources = options => dockerHost.removeResources(options);
export const inspectNetwork = name => dockerHost.inspectNetwork(name);
export const createNetwork = options => dockerHost.createNetwork(options);
export const listContainers = options => dockerHost.listContainers(options);
export default dockerHost;
