import test from 'node:test';
import assert from 'node:assert/strict';
import dockerManager from './dockerManager.mjs';

const { createContainerOptions, resolveDockerSocketBinding } = dockerManager.__internals;

const TEST_IMAGE = 'example';

const buildEnv = (service) => ({ SERVICE_NAME: `noona-${service}` });

test('createContainerOptions binds Windows Docker pipe when on win32', () => {
    const options = createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['npipe:////./pipe/docker_engine'],
        platform: 'win32',
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['//./pipe/docker_engine:/var/run/docker.sock']);
    assert.ok(options.hostConfig.Binds.every(entry => entry.endsWith(':/var/run/docker.sock')));
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '//./pipe/docker_engine,/var/run/docker.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
});

test('createContainerOptions binds Unix Docker socket on non-Windows platforms', () => {
    const options = createContainerOptions('portal', TEST_IMAGE, buildEnv('portal'), {
        detectDockerSockets: () => ['//./pipe/docker_engine', '/var/run/docker.sock'],
        platform: 'linux',
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock']);
});

test('createContainerOptions keeps explicit host socket env overrides for warden', () => {
    const options = createContainerOptions('warden', TEST_IMAGE, {
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

test('createContainerOptions applies host socket override when provided', () => {
    const options = createContainerOptions('warden', TEST_IMAGE, buildEnv('warden'), {
        detectDockerSockets: () => ['/var/run/docker.sock'],
        platform: 'linux',
        hostDockerSocketOverride: 'unix:///custom/docker.sock'
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/custom/docker.sock:/var/run/docker.sock']);
    assert.equal(options.env.NOONA_HOST_DOCKER_SOCKETS, '/custom/docker.sock,/var/run/docker.sock');
    assert.equal(options.env.HOST_DOCKER_SOCKETS, options.env.NOONA_HOST_DOCKER_SOCKETS);
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
