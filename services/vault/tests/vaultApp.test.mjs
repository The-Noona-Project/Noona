// services/vault/tests/vaultApp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
    createVaultApp,
    createRequireAuth,
    extractBearerToken,
    parseTokenMap,
} from '../shared/vaultApp.mjs';

function createMockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

test('parseTokenMap builds lookup tables from VAULT_TOKEN_MAP', () => {
    const { tokenPairs, tokensByService, serviceByToken } = parseTokenMap(
        'moon:token1, raven:token2, invalid'
    );

    assert.deepEqual(tokenPairs, [
        ['moon', 'token1'],
        ['raven', 'token2'],
    ]);
    assert.deepEqual(tokensByService, {
        moon: 'token1',
        raven: 'token2',
    });
    assert.deepEqual(serviceByToken, {
        token1: 'moon',
        token2: 'raven',
    });
});

test('extractBearerToken returns the token when Authorization header is valid', () => {
    const req = { headers: { authorization: 'Bearer secret-token' } };
    assert.equal(extractBearerToken(req), 'secret-token');
});

test('extractBearerToken returns null for missing or malformed headers', () => {
    assert.equal(extractBearerToken({ headers: {} }), null);
    assert.equal(extractBearerToken({ headers: { authorization: 'Basic abc' } }), null);
    assert.equal(extractBearerToken({ headers: { authorization: 42 } }), null);
});

test('createRequireAuth denies requests without valid tokens', () => {
    const middleware = createRequireAuth({ serviceByToken: {}, debug: () => {} });
    const req = { headers: {} };
    const res = createMockResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
        error: 'Missing or invalid Authorization header',
    });
});

test('createRequireAuth attaches serviceName for known tokens', () => {
    const debugMessages = [];
    const middleware = createRequireAuth({
        serviceByToken: { 'secret-token': 'moon' },
        debug: message => debugMessages.push(message),
    });
    const req = { headers: { authorization: 'Bearer secret-token' } };
    const res = createMockResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(req.serviceName, 'moon');
    assert.equal(debugMessages.length, 0);
});

test('createRequireAuth logs debug message when token is unknown', () => {
    const messages = [];
    const middleware = createRequireAuth({
        serviceByToken: { known: 'moon' },
        debug: message => messages.push(message),
    });
    const req = { headers: { authorization: 'Bearer unknown' } };
    const res = createMockResponse();

    middleware(req, res, () => {});

    assert.equal(res.statusCode, 401);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes('Unknown token'));
});

test('createVaultApp warns when no tokens are configured', () => {
    const warnings = [];
    createVaultApp({
        env: {},
        warn: message => warnings.push(message),
        log: () => {},
        debug: () => {},
        handlePacket: async () => ({}),
    });

    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('No service tokens'));
});

test('createVaultApp logs loaded services when tokens exist', () => {
    const logs = [];
    createVaultApp({
        env: { VAULT_TOKEN_MAP: 'moon:abc,raven:def' },
        warn: () => {},
        log: message => logs.push(message),
        debug: () => {},
        handlePacket: async () => ({}),
    });

    assert.ok(logs.some(message => message.includes('moon, raven')));
});

test('POST /v1/vault/handle authorizes valid token and returns result', async () => {
    const packets = [];
    const { app } = createVaultApp({
        env: { VAULT_TOKEN_MAP: 'moon:secret' },
        warn: () => {},
        log: () => {},
        debug: () => {},
        handlePacket: async packet => {
            packets.push(packet);
            return { ok: true };
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({ action: 'ping' }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(packets, [{ action: 'ping' }]);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle returns 400 when handler reports error', async () => {
    const { app } = createVaultApp({
        env: { VAULT_TOKEN_MAP: 'moon:secret' },
        warn: () => {},
        log: () => {},
        debug: () => {},
        handlePacket: async () => ({ error: 'bad packet' }),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({ action: 'ping' }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { error: 'bad packet' });

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle rejects requests without valid token', async () => {
    const { app } = createVaultApp({
        env: { VAULT_TOKEN_MAP: 'moon:secret' },
        warn: () => {},
        log: () => {},
        debug: () => {},
        handlePacket: async () => ({ ok: true }),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'ping' }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.deepEqual(body, { error: 'Missing or invalid Authorization header' });

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('GET /v1/vault/health responds with status message', async () => {
    const { app } = createVaultApp({
        env: {},
        warn: () => {},
        log: () => {},
        debug: () => {},
        handlePacket: async () => ({}),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/health`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text, 'Vault is up and running');

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle returns array payloads from handler', async () => {
    const packets = [];
    const mockResult = {
        status: 'ok',
        data: [
            { title: 'Solo Leveling' },
            { title: 'Omniscient Reader' },
        ],
    };

    const { app } = createVaultApp({
        env: { VAULT_TOKEN_MAP: 'raven:secret' },
        warn: () => {},
        log: () => {},
        debug: () => {},
        handlePacket: async packet => {
            packets.push(packet);
            return mockResult;
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({ storageType: 'mongo', operation: 'findMany' }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, mockResult);
    assert.deepEqual(packets, [
        { storageType: 'mongo', operation: 'findMany' },
    ]);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});
