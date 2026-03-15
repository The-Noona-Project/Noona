/**
 * @fileoverview Covers Portal config loading, normalization, and validation behavior.
 * Related files:
 * - config/portalConfig.mjs
 * Times this file has been edited: 12
 */

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

const REQUIRED_ENV_WITHOUT_DISCORD = {
    KAVITA_API_KEY: 'kavita-api-key',
    VAULT_BASE_URL: 'https://vault.example',
    VAULT_ACCESS_TOKEN: 'vault-token',
};

test('safeLoadPortalConfig allows startup without Discord env', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV_WITHOUT_DISCORD,
    });

    assert.equal(config.discord.enabled, false);
    assert.equal(config.discord.token, null);
    assert.equal(config.discord.clientId, null);
    assert.equal(config.discord.guildId, null);
});

test('safeLoadPortalConfig throws when Discord env is partially configured', () => {
    assert.throws(
        () =>
            safeLoadPortalConfig({
                ...REQUIRED_ENV_WITHOUT_DISCORD,
                DISCORD_BOT_TOKEN: 'bot-token',
                DISCORD_GUILD_ID: 'guild-id',
            }),
        /Missing required environment variables: DISCORD_CLIENT_ID/,
    );
});

test('safeLoadPortalConfig uses VAULT_API_TOKEN when override is provided', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: undefined,
        VAULT_API_TOKEN: 'api-token-override',
    });

    assert.equal(config.vault.token, 'api-token-override');
});

test('safeLoadPortalConfig parses website onboarding defaults from csv env values', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        PORTAL_JOIN_DEFAULT_ROLES: '*, -admin, *, -ADMIN',
        PORTAL_JOIN_DEFAULT_LIBRARIES: '*, 12, *',
    });

    assert.deepEqual(config.join.defaultRoles, ['*', '-admin']);
    assert.deepEqual(config.join.defaultLibraries, ['*', '12']);
});

test('safeLoadPortalConfig parses recommendation notifier poll interval', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        PORTAL_RECOMMENDATION_POLL_MS: '45000',
    });

    assert.equal(config.recommendations.pollMs, 45000);
});

test('safeLoadPortalConfig defaults Portal Redis namespaces for onboarding and DM queues', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
    });

    assert.equal(config.redis.onboardingNamespace, 'portal:onboarding');
    assert.equal(config.redis.directMessageNamespace, 'portal:discord:dm');
});

test('safeLoadPortalConfig parses Portal Redis namespace overrides', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        PORTAL_REDIS_NAMESPACE: 'portal:custom:onboarding',
        PORTAL_DM_QUEUE_NAMESPACE: 'portal:custom:dm',
    });

    assert.equal(config.redis.onboardingNamespace, 'portal:custom:onboarding');
    assert.equal(config.redis.directMessageNamespace, 'portal:custom:dm');
});

test('safeLoadPortalConfig rejects non-portal Redis namespace overrides', () => {
    assert.throws(
        () =>
            safeLoadPortalConfig({
                ...REQUIRED_ENV,
                VAULT_ACCESS_TOKEN: 'vault-token',
                PORTAL_REDIS_NAMESPACE: 'redis:onboarding',
            }),
        /PORTAL_REDIS_NAMESPACE must start with "portal:"/i,
    );

    assert.throws(
        () =>
            safeLoadPortalConfig({
                ...REQUIRED_ENV,
                VAULT_ACCESS_TOKEN: 'vault-token',
                PORTAL_DM_QUEUE_NAMESPACE: 'discord:dm',
            }),
        /PORTAL_DM_QUEUE_NAMESPACE must start with "portal:"/i,
    );
});

test('safeLoadPortalConfig parses optional Moon base URL override', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        MOON_BASE_URL: 'http://moon.example:3000',
    });

    assert.equal(config.moon.baseUrl, 'http://moon.example:3000/');
});

test('safeLoadPortalConfig parses optional Kavita external URL override', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        KAVITA_EXTERNAL_URL: 'https://kavita.example.com',
    });

    assert.equal(config.kavita.externalUrl, 'https://kavita.example.com/');
});

test('safeLoadPortalConfig preserves the optional Discord superuser id', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        DISCORD_SUPERUSER_ID: '123456789012345678',
    });

    assert.equal(config.discord.superuserId, '123456789012345678');
});

test('safeLoadPortalConfig defaults Komf base URL to the managed noona-komf service', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
    });

    assert.equal(config.komf.baseUrl, 'http://noona-komf:8085/');
});

test('safeLoadPortalConfig parses optional Komf base URL override', () => {
    const config = safeLoadPortalConfig({
        ...REQUIRED_ENV,
        VAULT_ACCESS_TOKEN: 'vault-token',
        KOMF_BASE_URL: 'https://komf.example.com',
    });

    assert.equal(config.komf.baseUrl, 'https://komf.example.com/');
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

test('safeLoadPortalConfig defaults website onboarding access to all non-admin roles and all libraries', () => {
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
