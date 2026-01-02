import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import dockerManager from './dockerManager.mjs';

const {
    createContainerOptions,
    normalizeHostDockerSocketOverride,
    resolveDockerSocketBinding
} = dockerManager.__internals;

const TEST_IMAGE = 'example';

const buildEnv = (service) => ({ SERVICE_NAME: `noona-${service}` });

test('createContainerOptions binds Windows Docker pipe when on win32', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['npipe:////./pipe/docker_engine'],
        platform: 'win32',
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['//./pipe/docker_engine:/var/run/docker.sock']);
    assert.ok(options.hostConfig.Binds.every(entry => entry.endsWith(':/var/run/docker.sock')));
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '//./pipe/docker_engine,/var/run/docker.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
});

test('normalizeHostDockerSocketOverride canonicalizes Windows pipe overrides without dot segment', () => {
    assert.equal(
        normalizeHostDockerSocketOverride('//pipe/docker_engine'),
        '//./pipe/docker_engine'
    );
    assert.equal(
        normalizeHostDockerSocketOverride('\\\\pipe\\docker_engine'),
        '//./pipe/docker_engine'
    );
});

test('createContainerOptions binds canonical Windows pipe override when dot is omitted', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['/var/run/docker.sock'],
        platform: 'win32',
        hostDockerSocketOverride: '//pipe/docker_engine'
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['//./pipe/docker_engine:/var/run/docker.sock']);
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '//./pipe/docker_engine,/var/run/docker.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
});

test('createContainerOptions binds Unix Docker socket on non-Windows platforms', async () => {
    const { options } = await createContainerOptions('portal', TEST_IMAGE, buildEnv('portal'), {
        detectDockerSockets: () => ['//./pipe/docker_engine', '/var/run/docker.sock'],
        platform: 'linux',
        validateSocket: async () => ({ ok: true })
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock']);
});

test('createContainerOptions prefers Docker Desktop raw socket when detected', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['/var/run/docker.sock.raw', '/var/run/docker.sock'],
        platform: 'linux',
        validateSocket: async () => ({ ok: true })
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/var/run/docker.sock.raw:/var/run/docker.sock']);
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '/var/run/docker.sock.raw,/var/run/docker.sock');
});

test('createContainerOptions keeps explicit host socket env overrides for warden', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, {
        ...buildEnv('warden'),
        NOONA_HOST_DOCKER_SOCKETS: '/custom.sock',
        HOST_DOCKER_SOCKETS: '/custom.sock'
    }, {
        detectDockerSockets: () => ['/var/run/docker.sock'],
        platform: 'linux'
    });

    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '/custom.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, '/custom.sock');
});

test('createContainerOptions applies host socket override when provided', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['/var/run/docker.sock'],
        platform: 'linux',
        hostDockerSocketOverride: 'unix:///custom/docker.sock',
        validateSocket: async () => ({ ok: true })
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/custom/docker.sock:/var/run/docker.sock']);
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '/custom/docker.sock,/var/run/docker.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
});

test('createContainerOptions propagates remote docker override without binding socket', async () => {
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['/var/run/docker.sock'],
        platform: 'linux',
        hostDockerSocketOverride: 'tcp://docker-proxy:2375'
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, []);
    assert.equal(options.env.DOCKER_HOST, 'tcp://docker-proxy:2375');
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, 'tcp://docker-proxy:2375');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
});

test('createContainerOptions injects detected remote DOCKER_HOST endpoint for warden', async () => {
    const remoteHost = 'tcp://docker-remote.internal:2375';
    const { options } = await createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => [remoteHost],
        platform: 'linux'
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, []);
    assert.equal(options.env.DOCKER_HOST, remoteHost);
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, remoteHost);
    assert.equal(options.env.HOST_DOCKER_SOCKETS, remoteHost);
});

test('resolveDockerSocketBinding falls back to platform defaults when none detected', () => {
    const windowsBinding = resolveDockerSocketBinding({
        detectSockets: () => [],
        platform: 'win32',
    });
    assert.equal(windowsBinding, '//./pipe/docker_engine');

    const unixBinding = resolveDockerSocketBinding({
        detectSockets: () => [],
        platform: 'linux',
    });
    assert.equal(unixBinding, '/var/run/docker.sock');
});

test('start refuses to launch warden when host Docker socket is missing', async () => {
    const missingSocket = join(tmpdir(), `noona-missing-docker-${Date.now()}.sock`);
    const { dockerHost } = dockerManager.__internals;
    const originalInspectNetwork = dockerHost.inspectNetwork;
    const originalCreateNetwork = dockerHost.createNetwork;
    const originalRemoveResources = dockerHost.removeResources;
    const originalStartService = dockerHost.startService;
    let removalAttempts = 0;
    const startCalls = [];

    dockerHost.inspectNetwork = async () => ({ ok: true, data: {} });
    dockerHost.createNetwork = async () => ({ ok: true });
    dockerHost.removeResources = async () => { removalAttempts += 1; return { ok: true }; };
    dockerHost.startService = async (options) => { startCalls.push(options); return { ok: true }; };

    try {
        const result = await dockerManager.start({
            services: ['warden'],
            hostDockerSocketOverride: missingSocket,
            bindHostDockerSocket: true
        });

        assert.equal(result.ok, false);
        const wardenResult = result.results.find(entry => entry.service === 'warden');
        assert.ok(wardenResult);
        assert.equal(wardenResult.ok, false);
        assert.ok(wardenResult.warnings?.length > 0);
        assert.equal(startCalls.length, 0);
        assert.equal(removalAttempts, 0);
    } finally {
        dockerHost.inspectNetwork = originalInspectNetwork;
        dockerHost.createNetwork = originalCreateNetwork;
        dockerHost.removeResources = originalRemoveResources;
        dockerHost.startService = originalStartService;
    }
});
