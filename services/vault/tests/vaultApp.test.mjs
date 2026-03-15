// services/vault/tests/vaultApp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';

import {createVaultApp} from '../app/createVaultApp.mjs';
import {createRequireAuth, extractBearerToken, parseTokenMap,} from '../auth/tokenAuth.mjs';

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

function matchesQuery(doc, query = {}) {
    if (!query || typeof query !== 'object') {
        return true;
    }

    return Object.entries(query).every(([key, value]) => doc?.[key] === value);
}

function applyMongoUpdate(doc, update = {}, {isInsert = false} = {}) {
    if (isInsert && update?.$setOnInsert && typeof update.$setOnInsert === 'object') {
        Object.assign(doc, update.$setOnInsert);
    }

    if (update?.$set && typeof update.$set === 'object') {
        Object.assign(doc, update.$set);
    }

    return doc;
}

function createUsersPacketHandler(initialUsers = []) {
    const users = initialUsers.map((entry, idx) => ({_id: idx + 1, ...entry}));

    const findCollection = (collection) => {
        if (collection === 'noona_users') return users;
        return null;
    };

    const handlePacket = async (packet) => {
        const collection = packet?.payload?.collection;
        const target = findCollection(collection);
        if (!target) {
            return {status: 'ok', data: []};
        }

        const operation = packet?.operation;
        const query = packet?.payload?.query ?? {};
        if (operation === 'find') {
            const found = target.find((doc) => matchesQuery(doc, query));
            return found ? {status: 'ok', data: {...found}} : {error: 'No document found'};
        }

        if (operation === 'findMany') {
            return {status: 'ok', data: target.filter((doc) => matchesQuery(doc, query)).map((doc) => ({...doc}))};
        }

        if (operation === 'insert') {
            const next = {_id: target.length + 1, ...(packet?.payload?.data ?? {})};
            target.push(next);
            return {status: 'ok', insertedId: next._id};
        }

        if (operation === 'update') {
            const idx = target.findIndex((doc) => matchesQuery(doc, query));
            if (idx >= 0) {
                target[idx] = applyMongoUpdate({...target[idx]}, packet?.payload?.update ?? {}, {isInsert: false});
                return {status: 'ok', matched: 1, modified: 1};
            }

            if (packet?.payload?.upsert === true) {
                const inserted = applyMongoUpdate({...query}, packet?.payload?.update ?? {}, {isInsert: true});
                if (!Object.prototype.hasOwnProperty.call(inserted, '_id')) {
                    inserted._id = target.length + 1;
                }
                target.push(inserted);
                return {status: 'ok', matched: 0, modified: 0};
            }

            return {status: 'ok', matched: 0, modified: 0};
        }

        if (operation === 'delete') {
            const idx = target.findIndex((doc) => matchesQuery(doc, query));
            if (idx < 0) return {status: 'ok', deleted: 0};
            target.splice(idx, 1);
            return {status: 'ok', deleted: 1};
        }

        return {error: `Unsupported operation ${operation}`};
    };

    return {users, handlePacket};
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
        env: {VAULT_TOKEN_MAP: 'noona-sage:abc,noona-portal:def'},
        warn: () => {},
        log: message => logs.push(message),
        debug: () => {},
        handlePacket: async () => ({}),
    });

    assert.ok(logs.some(message => message.includes('noona-sage, noona-portal')));
});

