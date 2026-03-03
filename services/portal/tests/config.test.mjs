import assert from 'node:assert/strict';
import test from 'node:test';

import {safeLoadPortalConfig} from '../config/portalConfig.mjs';

const REQUIRED_ENV = {
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_GUILD_ID: 'guild-id',
    KAVITA_BASE_URL: 'https://kavita.example',
    KAVITA_API_KEY: 'kavita-api-key',
    VAULT_BASE_URL: 'https://vault.example',
};

test('safeLoadPortalConfig uses VAULT_API_TOKEN when override is provided', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: undefined,
        VAULT_API_TOKEN: 'api-token-override',
    });

    assert.equal(config.vault.token, 'api-token-override');
});

test('safeLoadPortalConfig parses join defaults from csv env values', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        PORTAL_JOIN_DEFAULT_ROLES: '*, -admin, *, -ADMIN',
        PORTAL_JOIN_DEFAULT_LIBRARIES: '*, 12, *',
    });

    assert.deepEqual(config.join.defaultRoles, ['*', '-admin']);
    assert.deepEqual(config.join.defaultLibraries, ['*', '12']);
});

test('safeLoadPortalConfig throws when no vault tokens are provided', () => {
    assert.throws(
        () =>
            safeLoadPortalConfig({
                ...REQUIRED_ENV,
                VAULT_ACCESS_TOKEN: undefined,
                VAULT_API_TOKEN: undefined,
            }),
        /Missing required environment variables: VAULT_ACCESS_TOKEN/,
    );
});

test('safeLoadPortalConfig defaults Kavita base URL to the managed noona-kavita service', () => {
    const config = safeLoadPortalConfig({
        DISCORD_BOT_TOKEN: 'bot-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        KAVITA_API_KEY: 'kavita-api-key',
        VAULT_BASE_URL: 'https://vault.example',
        VAULT_ACCESS_TOKEN: 'vault-token',
    });

    assert.equal(config.kavita.baseUrl, 'http://noona-kavita:5000/');
});

test('safeLoadPortalConfig defaults /join access to all non-admin roles and all libraries', () => {
    const config = safeLoadPortalConfig({
        DISCORD_BOT_TOKEN: 'bot-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        KAVITA_API_KEY: 'kavita-api-key',
        VAULT_BASE_URL: 'https://vault.example',
        VAULT_ACCESS_TOKEN: 'vault-token',
    });

    assert.deepEqual(config.join.defaultRoles, ['*', '-admin']);
    assert.deepEqual(config.join.defaultLibraries, ['*']);
});
