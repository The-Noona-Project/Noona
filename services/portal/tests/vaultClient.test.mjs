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

test('storeSubscription inserts a subscription document through Vault handle endpoint', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({status: 'ok', insertedId: 'sub-1'}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });
    const subscription = {
        status: 'active',
        title: 'Solo Leveling',
        subscriber: {
            discordId: 'discord-user-1',
        },
    };

    const payload = await vault.storeSubscription(subscription);

    assert.equal(payload.insertedId, 'sub-1');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'insert',
        payload: {
            collection: 'portal_subscriptions',
            data: subscription,
        },
    });
});

test('findSubscriptions queries Vault findMany through packet endpoint', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (_url, options) => {
            calls.push({options});
            return new Response(JSON.stringify({
                status: 'ok',
                data: [
                    {_id: 'sub-1', status: 'active'},
                    {_id: 'sub-2', status: 'paused'},
                ],
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const results = await vault.findSubscriptions({query: {status: 'active'}});

    assert.equal(results.length, 2);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'findMany',
        payload: {
            collection: 'portal_subscriptions',
            query: {status: 'active'},
        },
    });
});

test('updateSubscription sends Mongo update packets for portal subscriptions', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (_url, options) => {
            calls.push({options});
            return new Response(JSON.stringify({status: 'ok', matched: 1, modified: 1}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const result = await vault.updateSubscription({
        query: {_id: 'sub-1'},
        update: {$set: {'notifications.lastChapterDmAt': '2026-03-08T00:00:00.000Z'}},
    });

    assert.equal(result.matched, 1);
    assert.equal(result.modified, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'mongo',
        operation: 'update',
        payload: {
            collection: 'portal_subscriptions',
            query: {_id: 'sub-1'},
            update: {$set: {'notifications.lastChapterDmAt': '2026-03-08T00:00:00.000Z'}},
            upsert: false,
        },
    });
});

test('storeSubscription and updateSubscription validate payloads', async () => {
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async () => {
            throw new Error('fetchImpl should not be called for invalid payloads');
        },
    });

    await assert.rejects(() => vault.storeSubscription(null), /must be an object/i);
    await assert.rejects(
        () => vault.updateSubscription({query: {}, update: {$set: {status: 'active'}}}),
        /query must be a non-empty object/i,
    );
    await assert.rejects(
        () => vault.updateSubscription({query: {_id: 'sub-1'}, update: {}}),
        /update payload must be a non-empty object/i,
    );
});

test('redisSet, redisGet, and redisDel proxy Redis packets through Vault handle endpoint', async () => {
    const calls = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            const body = JSON.parse(options.body);
            if (body.operation === 'get') {
                return new Response(JSON.stringify({status: 'ok', data: [{id: 'queued-1'}]}), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }

            return new Response(JSON.stringify({status: 'ok'}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    await vault.redisSet('portal:discord:dm:user-1', [{id: 'queued-1'}], {ttl: 120});
    const queue = await vault.redisGet('portal:discord:dm:user-1');
    await vault.redisDel('portal:discord:dm:user-1');

    assert.deepEqual(queue, [{id: 'queued-1'}]);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'redis',
        operation: 'set',
        payload: {
            key: 'portal:discord:dm:user-1',
            value: [{id: 'queued-1'}],
            ttl: 120,
        },
    });
    assert.deepEqual(JSON.parse(calls[1].options.body), {
        storageType: 'redis',
        operation: 'get',
        payload: {
            key: 'portal:discord:dm:user-1',
        },
    });
    assert.deepEqual(JSON.parse(calls[2].options.body), {
        storageType: 'redis',
        operation: 'del',
        payload: {
            key: 'portal:discord:dm:user-1',
        },
    });
});

test('redisRPush and redisLPop proxy Redis list packets through Vault handle endpoint', async () => {
    const calls = [];
    const queue = [];
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async (_url, options) => {
            calls.push({options});
            const body = JSON.parse(options.body);
            if (body.operation === 'rpush') {
                queue.push(body.payload.value);
                return new Response(JSON.stringify({status: 'ok', length: queue.length}), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }

            if (body.operation === 'lpop') {
                const next = queue.shift() ?? null;
                return new Response(JSON.stringify({status: 'ok', data: next}), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }

            return new Response(JSON.stringify({status: 'ok'}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    await vault.redisRPush('portal:discord:dm:user-1', {id: 'queued-1'}, {ttl: 120});
    const queued = await vault.redisLPop('portal:discord:dm:user-1');

    assert.deepEqual(queued, {id: 'queued-1'});
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        storageType: 'redis',
        operation: 'rpush',
        payload: {
            key: 'portal:discord:dm:user-1',
            value: {id: 'queued-1'},
            ttl: 120,
        },
    });
    assert.deepEqual(JSON.parse(calls[1].options.body), {
        storageType: 'redis',
        operation: 'lpop',
        payload: {
            key: 'portal:discord:dm:user-1',
        },
    });
});

test('findRecommendations retries transient internal Vault packet errors', async () => {
    let attempts = 0;
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async () => {
            attempts += 1;
            if (attempts < 3) {
                return new Response(JSON.stringify({error: 'Internal server error'}), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }

            return new Response(JSON.stringify({status: 'ok', data: [{_id: 'rec-1'}]}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const recommendations = await vault.findRecommendations();
    assert.equal(attempts, 3);
    assert.deepEqual(recommendations, [{_id: 'rec-1'}]);
});

test('storeRecommendation includes Vault error text in thrown request errors', async () => {
    const vault = createVaultClient({
        baseUrl: 'http://noona-vault:3005',
        token: 'vault-token',
        fetchImpl: async () =>
            new Response(JSON.stringify({error: 'Unsupported operation "insert" for mongo'}), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                },
            }),
    });

    await assert.rejects(
        () =>
            vault.storeRecommendation({
                source: 'discord',
                title: 'Naruto',
            }),
        /Unsupported operation "insert" for mongo/i,
    );
});
