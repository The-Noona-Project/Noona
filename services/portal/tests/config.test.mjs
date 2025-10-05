import assert from 'node:assert/strict';
import test from 'node:test';

import { safeLoadPortalConfig } from '../shared/config.mjs';

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
