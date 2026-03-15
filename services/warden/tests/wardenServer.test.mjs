// services/warden/tests/wardenServer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';

import {startWardenServer} from '../api/startWardenServer.mjs';
import {normalizeSetupProfileSnapshot, toPublicSetupSnapshot} from '../core/setupProfile.mjs';
import {WardenConflictError, WardenNotFoundError, WardenValidationError,} from '../core/wardenErrors.mjs';

const SAGE_TOKEN = 'sage-test-token';
const PORTAL_TOKEN = 'portal-test-token';
const TEST_ENV = {
    WARDEN_API_TOKEN_MAP: `noona-sage:${SAGE_TOKEN},noona-portal:${PORTAL_TOKEN}`,
};

const listen = async (options = {}) => {
    const { server } = startWardenServer({
        warden: options.warden,
        env: options.env ?? TEST_ENV,
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

const wardenFetch = (baseUrl, path, options = {}, token = SAGE_TOKEN) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(options?.headers ?? {}),
    },
});

test('GET /health reports readiness metadata before init completes', async (t) => {
    const readinessState = {
        ready: false,
        startedAt: '2026-03-14T00:00:00.000Z',
        initializedAt: null,
        error: null,
    };
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server} = startWardenServer({
        warden,
        env: TEST_ENV,
        port: 0,
        readinessState,
    });

    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        status: 'starting',
        ready: false,
        startedAt: '2026-03-14T00:00:00.000Z',
        initializedAt: null,
        error: null,
    });
});

test('GET /health reports ready after bootstrap completes', async (t) => {
    const readinessState = {
        ready: true,
        startedAt: '2026-03-14T00:00:00.000Z',
        initializedAt: '2026-03-14T00:00:05.000Z',
        error: null,
    };
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server} = startWardenServer({
        warden,
        env: TEST_ENV,
        port: 0,
        readinessState,
    });

    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    t.after(() => closeServer(server));

    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        status: 'ok',
        ready: true,
        startedAt: '2026-03-14T00:00:00.000Z',
        initializedAt: '2026-03-14T00:00:05.000Z',
        error: null,
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

    const response = await wardenFetch(baseUrl, '/api/services');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        services: [
            {name: 'noona-sage', category: 'core', envConfig: [], required: false},
            {name: 'noona-redis', category: 'addon', envConfig: [], required: true},
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

    const response = await wardenFetch(baseUrl, '/api/services?includeInstalled=true');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        services: [
            {name: 'noona-sage', category: 'core', envConfig: [], installed: true, required: false},
            {name: 'noona-redis', category: 'addon', envConfig: [], installed: false, required: true},
        ],
    });
    assert.deepEqual(calls, [{ includeInstalled: true }]);
});

test('protected Warden routes reject requests without a bearer token', async (t) => {
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/services', {}, null);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
        error: 'Missing or invalid Authorization header.',
    });
});

test('noona-portal token is limited to read-only activity routes', async (t) => {
    const warden = {
        listServices: async () => [],
        getInstallationProgress: async () => ({items: [], status: 'idle', percent: null}),
        installServices: async () => [],
        getStorageLayout: async () => ({root: '/srv/noona', services: []}),
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const allowedResponse = await wardenFetch(baseUrl, '/api/services/install/progress', {}, PORTAL_TOKEN);
    assert.equal(allowedResponse.status, 200);

    const forbiddenResponse = await wardenFetch(baseUrl, '/api/storage/layout', {}, PORTAL_TOKEN);
    assert.equal(forbiddenResponse.status, 403);
    assert.deepEqual(await forbiddenResponse.json(), {
        error: 'Forbidden for this service identity.',
    });
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

    const response = await wardenFetch(baseUrl, '/api/storage/layout');
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
                path: '/srv/noona/wardenm/noona-settings.json',
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

    const response = await wardenFetch(baseUrl, '/api/setup/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        exists: true,
        path: '/srv/noona/wardenm/noona-settings.json',
        snapshot: toPublicSetupSnapshot({
            version: 2,
            selected: ['noona-portal'],
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'token',
                    KAVITA_API_KEY: 'k-api',
                },
            },
        }, {maskSecrets: true}),
        error: null,
    });
});

