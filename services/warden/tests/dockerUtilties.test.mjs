// services/warden/tests/dockerUtilties.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    attachSelfToNetwork,
    formatDockerProgressMessage,
    isWardenHostProcessMode,
    normalizeDockerProgressEvent,
    pullImageIfNeeded,
    runContainerWithLogs,
    waitForContainerHealthy,
} from '../docker/dockerUtilties.mjs';

test('normalizeDockerProgressEvent preserves layer metadata and formats message', () => {
    const event = normalizeDockerProgressEvent(
        {
            id: 'layer-a',
            status: 'Downloading',
            progressDetail: { current: 12, total: 24 },
        },
        { fallbackId: 'redis:latest' },
    );

    assert.equal(event.layerId, 'layer-a');
    assert.equal(event.phase, 'Downloading');
    assert.equal(event.status, 'Downloading');
    assert.equal(event.detail, '12/24');
    assert.equal(event.progressDetail.current, 12);
    assert.equal(event.progressDetail.total, 24);
    assert.equal(event.id, 'layer-a');
    assert.ok(event.message?.includes('[layer-a]'));
});

test('formatDockerProgressMessage omits empty parts', () => {
    const message = formatDockerProgressMessage({ layerId: 'layer-b', status: 'Waiting' });
    assert.equal(message, '[layer-b] Waiting');
});

test('isWardenHostProcessMode only enables explicit host-process configuration', () => {
    assert.equal(isWardenHostProcessMode({WARDEN_RUN_OUTSIDE_DOCKER: 'true'}), true);
    assert.equal(isWardenHostProcessMode({WARDEN_RUN_OUTSIDE_DOCKER: '1'}), true);
    assert.equal(isWardenHostProcessMode({WARDEN_RUN_OUTSIDE_DOCKER: 'false'}), false);
    assert.equal(isWardenHostProcessMode({}), false);
});

test('attachSelfToNetwork throws when containerized Warden cannot find its own container', async () => {
    const dockerInstance = {
        getContainer() {
            return {
                async inspect() {
                    const error = new Error('missing');
                    error.statusCode = 404;
                    throw error;
                },
            };
        },
    };

    await assert.rejects(
        attachSelfToNetwork(dockerInstance, 'noona-network', {
            env: {
                HOSTNAME: 'missing-warden',
                SERVICE_NAME: 'noona-warden',
            },
        }),
        /WARDEN_RUN_OUTSIDE_DOCKER=true/,
    );
});

test('attachSelfToNetwork skips self-attach when host-process mode is explicit', async () => {
    const dockerInstance = {
        getContainer() {
            return {
                async inspect() {
                    const error = new Error('missing');
                    error.statusCode = 404;
                    throw error;
                },
            };
        },
    };

    await assert.doesNotReject(
        attachSelfToNetwork(dockerInstance, 'noona-network', {
            env: {
                HOSTNAME: 'missing-warden',
                SERVICE_NAME: 'noona-warden',
                WARDEN_RUN_OUTSIDE_DOCKER: 'true',
            },
        }),
    );
});

test('pullImageIfNeeded emits layer-aware progress payloads', async () => {
    const events = [];
    const dockerInstance = {
        listImages: async () => [],
        pull: (_image, callback) => {
            callback(null, { id: 'stream' });
        },
        modem: {
            followProgress: (_stream, onFinished, onProgress) => {
                onProgress({
                    id: 'layer-c',
                    status: 'Downloading',
                    progressDetail: { current: 5, total: 10 },
                });
                onProgress({ status: 'Pull complete' });
                onFinished();
            },
        },
    };

    await pullImageIfNeeded('library/redis:latest', {
        dockerInstance,
        onProgress: (event) => events.push(event),
    });

    assert.ok(events.length >= 2, 'Expected multiple progress events');

    const first = events[0];
    assert.equal(first.layerId, 'layer-c');
    assert.equal(first.phase, 'Downloading');
    assert.equal(first.status, 'Downloading');
    assert.equal(first.detail, '5/10');
    assert.ok(first.message?.includes('[layer-c]'));

    const last = events.at(-1);
    assert.equal(last.layerId, 'library/redis:latest');
    assert.equal(last.status, 'complete');
    assert.equal(last.detail, 'Image pulled successfully');
    assert.ok(last.message?.includes('[library/redis:latest]'));
});

test('runContainerWithLogs attaches services to all requested networks and applies Docker health checks', async () => {
    const tracked = new Set();
    const networkConnections = [];
    let createPayload = null;
    const dockerInstance = {
        createContainer: async (payload) => {
            createPayload = payload;
            return {
                id: 'container-1',
                start: async () => {
                },
                logs: async () => ({
                    on() {
                    },
                }),
            };
        },
        getNetwork: (name) => ({
            connect: async (payload) => networkConnections.push({name, payload}),
        }),
    };

    await runContainerWithLogs({
        name: 'noona-vault',
        image: 'vault:latest',
        env: [],
        volumes: [],
        networks: ['noona-network', 'noona-data-network'],
        healthCheck: {
            type: 'docker',
            test: ['CMD-SHELL', 'echo ok'],
            intervalMs: 5000,
            timeoutMs: 3000,
            startPeriodMs: 2000,
            retries: 10,
        },
    }, 'noona-network', tracked, 'false', {dockerInstance});

    assert.equal(createPayload.HostConfig.NetworkMode, 'noona-network');
    assert.deepEqual(createPayload.NetworkingConfig.EndpointsConfig, {
        'noona-network': {},
    });
    assert.deepEqual(createPayload.Healthcheck.Test, ['CMD-SHELL', 'echo ok']);
    assert.equal(networkConnections.length, 1);
    assert.equal(networkConnections[0].name, 'noona-data-network');
    assert.ok(tracked.has('noona-vault'));
});

test('waitForContainerHealthy resolves once Docker reports a healthy status', async () => {
    let attempts = 0;
    const dockerInstance = {
        getContainer: () => ({
            inspect: async () => {
                attempts += 1;
                return {
                    State: {
                        Running: true,
                        Health: {
                            Status: attempts >= 2 ? 'healthy' : 'starting',
                        },
                    },
                };
            },
        }),
    };

    const inspection = await waitForContainerHealthy('noona-redis', {
        dockerInstance,
        tries: 3,
        delay: 0,
    });

    assert.equal(inspection.State.Health.Status, 'healthy');
    assert.equal(attempts, 2);
});
