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