test('POST /api/setup/config/normalize returns a normalized public snapshot without persisting it', async (t) => {
    const calls = [];
    const warden = {
        async getSetupConfig(options = {}) {
            calls.push({getSetupConfig: options});
            return {
                exists: true,
                path: '/srv/noona/wardenm/noona-settings.json',
                snapshot: {
                    version: 3,
                    storageRoot: '/srv/noona',
                    kavita: {
                        mode: 'managed',
                        baseUrl: 'http://noona-kavita:5000',
                        apiKey: 'current-kavita-key',
                        sharedLibraryPath: '',
                        account: {
                            username: 'admin',
                            email: 'admin@example.com',
                            password: 'admin-pass',
                        },
                    },
                    komf: {
                        mode: 'managed',
                        baseUrl: '',
                        applicationYml: '',
                    },
                    discord: {
                        botToken: 'current-bot-token',
                        clientId: 'current-client-id',
                        clientSecret: 'current-client-secret',
                        guildId: 'current-guild-id',
                    },
                },
                error: null,
            };
        },
        async saveSetupConfig() {
            throw new Error('saveSetupConfig should not be called for normalize-only imports.');
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const payload = {
        version: 2,
        selected: ['noona-moon', 'noona-sage', 'noona-portal', 'noona-kavita'],
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'bot-token',
                DISCORD_CLIENT_ID: 'client-id',
                DISCORD_CLIENT_SECRET: 'client-secret',
                DISCORD_GUILD_ID: 'guild-id',
                KAVITA_BASE_URL: 'http://noona-kavita:5000',
                KAVITA_API_KEY: 'legacy-kavita-key',
            },
            'noona-kavita': {
                KAVITA_ADMIN_USERNAME: 'reader-admin',
                KAVITA_ADMIN_EMAIL: 'reader-admin@example.com',
                KAVITA_ADMIN_PASSWORD: 'Password123!',
            },
        },
    };

    const response = await wardenFetch(baseUrl, '/api/setup/config/normalize', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        snapshot: toPublicSetupSnapshot(
            normalizeSetupProfileSnapshot(payload, {
                currentSnapshot: {
                    version: 3,
                    storageRoot: '/srv/noona',
                    kavita: {
                        mode: 'managed',
                        baseUrl: 'http://noona-kavita:5000',
                        apiKey: 'current-kavita-key',
                        sharedLibraryPath: '',
                        account: {
                            username: 'admin',
                            email: 'admin@example.com',
                            password: 'admin-pass',
                        },
                    },
                    komf: {
                        mode: 'managed',
                        baseUrl: '',
                        applicationYml: '',
                    },
                    discord: {
                        botToken: 'current-bot-token',
                        clientId: 'current-client-id',
                        clientSecret: 'current-client-secret',
                        guildId: 'current-guild-id',
                    },
                },
            }),
            {maskSecrets: false},
        ),
    });
    assert.deepEqual(calls, [{getSetupConfig: {refresh: true}}]);
});

