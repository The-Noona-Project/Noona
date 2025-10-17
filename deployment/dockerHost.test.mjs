import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dockerHost, {
    buildImage,
    runContainer,
    startService,
    streamLogs,
    waitForHealth,
    stopContainer,
    removeResources,
    inspectNetwork,
    pushImage,
    pullImage
} from './dockerHost.mjs';
import { Readable } from 'node:stream';

const withFakeDocker = fake => {
    dockerHost.docker = fake;
    return fake;
};

test('buildImage forwards options to Docker and surfaces warnings', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'dockerhost-'));
    await mkdir(join(tmp, 'deployment'));
    await writeFile(join(tmp, 'deployment', 'test.Dockerfile'), 'FROM scratch\n');

    const fake = withFakeDocker({
        modem: {
            followProgress: (stream, done, onProgress) => {
                fake.followedStream = stream;
                onProgress({ stream: 'warning: cached layer' });
                done(null, [{ stream: 'done' }]);
            }
        },
        async buildImage(stream, options) {
            fake.receivedStream = stream;
            fake.options = options;
            return 'build-stream';
        }
    });

    const result = await buildImage({
        context: tmp,
        dockerfile: join(tmp, 'deployment', 'test.Dockerfile'),
        tag: 'example:latest',
        noCache: true
    });

    assert.equal(fake.options.dockerfile, 'deployment/test.Dockerfile');
    assert.equal(fake.options.t, 'example:latest');
    assert.equal(fake.options.nocache, true);
    assert.ok(result.ok);
    assert.deepEqual(result.warnings, ['warning: cached layer']);
    assert.equal(fake.followedStream, 'build-stream');
});

test('pushImage and pullImage stream progress', async () => {
    const tracked = { pushes: [], pulls: [] };
    const fake = withFakeDocker({
        modem: {
            followProgress: (stream, done) => {
                tracked.followed = stream;
                done(null, [{ status: 'ok' }]);
            }
        },
        getImage(reference) {
            return {
                async push() {
                    tracked.pushes.push(reference);
                    return 'push-stream';
                }
            };
        },
        async pull(reference) {
            tracked.pulls.push(reference);
            return 'pull-stream';
        }
    });

    const pushResult = await pushImage({ reference: 'example:latest' });
    assert.ok(pushResult.ok);
    assert.deepEqual(tracked.pushes, ['example:latest']);

    const pullResult = await pullImage({ reference: 'example:latest' });
    assert.ok(pullResult.ok);
    assert.deepEqual(tracked.pulls, ['example:latest']);
});

