// services/warden/tests/wardenServer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';

import {startWardenServer} from '../api/startWardenServer.mjs';

const listen = async (options = {}) => {
    const { server } = startWardenServer({
        warden: options.warden,
        port: 0,
        logger: options.logger,
    });

    await once(server, 'listening');
    const address = server.address();

    if (!address || typeof address !== 'object') {
        throw new Error('Expected server address info.');
    }

    return {
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
    };
};

const closeServer = (server) => new Promise((resolve, reject) => {
    server.close((error) => {
        if (error) {
            reject(error);
        } else {
            resolve();
        }
    });
});

test('GET /api/services returns installable services by default', async (t) => {
    const calls = [];
    const warden = {
        async listServices(options) {
            calls.push(options);
            return [
                { name: 'noona-sage', category: 'core', required: false },
                { name: 'noona-redis', category: 'addon', required: true },
            ];
        },
        installServices: async () => {
            throw new Error('installServices should not be called');
        },
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        services: [
            { name: 'noona-sage', category: 'core', required: false },
            { name: 'noona-redis', category: 'addon', required: true },
        ],
    });
    assert.deepEqual(calls, [{ includeInstalled: false }]);
});

test('GET /api/services can include installed services when requested', async (t) => {
    const calls = [];
    const warden = {
        async listServices(options) {
            calls.push(options);
            return [
                { name: 'noona-sage', category: 'core', installed: true, required: false },
                { name: 'noona-redis', category: 'addon', installed: false, required: true },
            ];
        },
        installServices: async () => {
            throw new Error('installServices should not be called');
        },
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services?includeInstalled=true`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        services: [
            { name: 'noona-sage', category: 'core', installed: true, required: false },
            { name: 'noona-redis', category: 'addon', installed: false, required: true },
        ],
    });
    assert.deepEqual(calls, [{ includeInstalled: true }]);
});

test('GET /api/storage/layout returns the Warden storage layout payload', async (t) => {
    const warden = {
        async getStorageLayout() {
            return {
                root: '/srv/noona',
                services: [
                    {
                        service: 'noona-vault',
                        folders: [
                            {key: 'mongo', hostPath: '/srv/noona/vault/mongo', containerPath: '/data/db'},
                            {key: 'redis', hostPath: '/srv/noona/vault/redis', containerPath: '/data'},
                        ],
                    },
                ],
            };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/storage/layout`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        root: '/srv/noona',
        services: [
            {
                service: 'noona-vault',
                folders: [
                    {key: 'mongo', hostPath: '/srv/noona/vault/mongo', containerPath: '/data/db'},
                    {key: 'redis', hostPath: '/srv/noona/vault/redis', containerPath: '/data'},
                ],
            },
        ],
    });
});

test('GET /api/setup/config returns persisted setup snapshot metadata from warden', async (t) => {
    const warden = {
        async getSetupConfig() {
            return {
                exists: true,
                path: '/srv/noona/warden/setup-wizard-state.json',
                snapshot: {
                    version: 2,
                    selected: ['noona-portal'],
                    values: {
                        'noona-portal': {
                            DISCORD_BOT_TOKEN: 'token',
                            KAVITA_API_KEY: 'k-api',
                        },
                    },
                },
                error: null,
            };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/setup/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        exists: true,
        path: '/srv/noona/warden/setup-wizard-state.json',
        snapshot: {
            version: 2,
            selected: ['noona-portal'],
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'token',
                    KAVITA_API_KEY: 'k-api',
                },
            },
        },
        error: null,
    });
});

test('POST /api/setup/config persists setup snapshot through warden', async (t) => {
    const calls = [];
    const warden = {
        async saveSetupConfig(payload) {
            calls.push(payload);
            return {
                exists: true,
                path: '/srv/noona/warden/setup-wizard-state.json',
                selected: ['noona-portal'],
                snapshot: payload,
                runtime: [
                    {
                        service: 'noona-portal',
                        env: {
                            DISCORD_BOT_TOKEN: 'token',
                            KAVITA_API_KEY: 'k-api',
                        },
                        hostPort: null,
                    },
                ],
            };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const payload = {
        version: 2,
        selected: ['noona-portal'],
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'token',
                KAVITA_API_KEY: 'k-api',
            },
        },
    };

    const response = await fetch(`${baseUrl}/api/setup/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [payload]);
    assert.deepEqual(await response.json(), {
        exists: true,
        path: '/srv/noona/warden/setup-wizard-state.json',
        selected: ['noona-portal'],
        snapshot: payload,
        runtime: [
            {
                service: 'noona-portal',
                env: {
                    DISCORD_BOT_TOKEN: 'token',
                    KAVITA_API_KEY: 'k-api',
                },
                hostPort: null,
            },
        ],
    });
});

test('POST /api/services/install returns results and status code for errors', async (t) => {
    const installCalls = [];
    const warden = {
        listServices: async () => [],
        installServices: async (services) => {
            installCalls.push(services);
            return [
                { name: 'noona-sage', status: 'installed', category: 'core', required: true },
                { name: 'noona-bad', status: 'error', error: 'boom', required: false },
            ];
        },
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: [
            { name: 'noona-sage', env: { DEBUG: 'true' } },
            { name: 'noona-bad' },
        ] }),
    });

    assert.equal(response.status, 207);
    assert.deepEqual(await response.json(), {
        results: [
            { name: 'noona-sage', status: 'installed', category: 'core', required: true },
            { name: 'noona-bad', status: 'error', error: 'boom', required: false },
        ],
    });
    assert.deepEqual(installCalls, [[
        { name: 'noona-sage', env: { DEBUG: 'true' } },
        { name: 'noona-bad' },
    ]]);
});

test('POST /api/services/install accepts async installs and reports an active session', async (t) => {
    const installCalls = [];
    let resolveInstall;
    const progress = {
        status: 'installing',
        percent: 0,
        items: [{name: 'noona-kavita', status: 'pending'}],
    };
    const warden = {
        listServices: async () => [],
        getInstallationProgress: async () => progress,
        installServices: async (services) => {
            installCalls.push(services);
            await new Promise((resolve) => {
                resolveInstall = resolve;
            });
            return [{name: 'noona-kavita', status: 'installed'}];
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(async () => {
        resolveInstall?.();
        await closeServer(server);
    });

    const body = JSON.stringify({services: [{name: 'noona-kavita'}]});
    const firstResponse = await fetch(`${baseUrl}/api/services/install?async=true`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
    });

    assert.equal(firstResponse.status, 202);
    assert.deepEqual(await firstResponse.json(), {
        accepted: true,
        started: true,
        alreadyRunning: false,
        progress,
    });

    const secondResponse = await fetch(`${baseUrl}/api/services/install?async=true`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
    });

    assert.equal(secondResponse.status, 202);
    assert.deepEqual(await secondResponse.json(), {
        accepted: true,
        started: false,
        alreadyRunning: true,
        progress,
    });
    assert.deepEqual(installCalls, [[{name: 'noona-kavita'}]]);
});

test('POST /api/services/install validates payload', async (t) => {
    const warden = {
        listServices: async () => [],
        installServices: async () => {
            throw new Error('installServices should not be called');
        },
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: [] }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.ok(payload.error.includes('non-empty'));
});

test('GET /api/services/install/progress forwards to warden summary', async (t) => {
    const warden = {
        async getInstallationProgress() {
            return { status: 'installing', percent: 50, items: [{ name: 'noona-sage', status: 'installing' }] };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/install/progress`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        status: 'installing',
        percent: 50,
        items: [{ name: 'noona-sage', status: 'installing' }],
    });
});

