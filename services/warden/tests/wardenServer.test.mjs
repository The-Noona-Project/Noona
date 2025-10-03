// services/warden/tests/wardenServer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { startWardenServer } from '../shared/wardenServer.mjs';

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
                { name: 'noona-sage', category: 'core' },
                { name: 'noona-redis', category: 'addon' },
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
            { name: 'noona-sage', category: 'core' },
            { name: 'noona-redis', category: 'addon' },
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
                { name: 'noona-sage', category: 'core', installed: true },
                { name: 'noona-redis', category: 'addon', installed: false },
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
            { name: 'noona-sage', category: 'core', installed: true },
            { name: 'noona-redis', category: 'addon', installed: false },
        ],
    });
    assert.deepEqual(calls, [{ includeInstalled: true }]);
});

test('POST /api/services/install returns results and status code for errors', async (t) => {
    const installCalls = [];
    const warden = {
        listServices: async () => [],
        installServices: async (services) => {
            installCalls.push(services);
            return [
                { name: 'noona-sage', status: 'installed', category: 'core' },
                { name: 'noona-bad', status: 'error', error: 'boom' },
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
            { name: 'noona-sage', status: 'installed', category: 'core' },
            { name: 'noona-bad', status: 'error', error: 'boom' },
        ],
    });
    assert.deepEqual(installCalls, [[
        { name: 'noona-sage', env: { DEBUG: 'true' } },
        { name: 'noona-bad' },
    ]]);
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
