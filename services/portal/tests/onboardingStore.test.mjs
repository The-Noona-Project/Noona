/**
 * @fileoverview Covers Portal onboarding token persistence through Vault-backed Redis helpers.
 * Related files:
 * - storage/onboardingStore.mjs
 * - app/portalRuntime.mjs
 * Times this file has been edited: 1
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {createOnboardingStore} from '../storage/onboardingStore.mjs';

test('createOnboardingStore requires Vault Redis helpers', () => {
    assert.throws(
        () => createOnboardingStore(),
        /Vault Redis helpers are required/i,
    );
});

test('createOnboardingStore stores, loads, and consumes onboarding tokens through Vault Redis helpers', async () => {
    const records = new Map();
    const calls = [];
    const store = createOnboardingStore({
        namespace: 'portal:test:onboarding',
        ttlSeconds: 321,
        vaultClient: {
            redisSet: async (key, value, options) => {
                calls.push({type: 'set', key, value, options});
                records.set(key, structuredClone(value));
                return {status: 'ok'};
            },
            redisGet: async (key) => {
                calls.push({type: 'get', key});
                return structuredClone(records.get(key) ?? null);
            },
            redisDel: async (key) => {
                calls.push({type: 'del', key});
                records.delete(key);
                return {status: 'ok', deleted: 1};
            },
        },
    });

    const created = await store.setToken('discord-user-1', {
        token: 'token-1',
        type: 'noona-kavita-login',
    });
    const loaded = await store.getToken('token-1');
    const consumed = await store.consumeToken('token-1');
    const missing = await store.getToken('token-1');

    assert.equal(created.token, 'token-1');
    assert.equal(created.discordId, 'discord-user-1');
    assert.equal(created.type, 'noona-kavita-login');
    assert.match(created.createdAt, /\d{4}-\d{2}-\d{2}T/);

    assert.deepEqual(loaded, created);
    assert.deepEqual(consumed, created);
    assert.equal(missing, null);

    assert.deepEqual(calls, [
        {
            type: 'set',
            key: 'portal:test:onboarding:token-1',
            value: created,
            options: {ttl: 321},
        },
        {
            type: 'get',
            key: 'portal:test:onboarding:token-1',
        },
        {
            type: 'get',
            key: 'portal:test:onboarding:token-1',
        },
        {
            type: 'del',
            key: 'portal:test:onboarding:token-1',
        },
        {
            type: 'get',
            key: 'portal:test:onboarding:token-1',
        },
    ]);
});
