// services/warden/tests/vaultTokens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildVaultTokenRegistry,
    generateVaultToken,
    stringifyTokenMap,
    __testables__,
} from '../docker/vaultTokens.mjs';

test('generateVaultToken produces deterministic prefix with entropy', () => {
    const stubRandom = () => Buffer.from('0123456789abcdef0123456789abcdef0123', 'hex');
    const token = generateVaultToken('noona-sage', stubRandom);

    assert.match(token, /^noonasage-[0-9a-f]+$/);
    assert.equal(token.split('-')[1], '0123456789abcdef0123456789abcdef0123');
});

test('buildVaultTokenRegistry prefers environment overrides and caches generated tokens', () => {
    const cache = new Map();
    const calls = [];
    const registry = buildVaultTokenRegistry(['noona-sage', 'noona-moon', 'custom-service'], {
        env: { NOONA_SAGE_VAULT_TOKEN: 'env-token' },
        generator: (name) => {
            calls.push(name);
            return `${name}-generated`;
        },
        cache,
    });

    assert.deepEqual(registry, {
        'noona-sage': 'env-token',
        'noona-moon': 'noona-moon-generated',
        'custom-service': 'custom-service-generated',
    });
    assert.deepEqual(calls, ['noona-moon', 'custom-service']);

    const cachedRegistry = buildVaultTokenRegistry(['noona-moon', 'custom-service'], {
        env: {},
        generator: () => {
            throw new Error('generator should not be called when cache populated');
        },
        cache,
    });

    assert.deepEqual(cachedRegistry, {
        'noona-moon': 'noona-moon-generated',
        'custom-service': 'custom-service-generated',
    });
});

test('buildVaultTokenRegistry skips invalid names', () => {
    const registry = buildVaultTokenRegistry(['', null, undefined, '  ', 'noona-portal'], {
        generator: () => 'generated-token',
        cache: new Map(),
    });

    assert.deepEqual(registry, { 'noona-portal': 'generated-token' });
});

test('stringifyTokenMap produces sorted, trimmed pairs', () => {
    const map = stringifyTokenMap({
        'noona-zeta': ' token-z ',
        'noona-alpha': 'token-a',
        '': 'ignored',
    });

    assert.equal(map, 'noona-alpha:token-a,noona-zeta:token-z');
});

test('normalizeEnvKey helper formats service names for env lookup', () => {
    const { normalizeEnvKey } = __testables__;
    assert.equal(normalizeEnvKey('noona-sage'), 'NOONA_SAGE_VAULT_TOKEN');
    assert.equal(normalizeEnvKey('noona-portal'), 'NOONA_PORTAL_VAULT_TOKEN');
});

test('setup wizard uses generated Vault tokens in VAULT_API_TOKEN fields', async () => {
    const { generatedTokenCache } = __testables__;
    generatedTokenCache.clear();

    const services = [
        'noona-sage',
        'noona-moon',
        'noona-oracle',
        'noona-raven',
        'noona-portal',
        'noona-vault',
    ];

    for (const name of services) {
        generatedTokenCache.set(name, `${name}-cached-token`);
    }

    const module = await import('../docker/noonaDockers.mjs?test=setup');
    const { default: noonaDockers } = module;

    for (const name of services) {
        const service = noonaDockers[name];
        assert.ok(service, `Service ${name} should exist in setup wizard definition.`);

        const token = `${name}-cached-token`;
        assert.ok(
            service.env.includes(`VAULT_API_TOKEN=${token}`),
            `Service ${name} env should include generated Vault token.`,
        );

        const field = service.envConfig.find((item) => item.key === 'VAULT_API_TOKEN');
        if (field) {
            assert.equal(field.defaultValue, token);
        }
    }
});

test('noona-portal descriptor exposes Redis and HTTP defaults', async () => {
    const module = await import('../docker/noonaDockers.mjs?test=portal-env');
    const { default: noonaDockers } = module;

    const portal = noonaDockers['noona-portal'];
    assert.ok(portal, 'Portal service descriptor should be defined.');

    const expectations = [
        ['PORTAL_REDIS_NAMESPACE', 'portal:onboarding'],
        ['PORTAL_TOKEN_TTL', '900'],
        ['PORTAL_HTTP_TIMEOUT', '10000'],
    ];

    for (const [key, value] of expectations) {
        assert.ok(
            portal.env.includes(`${key}=${value}`),
            `${key} should be exported with its default of ${value}.`,
        );

        const field = portal.envConfig.find((entry) => entry.key === key);
        assert.ok(field, `Portal envConfig should include ${key}.`);
        assert.equal(field.defaultValue, value, `${key} default should match implicit behavior.`);
        assert.equal(field.required, false, `${key} should be optional in setup UI.`);
    }
});

test('noona-vault descriptor exposes storage connection environment fields', async () => {
    const module = await import('../docker/noonaDockers.mjs?test=storage-env');
    const { default: noonaDockers } = module;

    const vault = noonaDockers['noona-vault'];
    assert.ok(vault, 'Vault service descriptor should be defined.');

    const expectedEnv = new Set([
        'MONGO_URI=mongodb://noona-mongo:27017',
        'REDIS_HOST=noona-redis',
        'REDIS_PORT=6379',
    ]);

    for (const entry of expectedEnv) {
        assert.ok(
            vault.env.includes(entry),
            `Vault env array should include ${entry}.`,
        );
    }

    const configByKey = new Map(vault.envConfig.map((field) => [field.key, field]));

    for (const [key, value] of [
        ['MONGO_URI', 'mongodb://noona-mongo:27017'],
        ['REDIS_HOST', 'noona-redis'],
        ['REDIS_PORT', '6379'],
    ]) {
        assert.ok(configByKey.has(key), `Vault envConfig should include ${key}.`);
        assert.equal(configByKey.get(key).defaultValue, value, `${key} default should match implicit behavior.`);
    }
});