test('POST /v1/vault/handle authorizes valid token and returns result', async () => {
    const packets = [];
    const { app } = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
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
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
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

test('POST /v1/vault/handle returns 500 when handler throws', async () => {
    const warnings = [];
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: message => warnings.push(message),
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => {
            throw new Error('packet exploded');
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({action: 'ping'}),
    });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, {error: 'packet exploded'});
    assert.ok(warnings.some(message => message.includes('Packet handler failed for noona-sage: packet exploded')));

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle rejects requests without valid token', async () => {
    const { app } = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
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

test('GET /v1/vault/debug returns current debug state', async () => {
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        isDebugEnabled: () => true,
        handlePacket: async () => ({}),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/debug`, {
        headers: {authorization: 'Bearer secret'},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: true});

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/debug updates debug state', async () => {
    let enabled = false;
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        isDebugEnabled: () => enabled,
        setDebug: value => {
            enabled = value === true;
        },
        handlePacket: async () => ({}),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/debug`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({enabled: true}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: true});
    assert.equal(enabled, true);

    const badResponse = await fetch(`http://127.0.0.1:${port}/v1/vault/debug`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({enabled: 'maybe'}),
    });
    assert.equal(badResponse.status, 400);
    const badPayload = await badResponse.json();
    assert.equal(badPayload.error, 'enabled must be a boolean value.');

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
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
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

test('POST /v1/vault/handle rejects packets outside the service policy scope', async () => {
    let called = false;
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => {
            called = true;
            return {ok: true};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({
            storageType: 'mongo',
            operation: 'find',
            payload: {
                collection: 'noona_settings',
                query: {key: 'downloads.naming'},
            },
        }),
    });

    assert.equal(response.status, 403);
    assert.equal(called, false);
    const body = await response.json();
    assert.ok(body.error.includes('not allowed'));

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle allows Portal Redis packets inside the portal namespace family', async () => {
    const packets = [];
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async (packet) => {
            packets.push(packet);
            return {status: 'ok'};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const onboardingResponse = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({
            storageType: 'redis',
            operation: 'set',
            payload: {
                key: 'portal:onboarding:token-1',
                value: {discordId: 'user-1'},
            },
        }),
    });
    const dmResponse = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({
            storageType: 'redis',
            operation: 'rpush',
            payload: {
                key: 'portal:discord:dm:user-1',
                value: {content: 'queued'},
            },
        }),
    });

    assert.equal(onboardingResponse.status, 200);
    assert.equal(dmResponse.status, 200);
    assert.deepEqual(packets, [
        {
            storageType: 'redis',
            operation: 'set',
            payload: {
                key: 'portal:onboarding:token-1',
                value: {discordId: 'user-1'},
            },
        },
        {
            storageType: 'redis',
            operation: 'rpush',
            payload: {
                key: 'portal:discord:dm:user-1',
                value: {content: 'queued'},
            },
        },
    ]);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /v1/vault/handle rejects Portal Redis packets outside the portal namespace family', async () => {
    let called = false;
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => {
            called = true;
            return {ok: true};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/v1/vault/handle`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret',
        },
        body: JSON.stringify({
            storageType: 'redis',
            operation: 'set',
            payload: {
                key: 'discord:dm:user-1',
                value: {content: 'blocked'},
            },
        }),
    });

    assert.equal(response.status, 403);
    assert.equal(called, false);
    const body = await response.json();
    assert.match(body.error, /not allowed/i);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('GET /api/secrets/:path returns stored secret payload', async () => {
    const packets = [];
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async packet => {
            packets.push(packet);
            return {status: 'ok', data: {path: packet.payload.query.path, secret: {username: 'pax'}}};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/secrets/portal%2F123`, {
        headers: {authorization: 'Bearer secret'},
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {username: 'pax'});
    assert.deepEqual(packets, [{
        storageType: 'mongo',
        operation: 'find',
        payload: {
            collection: 'vault_secrets',
            query: {path: 'portal/123'},
        },
    }]);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('GET /api/secrets/:path rejects secret paths outside the service policy scope', async () => {
    let called = false;
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => {
            called = true;
            return {status: 'ok', data: {secret: {}}};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/secrets/admin%2Froot`, {
        headers: {authorization: 'Bearer secret'},
    });

    assert.equal(response.status, 403);
    assert.equal(called, false);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('GET /api/secrets/:path returns 404 when secret is missing', async () => {
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => ({error: 'No document found'}),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/secrets/portal%2Fmissing`, {
        headers: {authorization: 'Bearer secret'},
    });

    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.ok(payload.error.includes('Secret'));

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('PUT /api/secrets/:path writes secret via packet handler', async () => {
    const packets = [];
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async packet => {
            packets.push(packet);
            return {status: 'ok', matched: 0, modified: 1};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/secrets/portal%2F999`, {
        method: 'PUT',
        headers: {'content-type': 'application/json', authorization: 'Bearer secret'},
        body: JSON.stringify({secret: {email: 'test@example.com'}}),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true});
    assert.equal(packets.length, 1);
    assert.equal(packets[0].storageType, 'mongo');
    assert.equal(packets[0].operation, 'update');
    assert.equal(packets[0].payload.collection, 'vault_secrets');
    assert.deepEqual(packets[0].payload.query, {path: 'portal/999'});
    assert.equal(packets[0].payload.upsert, true);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('DELETE /api/secrets/:path deletes secret via packet handler', async () => {
    const packets = [];
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async packet => {
            packets.push(packet);
            return {status: 'ok', deleted: 1};
        },
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/secrets/portal%2Fdelete-me`, {
        method: 'DELETE',
        headers: {authorization: 'Bearer secret'},
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {deleted: true});
    assert.deepEqual(packets, [{
        storageType: 'mongo',
        operation: 'delete',
        payload: {
            collection: 'vault_secrets',
            query: {path: 'portal/delete-me'},
        },
    }]);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /api/users creates a user and GET /api/users lists sanitized users', async () => {
    const store = createUsersPacketHandler();
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: store.handlePacket,
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const createRes = await fetch(`http://127.0.0.1:${port}/api/users`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'Password123',
            role: 'admin',
        }),
    });

    assert.equal(createRes.status, 201);
    const createPayload = await createRes.json();
    assert.equal(createPayload.ok, true);
    assert.equal(createPayload.user.username, 'CaptainPax');
    assert.equal(createPayload.user.role, 'admin');
    assert.equal(Object.prototype.hasOwnProperty.call(createPayload.user, 'passwordHash'), false);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/users`, {
        headers: {authorization: 'Bearer secret'},
    });
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.equal(Array.isArray(listPayload.users), true);
    assert.equal(listPayload.users.length, 1);
    assert.equal(listPayload.users[0].usernameNormalized, 'captainpax');

    assert.ok(typeof store.users[0].passwordHash === 'string' && store.users[0].passwordHash.startsWith('scrypt$'));

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('user routes reject non-admin service identities', async () => {
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-portal:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: async () => ({status: 'ok', data: []}),
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/users`, {
        headers: {authorization: 'Bearer secret'},
    });

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.ok(payload.error.includes('not allowed'));

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('POST /api/users/authenticate validates credentials via hashed passwords', async () => {
    const store = createUsersPacketHandler();
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: store.handlePacket,
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    await fetch(`http://127.0.0.1:${port}/api/users`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'Password123',
            role: 'admin',
        }),
    });

    const okRes = await fetch(`http://127.0.0.1:${port}/api/users/authenticate`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'Password123',
        }),
    });
    assert.equal(okRes.status, 200);
    const okPayload = await okRes.json();
    assert.equal(okPayload.authenticated, true);
    assert.equal(okPayload.user.username, 'CaptainPax');

    const badRes = await fetch(`http://127.0.0.1:${port}/api/users/authenticate`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'WrongPassword',
        }),
    });
    assert.equal(badRes.status, 401);
    const badPayload = await badRes.json();
    assert.equal(badPayload.error, 'Invalid credentials.');

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});

