import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dockerHost, {
    buildImage,
    runContainer,
    stopContainer,
    removeResources,
    inspectNetwork,
    pushImage,
    pullImage
} from './dockerHost.mjs';

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
