import assert from 'node:assert/strict';
import test from 'node:test';

import {createVaultClient} from '../clients/vaultClient.mjs';

test('storeRecommendation inserts a recommendation document through Vault handle endpoint', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({status: 'ok', insertedId: 17}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const recommendation = {
        title: 'Solo Leveling',
        query: 'solo leveling',
        source: 'discord',
    };

    const payload = await vault.storeRecommendation(recommendation);

    assert.equal(payload.insertedId, 17);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/v1/vault/handle');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer vault-token');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'insert',
        payload: {
            collection: 'portal_recommendations',
            data: recommendation,
        },
    });
});

test('storeRecommendation rejects invalid payloads', async () => {
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async () => {
            throw new Error('fetchImpl should not be called for invalid payloads');
        },
    });

    await assert.rejects(() => vault.storeRecommendation(null), /must be an object/i);
});

test('findRecommendations queries Vault findMany through packet endpoint', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                status: 'ok',
                data: [
                    {_id: 'rec-1', status: 'pending'},
                    {_id: 'rec-2', status: 'approved'},
                ],
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const results = await vault.findRecommendations({
        query: {status: 'approved'},
    });

    assert.equal(results.length, 2);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'findMany',
        payload: {
            collection: 'portal_recommendations',
            query: {status: 'approved'},
        },
    });
});

test('updateRecommendation sends Mongo update packets for portal recommendations', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({status: 'ok', matched: 1, modified: 1}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const result = await vault.updateRecommendation({
        query: {_id: 'rec-1'},
        update: {$set: {'notifications.approvalDmSentAt': '2026-03-07T00:00:00.000Z'}},
    });

    assert.equal(result.matched, 1);
    assert.equal(result.modified, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'update',
        payload: {
            collection: 'portal_recommendations',
            query: {_id: 'rec-1'},
            update: {$set: {'notifications.approvalDmSentAt': '2026-03-07T00:00:00.000Z'}},
            upsert: false,
        },
    });
});

test('updateRecommendation validates query and update payloads', async () => {
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async () => {
            throw new Error('fetchImpl should not be called for invalid payloads');
        },
    });

    await assert.rejects(
        () => vault.updateRecommendation({query: {}, update: {$set: {status: 'approved'}}}),
        /query must be a non-empty object/i,
    );
    await assert.rejects(
        () => vault.updateRecommendation({query: {_id: 'rec-1'}, update: {}}),
        /update payload must be a non-empty object/i,
    );
});