test('POST /api/setup/config persists setup snapshot through warden', async (t) => {
    const calls = [];
    const warden = {
        async saveSetupConfig(payload) {
            calls.push(payload);
            return {
                exists: true,
                path: '/srv/noona/wardenm/noona-settings.json',
                selected: ['noona-portal'],
                selectionMode: 'selected',
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
                saved: true,
                restarted: true,
                rolledBack: false,
                restart: {
                    stopped: [],
                    started: {mode: 'full', setupCompleted: true},
                },
            };
        },
        getServiceConfig(name) {
            if (name !== 'noona-portal') {
                throw new Error('unknown service');
            }

            return {
                env: {
                    DISCORD_BOT_TOKEN: 'token',
                    KAVITA_API_KEY: 'k-api',
                },
                envConfig: [
                    {key: 'DISCORD_BOT_TOKEN', sensitive: true},
                    {key: 'KAVITA_API_KEY', sensitive: true},
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

    const response = await wardenFetch(baseUrl, '/api/setup/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [payload]);
    assert.deepEqual(await response.json(), {
        exists: true,
        path: '/srv/noona/wardenm/noona-settings.json',
        selected: ['noona-portal'],
        selectionMode: 'selected',
        snapshot: toPublicSetupSnapshot(payload, {maskSecrets: true}),
        runtime: [
            {
                service: 'noona-portal',
                env: {
                    DISCORD_BOT_TOKEN: '********',
                    KAVITA_API_KEY: '********',
                },
                hostPort: null,
            },
        ],
        saved: true,
        restarted: true,
        rolledBack: false,
        restart: {
            stopped: [],
            started: {mode: 'full', setupCompleted: true},
        },
    });
});

test('POST /api/setup/config returns 409 for apply conflicts', async (t) => {
    const warden = {
        async saveSetupConfig() {
            throw new WardenConflictError('Cannot apply setup config snapshot while restart the ecosystem is already in progress.');
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/setup/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({selected: []}),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
        error: 'Cannot apply setup config snapshot while restart the ecosystem is already in progress.',
    });
});

test('PUT /api/services/:name/config returns 400 for invalid config payloads', async (t) => {
    const warden = {
        async updateServiceConfig() {
            throw new WardenValidationError('hostPort must be a valid TCP port between 1 and 65535.');
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/services/noona-moon/config', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({hostPort: 70000}),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        error: 'hostPort must be a valid TCP port between 1 and 65535.',
    });
});

test('PUT /api/services/:name/config returns 404 for unknown services', async (t) => {
    const warden = {
        async updateServiceConfig() {
            throw new WardenNotFoundError('Service noona-ghost is not registered with Warden.');
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/services/noona-ghost/config', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({env: {DEBUG: 'true'}}),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
        error: 'Service noona-ghost is not registered with Warden.',
    });
});

test('POST routes reject oversized JSON bodies with 413', async (t) => {
    const calls = [];
    const warden = {
        async saveSetupConfig(payload) {
            calls.push(payload);
            return {ok: true};
        },
        listServices: async () => [],
        installServices: async () => [],
    };

    const {server, baseUrl} = await listen({
        warden,
        env: {
            ...TEST_ENV,
            WARDEN_API_MAX_BODY_BYTES: '32',
        },
    });
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/setup/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            selected: ['noona-portal'],
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'this-payload-is-too-large',
                },
            },
        }),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
        error: 'Request body exceeds the 32 byte limit.',
    });
    assert.deepEqual(calls, []);
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

    const response = await wardenFetch(baseUrl, '/api/services/install', {
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
    const firstResponse = await wardenFetch(baseUrl, '/api/services/install?async=true', {
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

    const secondResponse = await wardenFetch(baseUrl, '/api/services/install?async=true', {
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

test('POST /api/services/install accepts persisted-profile installs with an empty services array', async (t) => {
    const calls = [];
    const warden = {
        listServices: async () => [],
        installServices: async (services) => {
            calls.push(services);
            return [];
        },
    };

    const { server, baseUrl } = await listen({ warden });
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/services/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: [] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {results: []});
    assert.deepEqual(calls, [[]]);
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

    const response = await wardenFetch(baseUrl, '/api/services/install/progress');
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

    const response = await wardenFetch(baseUrl, '/api/services/installation/logs?limit=5');
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

    const response = await wardenFetch(baseUrl, '/api/services/noona-sage/logs?limit=10');
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

    const response = await wardenFetch(baseUrl, '/api/services/noona-portal/test', {
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

    const response = await wardenFetch(baseUrl, '/api/services/noona-sage/test', {
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

    const response = await wardenFetch(baseUrl, '/api/services/noona-raven/detect', {method: 'POST'});
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

    const response = await wardenFetch(baseUrl, '/api/debug');
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

    const response = await wardenFetch(baseUrl, '/api/debug', {
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

    const response = await wardenFetch(baseUrl, '/api/ecosystem/restart', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({trackedOnly: false}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true});
    assert.deepEqual(calls, [{trackedOnly: false}]);
});

test('POST /api/ecosystem/factory-reset requires explicit confirmation', async (t) => {
    const calls = [];
    const warden = {
        listServices: async () => [],
        installServices: async () => [],
        async factoryResetEcosystem(options) {
            calls.push(options);
            return {ok: true};
        },
    };

    const {server, baseUrl} = await listen({warden});
    t.after(() => closeServer(server));

    const response = await wardenFetch(baseUrl, '/api/ecosystem/factory-reset', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({deleteDockers: true}),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        error: 'Factory reset requires confirm: "FACTORY_RESET".',
    });
    assert.deepEqual(calls, []);
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

    const response = await wardenFetch(baseUrl, '/api/ecosystem/factory-reset', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            confirm: 'FACTORY_RESET',
            deleteDockers: true,
            deleteRavenDownloads: true,
        }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true, cleaned: true});
    assert.deepEqual(calls, [{
        confirm: 'FACTORY_RESET',
        deleteDockers: true,
        deleteRavenDownloads: true,
    }]);
});
