// services/portal/config/portalConfig.mjs

import dotenv from 'dotenv';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const DEFAULT_ENV_PATH = process.env.PORTAL_ENV_FILE || process.env.ENV_FILE || undefined;
let envLoaded = false;
const DEFAULT_MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000';
const DEFAULT_RAVEN_BASE_URL = 'http://noona-raven:8080';
const DEFAULT_WARDEN_BASE_URL = 'http://noona-warden:4001';

const REQUIRED_STRINGS = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'KAVITA_API_KEY',
    'VAULT_BASE_URL',
    'VAULT_ACCESS_TOKEN',
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

    return missing;
};

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

    const discordRole = normalizeString(env.DISCORD_GUILD_ROLE_ID) || normalizeString(env.DISCORD_DEFAULT_ROLE_ID) || null;

    const config = {
        serviceName: normalizeString(env.SERVICE_NAME) || 'noona-portal',
        port: numberOrDefault(env.PORTAL_PORT ?? env.API_PORT, 3003),
        discord: {
            token: env.DISCORD_BOT_TOKEN,
            clientId: env.DISCORD_CLIENT_ID,
            guildId: env.DISCORD_GUILD_ID,
            defaultRoleId: discordRole,
        },
        kavita: {
            baseUrl: normalizeUrl(env.KAVITA_BASE_URL || DEFAULT_MANAGED_KAVITA_BASE_URL),
            apiKey: env.KAVITA_API_KEY,
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
        },
        join: {
            defaultRoles: splitCsv(env.PORTAL_JOIN_DEFAULT_ROLES ?? '*,-admin'),
            defaultLibraries: splitCsv(env.PORTAL_JOIN_DEFAULT_LIBRARIES ?? '*'),
        },
        activity: {
            pollMs: numberOrDefault(env.PORTAL_ACTIVITY_POLL_MS, 15000),
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

    if (!config.vault.baseUrl) {
        throw new Error('VAULT_BASE_URL must be a valid absolute URL.');
    }

    if (!config.raven.baseUrl) {
        throw new Error('RAVEN_BASE_URL must be a valid absolute URL.');
    }

    if (!config.warden.baseUrl) {
        throw new Error('WARDEN_BASE_URL must be a valid absolute URL.');
    }

    log(`[${config.serviceName}] Loaded configuration for Discord guild ${config.discord.guildId}`);

    return Object.freeze(config);
};

export const safeLoadPortalConfig = (overrides = {}) => {
    try {
        return loadPortalConfig(overrides);
    } catch (error) {
        errMSG(`[Portal Config] Failed to load configuration: ${error.message}`);
        throw error;
    }
};

export default loadPortalConfig;
