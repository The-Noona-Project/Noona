import test from 'node:test';
import assert from 'node:assert/strict';
import { createContainerOptions, resolveDockerSocketBinding } from './deploy.mjs';

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
});

test('createContainerOptions binds Unix Docker socket on non-Windows platforms', () => {
    const options = createContainerOptions('portal', TEST_IMAGE, buildEnv('portal'), {
        detectDockerSockets: () => ['//./pipe/docker_engine', '/var/run/docker.sock'],
        platform: 'linux',
    });

    assert.ok(options.hostConfig);
    assert.deepEqual(options.hostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock']);
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