test('PUT and DELETE /api/users update and remove users', async () => {
    const store = createUsersPacketHandler();
    const {app} = createVaultApp({
        env: {VAULT_TOKEN_MAP: 'noona-sage:secret'},
        warn: () => {
        },
        log: () => {
        },
        debug: () => {
        },
        handlePacket: store.handlePacket,
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const {port} = server.address();

    await fetch(`http://127.0.0.1:${port}/api/users`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'Password123',
            role: 'member',
        }),
    });

    const updateRes = await fetch(`http://127.0.0.1:${port}/api/users/CaptainPax`, {
        method: 'PUT',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPaxPrime',
            password: 'Password456',
            role: 'admin',
        }),
    });
    assert.equal(updateRes.status, 200);
    const updatePayload = await updateRes.json();
    assert.equal(updatePayload.user.username, 'CaptainPaxPrime');
    assert.equal(updatePayload.user.role, 'admin');

    const oldLoginRes = await fetch(`http://127.0.0.1:${port}/api/users/authenticate`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPax',
            password: 'Password123',
        }),
    });
    assert.equal(oldLoginRes.status, 401);

    const newLoginRes = await fetch(`http://127.0.0.1:${port}/api/users/authenticate`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            username: 'CaptainPaxPrime',
            password: 'Password456',
        }),
    });
    assert.equal(newLoginRes.status, 200);

    const deleteRes = await fetch(`http://127.0.0.1:${port}/api/users/CaptainPaxPrime`, {
        method: 'DELETE',
        headers: {authorization: 'Bearer secret'},
    });
    assert.equal(deleteRes.status, 200);
    assert.deepEqual(await deleteRes.json(), {deleted: true});

    const missingRes = await fetch(`http://127.0.0.1:${port}/api/users/CaptainPaxPrime`, {
        headers: {authorization: 'Bearer secret'},
    });
    assert.equal(missingRes.status, 404);

    await new Promise((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});
