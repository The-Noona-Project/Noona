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

test('buildVaultTokenRegistry prefers environment overrides, then defaults', () => {
    const registry = buildVaultTokenRegistry(['noona-sage', 'noona-moon', 'custom-service'], {
        env: { NOONA_SAGE_VAULT_TOKEN: 'env-token' },
        defaults: { 'custom-service': 'custom-default-token' },
        generator: () => 'generated-token',
    });

    assert.deepEqual(registry, {
        'noona-sage': 'env-token',
        'noona-moon': 'generated-token',
        'custom-service': 'custom-default-token',
    });
});

test('buildVaultTokenRegistry skips invalid names', () => {
    const registry = buildVaultTokenRegistry(['', null, undefined, '  ', 'noona-portal'], {
        generator: () => 'generated-token',
    });

    assert.deepEqual(registry, { 'noona-portal': 'noona-portal-dev-token' });
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