test('GET /api/services/installation/logs returns installation history from warden', async (t) => {
    const warden = {
        async getServiceHistory(name, options) {
            return {
                service: name,
                entries: [{type: 'status', status: 'installing', message: 'Installing noona-kavita'}],
                summary: {status: 'installing', percent: 25, detail: null, updatedAt: 'now'},
                limit: options?.limit ?? null,
            };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/installation/logs?limit=5`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        service: 'installation',
        entries: [{type: 'status', status: 'installing', message: 'Installing noona-kavita'}],
        summary: {status: 'installing', percent: 25, detail: null, updatedAt: 'now'},
        limit: '5',
    });
});

test('GET /api/services/:name/logs returns history from warden', async (t) => {
    const warden = {
        async getServiceHistory(name, options) {
            return {
                service: name,
                entries: [{ type: 'status', status: 'ready', message: 'Service ready' }],
                summary: { status: 'ready', percent: null, detail: null, updatedAt: 'now' },
                limit: options?.limit ?? null,
            };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/noona-sage/logs?limit=10`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        service: 'noona-sage',
        entries: [{ type: 'status', status: 'ready', message: 'Service ready' }],
        summary: { status: 'ready', percent: null, detail: null, updatedAt: 'now' },
        limit: '10',
    });
});

test('POST /api/services/:name/test delegates to warden testService', async (t) => {
    const calls = [];
    const warden = {
        async testService(name, body) {
            calls.push([name, body]);
            return { service: name, success: true, supported: true };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/noona-portal/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: 'noona-portal', success: true, supported: true });
    assert.deepEqual(calls, [['noona-portal', { method: 'GET' }]]);
});

test('POST /api/services/:name/test returns error when unsupported', async (t) => {
    const warden = {
        async testService() {
            return { service: 'noona-sage', success: false, supported: false, error: 'Unsupported' };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/noona-sage/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        service: 'noona-sage',
        success: false,
        supported: false,
        error: 'Unsupported',
    });
});

test('POST /api/services/noona-raven/detect returns detection payload', async (t) => {
    const warden = {
        async detectKavitaMount() {
            return { mountPath: '/data/path' };
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/services/noona-raven/detect`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { detection: { mountPath: '/data/path' } });
});

test('GET /api/debug returns debug state payload', async (t) => {
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
        getDebug() {
            return {enabled: true, value: 'true'};
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/debug`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: true, value: 'true'});
});

test('POST /api/debug updates warden debug mode', async (t) => {
    const calls = [];
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
        async setDebug(enabled) {
            calls.push(enabled);
            return {enabled, value: enabled ? 'true' : 'false'};
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/debug`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: false}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: false, value: 'false'});
    assert.deepEqual(calls, [false]);
});

test('POST /api/ecosystem/restart delegates to warden restartEcosystem', async (t) => {
    const calls = [];
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
        async restartEcosystem(options) {
            calls.push(options);
            return {ok: true};
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/ecosystem/restart`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({trackedOnly: false}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true});
    assert.deepEqual(calls, [{trackedOnly: false}]);
});

test('POST /api/ecosystem/factory-reset delegates to warden factoryResetEcosystem', async (t) => {
    const calls = [];
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
        async factoryResetEcosystem(options) {
            calls.push(options);
            return {ok: true, cleaned: true};
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/api/ecosystem/factory-reset`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({deleteDockers: true, deleteRavenDownloads: true}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true, cleaned: true});
    assert.deepEqual(calls, [{deleteDockers: true, deleteRavenDownloads: true}]);
});
