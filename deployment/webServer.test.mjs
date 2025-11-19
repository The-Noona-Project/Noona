import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

import { createApp } from './webServer.mjs';

const startServer = async (overrides) => {
    const app = createApp(overrides);
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    return {
        server,
        baseUrl: `http://127.0.0.1:${port}`
    };
};

const withServer = async (overrides, handler) => {
    if (typeof overrides === 'function') {
        handler = overrides;
        overrides = undefined;
    }

    const { server, baseUrl } = await startServer(overrides);
    try {
        await handler(baseUrl);
    } finally {
        server.close();
        await once(server, 'close');
    }
};

test('GET /health returns ok payload', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(payload, { ok: true });
    });
});

test('GET / serves the built panel HTML', async () => {
    const expected = await readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
    await withServer(async (baseUrl) => {
        const response = await fetch(baseUrl);
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.equal(text.trim(), expected.trim());
    });
});

test('GET /api/services returns aggregated state', async () => {
    const calls = [];
    await withServer({
        services: ['warden'],
        listServices: async (options) => {
            calls.push(options);
            return {
                ok: true,
                services: [{ name: 'warden' }],
                containers: [{ Id: 'abc', Names: ['/noona-warden'] }],
                history: [{ service: 'warden', status: 'started' }]
            };
        }
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/services`);
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.ok, true);
        assert.deepEqual(payload.services, [{ name: 'warden' }]);
        assert.deepEqual(payload.containers, [{ Id: 'abc', Names: ['/noona-warden'] }]);
        assert.deepEqual(payload.history, [{ service: 'warden', status: 'started' }]);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].includeContainers, true);
    assert.equal(calls[0].includeHistory, true);
});

test('PATCH /api/settings persists updates', async () => {
    const updates = { concurrency: { workers: 2 } };
    const calls = [];

    await withServer({
        updateSettings: async (body) => {
            calls.push(body);
            return { ok: true, settings: { ...body } };
        }
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(updates)
        });

        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(payload, updates);
    });

    assert.deepEqual(calls, [updates]);
});

test('POST /api/build streams structured events', async () => {
    const calls = [];

    await withServer({
        services: ['warden'],
        build: async ({ reporter, onProgress, ...rest }) => {
            calls.push(rest);
            reporter.info('starting build');
            onProgress?.({ step: 'docker-build', service: 'warden' });
            reporter.success('build complete');
            return { ok: true, summary: 'done' };
        }
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/build`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ services: ['warden'], useNoCache: true })
        });

        assert.equal(response.status, 200);
        const text = await response.text();
        const lines = text.trim().split('\n').map(line => JSON.parse(line));

        assert.equal(lines[0].type, 'start');
        const progress = lines.find(entry => entry.type === 'progress');
        assert.ok(progress);
        assert.deepEqual(progress.event, { step: 'docker-build', service: 'warden' });
        const complete = lines.at(-1);
        assert.equal(complete.type, 'complete');
        assert.equal(complete.ok, true);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].useNoCache, true);
    assert.deepEqual(calls[0].services, ['warden']);
});
