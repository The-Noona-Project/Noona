/**
 * @fileoverview Loads, normalizes, and validates Portal's runtime configuration.
 * Related files:
 * - app/portalRuntime.mjs
 * - tests/config.test.mjs
 * Times this file has been edited: 9
 */

import dotenv from 'dotenv';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const DEFAULT_ENV_PATH = process.env.PORTAL_ENV_FILE || process.env.ENV_FILE || undefined;
let envLoaded = false;
const DEFAULT_MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000';
const DEFAULT_MANAGED_KOMF_BASE_URL = 'http://noona-komf:8085';
const DEFAULT_RAVEN_BASE_URL = 'http://noona-raven:8080';
const DEFAULT_WARDEN_BASE_URL = 'http://noona-warden:4001';

const REQUIRED_STRINGS = [
    'KAVITA_API_KEY',
    'VAULT_BASE_URL',
    'VAULT_ACCESS_TOKEN',
];

const DISCORD_REQUIRED_STRINGS = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
];

const numberOrDefault = (value, fallback) => {
    if (value == null || value === '') {
        return fallback;
    }

    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeString = value => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const splitCsv = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return [];
    }

    const seen = new Set();
    const values = [];

    for (const entry of normalized.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }

        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        values.push(trimmed);
    }

    return values;
};

const normalizeUrl = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized).toString();
    } catch (error) {
        return null;
    }
};

const resolveEnv = (overrides = {}) => ({
    ...process.env,
    ...overrides,
});

const collectMissing = (env) => {
    const missing = [];

    const hasVaultToken =
        normalizeString(env.VAULT_ACCESS_TOKEN) ||
        normalizeString(env.VAULT_API_TOKEN);

    for (const key of REQUIRED_STRINGS) {
        if (key === 'VAULT_ACCESS_TOKEN') {
            if (!hasVaultToken) {
                missing.push(key);
            }
            continue;
        }

        if (!normalizeString(env[key])) {
            missing.push(key);
        }
    }

    const hasAnyDiscordConfig = DISCORD_REQUIRED_STRINGS.some((key) => normalizeString(env[key]));
    if (hasAnyDiscordConfig) {
        for (const key of DISCORD_REQUIRED_STRINGS) {
            if (!normalizeString(env[key])) {
                missing.push(key);
            }
        }
    }

    return missing;
};

/**
 * Loads, validates, and freezes Portal configuration.
 *
 * @param {*} overrides - Input passed to the function.
 * @returns {*} The function result.
 */
export const loadPortalConfig = (overrides = {}) => {
    if (!envLoaded) {
        dotenv.config({path: DEFAULT_ENV_PATH});
        envLoaded = true;
    }

    const env = resolveEnv(overrides);

    const missing = collectMissing(env);
    if (missing.length > 0) {
        const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
        error.code = 'PORTAL_ENV_VALIDATION_ERROR';
        throw error;
    }

    const discordToken = normalizeString(env.DISCORD_BOT_TOKEN);
    const discordClientId = normalizeString(env.DISCORD_CLIENT_ID);
    const discordGuildId = normalizeString(env.DISCORD_GUILD_ID);
    const discordRole = normalizeString(env.DISCORD_GUILD_ROLE_ID) || normalizeString(env.DISCORD_DEFAULT_ROLE_ID) || null;
    const discordEnabled = Boolean(discordToken && discordClientId && discordGuildId);

    const config = {
        serviceName: normalizeString(env.SERVICE_NAME) || 'noona-portal',
        port: numberOrDefault(env.PORTAL_PORT ?? env.API_PORT, 3003),
        discord: {
            enabled: discordEnabled,
            token: discordToken,
            clientId: discordClientId,
            guildId: discordGuildId,
            defaultRoleId: discordRole,
        },
        kavita: {
            baseUrl: normalizeUrl(env.KAVITA_BASE_URL || DEFAULT_MANAGED_KAVITA_BASE_URL),
            apiKey: env.KAVITA_API_KEY,
            externalUrl: normalizeUrl(env.KAVITA_EXTERNAL_URL),
        },
        komf: {
            baseUrl: normalizeString(env.KOMF_BASE_URL)
                ? normalizeUrl(env.KOMF_BASE_URL)
                : normalizeUrl(DEFAULT_MANAGED_KOMF_BASE_URL),
        },
        raven: {
            baseUrl: normalizeUrl(env.RAVEN_BASE_URL || DEFAULT_RAVEN_BASE_URL),
        },
        vault: {
            baseUrl: normalizeUrl(env.VAULT_BASE_URL),
            token:
                normalizeString(env.VAULT_API_TOKEN) ||
                normalizeString(env.VAULT_ACCESS_TOKEN),
        },
        warden: {
            baseUrl: normalizeUrl(env.WARDEN_BASE_URL || DEFAULT_WARDEN_BASE_URL),
            token:
                normalizeString(env.WARDEN_API_TOKEN) ||
                normalizeString(env.WARDEN_ACCESS_TOKEN),
        },
        moon: {
            baseUrl: normalizeUrl(env.MOON_BASE_URL),
        },
        join: {
            defaultRoles: splitCsv(env.PORTAL_JOIN_DEFAULT_ROLES ?? '*,-admin'),
            defaultLibraries: splitCsv(env.PORTAL_JOIN_DEFAULT_LIBRARIES ?? '*'),
        },
        activity: {
            pollMs: numberOrDefault(env.PORTAL_ACTIVITY_POLL_MS, 15000),
        },
        recommendations: {
            pollMs: numberOrDefault(env.PORTAL_RECOMMENDATION_POLL_MS, 30000),
        },
        redis: {
            namespace: normalizeString(env.PORTAL_REDIS_NAMESPACE) || 'portal:onboarding',
            ttlSeconds: numberOrDefault(env.PORTAL_TOKEN_TTL, 900),
        },
        http: {
            timeoutMs: numberOrDefault(env.PORTAL_HTTP_TIMEOUT, 10000),
        },
    };

    if (!config.kavita.baseUrl) {
        throw new Error('KAVITA_BASE_URL must be a valid absolute URL.');
    }

    if (!config.komf.baseUrl) {
        throw new Error('KOMF_BASE_URL must be a valid absolute URL.');
    }

    if (!config.vault.baseUrl) {
        throw new Error('VAULT_BASE_URL must be a valid absolute URL.');
    }

    if (!config.raven.baseUrl) {
        throw new Error('RAVEN_BASE_URL must be a valid absolute URL.');
    }

    if (!config.warden.baseUrl) {
        throw new Error('WARDEN_BASE_URL must be a valid absolute URL.');
    }

    if (config.discord.enabled) {
        log(`[${config.serviceName}] Loaded configuration for Discord guild ${config.discord.guildId}`);
    } else {
        log(`[${config.serviceName}] Loaded configuration with Discord integration disabled.`);
    }

    return Object.freeze(config);
};

/**
 * Loads Portal configuration and logs failures before rethrowing them.
 *
 * @param {*} overrides - Input passed to the function.
 * @returns {*} The function result.
 */
export const safeLoadPortalConfig = (overrides = {}) => {
    try {
        return loadPortalConfig(overrides);
    } catch (error) {
        errMSG(`[Portal Config] Failed to load configuration: ${error.message}`);
        throw error;
    }
};

export default loadPortalConfig;