test('runContainer wires networking and host configuration', async () => {
    const fake = withFakeDocker({
        modem: { followProgress: () => {} },
        async createContainer(config) {
            fake.config = config;
            return {
                id: 'container-id',
                async start() {
                    fake.started = true;
                }
            };
        }
    });

    const result = await runContainer({
        name: 'noona-warden',
        image: 'captainpax/noona-warden:latest',
        env: { DEBUG: 'false' },
        network: 'noona-network',
        hostConfig: {
            Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
            PortBindings: { '4001/tcp': [{ HostPort: '4001' }] }
        },
        exposedPorts: { '4001/tcp': {} }
    });

    assert.ok(result.ok);
    assert.equal(fake.config.name, 'noona-warden');
    assert.equal(fake.config.HostConfig.AutoRemove, true);
    assert.equal(fake.config.HostConfig.NetworkMode, 'noona-network');
    assert.deepEqual(fake.config.HostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock']);
    assert.deepEqual(fake.config.ExposedPorts, { '4001/tcp': {} });
    assert.deepEqual(fake.config.NetworkingConfig, { EndpointsConfig: { 'noona-network': {} } });
    assert.equal(fake.started, true);
});

test('stopContainer gracefully handles missing containers', async () => {
    const fake = withFakeDocker({
        modem: { followProgress: () => {} },
        getContainer() {
            return {
                async stop() {
                    const error = new Error('missing');
                    error.statusCode = 404;
                    throw error;
                }
            };
        }
    });

    const result = await stopContainer({ name: 'ghost' });
    assert.ok(result.ok);
    assert.equal(result.data.skipped, true);
});

test('removeResources removes matched resources only', async () => {
    const fake = {
        modem: { followProgress: () => {} },
        async listContainers(options) {
            this.containerFilters = options;
            const items = [
                { Id: '1', Names: ['/noona-foo'] },
                { Id: '2', Names: ['/other'] }
            ];
            const filters = options.filters?.name || [];
            if (filters.length) {
                return items.filter(item => item.Names.some(name => filters.some(f => name.includes(f))));
            }
            return items;
        },
        async listImages() {
            return [
                { Id: 'img1', RepoTags: ['captainpax/noona-foo:latest'] },
                { Id: 'img2', RepoTags: ['other:latest'] }
            ];
        },
        async listVolumes(options) {
            this.volumeFilters = options;
            const items = [
                { Name: 'noona-vol' },
                { Name: 'other-vol' }
            ];
            const filters = options.filters?.name || [];
            const filtered = filters.length
                ? items.filter(item => filters.some(f => item.Name.includes(f)))
                : items;
            return { Volumes: filtered };
        },
        async listNetworks(options) {
            this.networkFilters = options;
            return [
                { Id: 'net1', Name: 'noona-network' },
                { Id: 'net2', Name: 'bridge' }
            ];
        }
    };

    fake.getContainer = function getContainer(id) {
        return {
            async remove(opts) {
                if (!fake.removedContainers) fake.removedContainers = [];
                fake.removedContainers.push({ id, opts });
            }
        };
    };

    fake.getImage = function getImage(id) {
        return {
            async remove() {
                if (!fake.removedImages) fake.removedImages = [];
                fake.removedImages.push(id);
            }
        };
    };

    fake.getVolume = function getVolume(name) {
        return {
            async remove() {
                if (!fake.removedVolumes) fake.removedVolumes = [];
                fake.removedVolumes.push(name);
            }
        };
    };

    fake.getNetwork = function getNetwork(id) {
        return {
            async remove() {
                if (!fake.removedNetworks) fake.removedNetworks = [];
                fake.removedNetworks.push(id);
            }
        };
    };

    withFakeDocker(fake);

    const result = await removeResources({
        containers: { filters: { name: ['noona-'] } },
        images: { match: tag => tag.startsWith('captainpax/noona-') },
        volumes: { filters: { name: ['noona-'] } },
        networks: { names: ['noona-network'] }
    });

    assert.ok(result.ok);
    assert.deepEqual(fake.containerFilters.filters.name, ['noona-']);
    assert.deepEqual(fake.removedContainers, [{ id: '1', opts: { force: true, v: false } }]);
    assert.deepEqual(fake.removedImages, ['img1']);
    assert.deepEqual(fake.removedVolumes, ['noona-vol']);
    assert.deepEqual(fake.removedNetworks, ['net1']);
    assert.deepEqual(result.data.containers, ['/noona-foo']);
});

test('inspectNetwork returns structured error when not found', async () => {
    const fake = withFakeDocker({
        modem: { followProgress: () => {} },
        getNetwork() {
            return {
                async inspect() {
                    const error = new Error('not found');
                    error.statusCode = 404;
                    throw error;
                }
            };
        }
    });

    const result = await inspectNetwork('ghost');
    assert.equal(result.ok, false);
    assert.equal(result.error.context.notFound, true);
});

test('startService validates network attachment and waits for health', async () => {
    withFakeDocker({
        modem: { followProgress: () => {} },
        getContainer() {
            return {
                async inspect() {
                    return {
                        Name: '/noona-warden',
                        NetworkSettings: { Networks: { 'noona-network': {} } },
                        State: { Status: 'running' }
                    };
                }
            };
        }
    });

    const originalRunContainer = dockerHost.runContainer;
    const originalWaitForHealth = dockerHost.waitForHealth;
    dockerHost.runContainer = async () => ({ ok: true, data: { id: 'abc123' } });
    let waited = false;
    dockerHost.waitForHealth = async ({ name, url }) => {
        waited = name === 'noona-warden' && url === 'http://localhost:4001/health';
        return { ok: true, data: { attempts: 1, status: 200 } };
    };

    const result = await startService({
        name: 'noona-warden',
        image: 'captainpax/noona-warden:latest',
        network: 'noona-network',
        healthCheck: { url: 'http://localhost:4001/health', interval: 5, timeout: 10 }
    });

    assert.ok(result.ok);
    assert.equal(waited, true);
    assert.equal(result.data.health.status, 200);
    assert.deepEqual(result.data.inspection.NetworkSettings.Networks, { 'noona-network': {} });

    dockerHost.runContainer = originalRunContainer;
    dockerHost.waitForHealth = originalWaitForHealth;
});

test('startService reports failure when network attachment is missing', async () => {
    withFakeDocker({
        modem: { followProgress: () => {} },
        getContainer() {
            return {
                async inspect() {
                    return { NetworkSettings: { Networks: {} } };
                }
            };
        }
    });

    const originalRunContainer = dockerHost.runContainer;
    dockerHost.runContainer = async () => ({ ok: true, data: { id: 'abc123' } });

    const result = await startService({
        name: 'noona-warden',
        image: 'captainpax/noona-warden:latest',
        network: 'noona-network'
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.context.networkAttached, false);

    dockerHost.runContainer = originalRunContainer;
});

test('streamLogs forwards log lines to the callback', async () => {
    withFakeDocker({
        modem: { followProgress: () => {} },
        getContainer() {
            return {
                async logs() {
                    return Readable.from(['line one\nline two\n']);
                }
            };
        }
    });

    const received = [];
    const result = await streamLogs({
        name: 'noona-warden',
        follow: false,
        tail: 10,
        onData: line => received.push(line)
    });

    assert.ok(result.ok);
    await new Promise(resolve => result.data.stream.on('end', resolve));
    assert.deepEqual(received, ['line one', 'line two']);
});

test('waitForHealth resolves after receiving a successful response', async () => {
    const originalFetch = globalThis.fetch;
    const responses = [
        { ok: false, status: 503 },
        { ok: true, status: 200 }
    ];

    globalThis.fetch = async () => {
        const res = responses.shift();
        if (!res) {
            throw new Error('no more responses');
        }
        return res;
    };

    try {
        const result = await waitForHealth({
            name: 'noona-warden',
            url: 'http://localhost:4001/health',
            interval: 5,
            timeout: 30
        });

        assert.ok(result.ok);
        assert.equal(result.data.status, 200);
        assert.equal(result.data.attempts, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('waitForHealth surfaces remediation guidance on failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error('ECONNREFUSED');
    };

    try {
        const result = await waitForHealth({
            name: 'noona-warden',
            url: 'http://localhost:4001/health',
            interval: 5,
            timeout: 20
        });

        assert.equal(result.ok, false);
        assert.match(result.error.context.remediation, /Docker socket/);
        assert.equal(result.error.operation, 'waitForHealth');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
