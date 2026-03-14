export const SETUP_PROFILE_VERSION = 3;

/**
 * @typedef {'managed' | 'external'} SetupIntegrationMode
 * @typedef {Record<string, Record<string, string>>} SetupProfileValues
 *
 * @typedef {object} DeriveSetupProfileValuesOptions
 * @property {SetupProfileValues} [values]
 * @property {string[]} [serviceNames]
 * @property {SetupIntegrationMode} [kavitaMode]
 * @property {string} [kavitaBaseUrl]
 * @property {string} [kavitaApiKey]
 * @property {string} [kavitaAdminUsername]
 * @property {string} [kavitaAdminEmail]
 * @property {string} [kavitaAdminPassword]
 * @property {string} [kavitaSharedLibraryPath]
 * @property {SetupIntegrationMode} [komfMode]
 */

const normalizeString = (value) => (typeof value === 'string' ? value : '');
const trimString = (value) => normalizeString(value).trim();
const cloneValues = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const clone = {};
    for (const [key, env] of Object.entries(value)) {
        if (!env || typeof env !== 'object' || Array.isArray(env)) {
            continue;
        }

        clone[key] = {};
        for (const [envKey, envValue] of Object.entries(env)) {
            clone[key][envKey] = normalizeString(envValue);
        }
    }

    return clone;
};

const getEnvValue = (values, serviceName, key) => trimString(values?.[serviceName]?.[key]);
const setEnvValue = (values, serviceName, key, nextValue) => {
    values[serviceName] = {
        ...(values[serviceName] || {}),
        [key]: normalizeString(nextValue),
    };
};

export const deriveSetupProfileSelection = ({kavitaMode = 'managed', komfMode = 'managed'} = {}) => {
    const selected = ['noona-portal', 'noona-raven'];
    if (kavitaMode === 'managed') {
        selected.push('noona-kavita');
    }
    if (komfMode === 'managed') {
        selected.push('noona-komf');
    }

    return selected.sort((left, right) => left.localeCompare(right));
};

export const shouldShowSetupDebugDetails = (debugEnabled) => debugEnabled === true;

export const buildSetupProfileSnapshot = ({
                                              storageRoot = '',
                                              kavitaMode = 'managed',
                                              kavitaBaseUrl = '',
                                              kavitaApiKey = '',
                                              kavitaAdminUsername = '',
                                              kavitaAdminEmail = '',
                                              kavitaAdminPassword = '',
                                              kavitaSharedLibraryPath = '',
                                              komfMode = 'managed',
                                              komfBaseUrl = '',
                                              values = {},
                                          } = {}) => {
    const sourceValues = cloneValues(values);

    return {
        version: SETUP_PROFILE_VERSION,
        storageRoot: trimString(storageRoot),
        kavita: {
            mode: kavitaMode === 'external' ? 'external' : 'managed',
            baseUrl: trimString(kavitaBaseUrl),
            apiKey: trimString(kavitaApiKey),
            sharedLibraryPath: trimString(kavitaSharedLibraryPath),
            account: {
                username: trimString(kavitaAdminUsername),
                email: trimString(kavitaAdminEmail),
                password: normalizeString(kavitaAdminPassword),
            },
        },
        komf: {
            mode: komfMode === 'external' ? 'external' : 'managed',
            baseUrl: trimString(komfBaseUrl),
            applicationYml: normalizeString(getEnvValue(sourceValues, 'noona-komf', 'KOMF_APPLICATION_YML')),
        },
        discord: {
            botToken: normalizeString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_BOT_TOKEN')),
            clientId: trimString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_CLIENT_ID')),
            clientSecret: normalizeString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_CLIENT_SECRET')),
            guildId: trimString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_GUILD_ID')),
            guildRoleId: trimString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_GUILD_ROLE_ID')),
            defaultRoleId: trimString(getEnvValue(sourceValues, 'noona-portal', 'DISCORD_DEFAULT_ROLE_ID')),
            requiredRoleDing: trimString(getEnvValue(sourceValues, 'noona-portal', 'REQUIRED_ROLE_DING')),
            requiredRoleScan: trimString(getEnvValue(sourceValues, 'noona-portal', 'REQUIRED_ROLE_SCAN')),
            requiredRoleSearch: trimString(getEnvValue(sourceValues, 'noona-portal', 'REQUIRED_ROLE_SEARCH')),
            requiredRoleRecommend: trimString(getEnvValue(sourceValues, 'noona-portal', 'REQUIRED_ROLE_RECOMMEND')),
            requiredRoleSubscribe: trimString(getEnvValue(sourceValues, 'noona-portal', 'REQUIRED_ROLE_SUBSCRIBE')),
            joinDefaultRoles: normalizeString(getEnvValue(sourceValues, 'noona-portal', 'PORTAL_JOIN_DEFAULT_ROLES')),
            joinDefaultLibraries: normalizeString(getEnvValue(sourceValues, 'noona-portal', 'PORTAL_JOIN_DEFAULT_LIBRARIES')),
        },
    };
};

/**
 * @param {DeriveSetupProfileValuesOptions} [options]
 * @returns {SetupProfileValues}
 */
export const deriveSetupProfileValues = ({
                                             values = {},
                                             serviceNames = [],
                                             kavitaMode = 'managed',
                                             kavitaBaseUrl = '',
                                             kavitaApiKey = '',
                                             kavitaAdminUsername = '',
                                             kavitaAdminEmail = '',
                                             kavitaAdminPassword = '',
                                             kavitaSharedLibraryPath = '',
                                             komfMode = 'managed',
                                         } = {}) => {
    const nextValues = cloneValues(values);
    const sourceServiceNames =
        Array.isArray(serviceNames) && serviceNames.length > 0
            ? serviceNames
            : Object.keys(nextValues);
    const availableServices = new Set(
        sourceServiceNames
            .map((serviceName) => trimString(serviceName))
            .filter(Boolean),
    );
    const resolvedKavitaBaseUrl = kavitaMode === 'managed' ? 'http://noona-kavita:5000' : trimString(kavitaBaseUrl);

    const mergeEnv = (serviceName, patch) => {
        if (!availableServices.has(serviceName)) {
            return;
        }

        nextValues[serviceName] = {
            ...(nextValues[serviceName] || {}),
            ...patch,
        };
    };

    mergeEnv('noona-portal', {
        KAVITA_BASE_URL: resolvedKavitaBaseUrl,
        KAVITA_API_KEY: trimString(kavitaApiKey),
    });
    mergeEnv('noona-raven', {
        KAVITA_DATA_MOUNT: kavitaMode === 'external' ? trimString(kavitaSharedLibraryPath) : '',
        KAVITA_BASE_URL: resolvedKavitaBaseUrl,
        KAVITA_API_KEY: trimString(kavitaApiKey),
        KAVITA_LIBRARY_ROOT: kavitaMode === 'managed' ? '/manga' : normalizeString(nextValues['noona-raven']?.KAVITA_LIBRARY_ROOT),
    });
    mergeEnv('noona-kavita', {
        KAVITA_ADMIN_USERNAME: kavitaMode === 'managed' ? trimString(kavitaAdminUsername) : '',
        KAVITA_ADMIN_EMAIL: kavitaMode === 'managed' ? trimString(kavitaAdminEmail) : '',
        KAVITA_ADMIN_PASSWORD: kavitaMode === 'managed' ? trimString(kavitaAdminPassword) : '',
    });
    mergeEnv('noona-komf', {
        KOMF_KAVITA_BASE_URI: resolvedKavitaBaseUrl,
        KOMF_KAVITA_API_KEY: komfMode === 'managed' ? trimString(kavitaApiKey) : normalizeString(nextValues['noona-komf']?.KOMF_KAVITA_API_KEY),
    });

    return nextValues;
};

export const hydrateSetupProfileState = ({
                                             snapshot = null,
                                             values = {},
                                             defaultStorageRoot = '',
                                             defaultSharedLibraryPath = '',
                                         } = {}) => {
    const nextValues = cloneValues(values);
    const profile = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
    const kavita = profile?.kavita && typeof profile.kavita === 'object' ? profile.kavita : {};
    const komf = profile?.komf && typeof profile.komf === 'object' ? profile.komf : {};
    const discord = profile?.discord && typeof profile.discord === 'object' ? profile.discord : {};

    setEnvValue(nextValues, 'noona-portal', 'DISCORD_BOT_TOKEN', normalizeString(discord.botToken));
    setEnvValue(nextValues, 'noona-portal', 'DISCORD_CLIENT_ID', normalizeString(discord.clientId));
    setEnvValue(nextValues, 'noona-portal', 'DISCORD_CLIENT_SECRET', normalizeString(discord.clientSecret));
    setEnvValue(nextValues, 'noona-portal', 'DISCORD_GUILD_ID', normalizeString(discord.guildId));
    setEnvValue(nextValues, 'noona-portal', 'DISCORD_GUILD_ROLE_ID', normalizeString(discord.guildRoleId));
    setEnvValue(nextValues, 'noona-portal', 'DISCORD_DEFAULT_ROLE_ID', normalizeString(discord.defaultRoleId));
    setEnvValue(nextValues, 'noona-portal', 'REQUIRED_ROLE_DING', normalizeString(discord.requiredRoleDing));
    setEnvValue(nextValues, 'noona-portal', 'REQUIRED_ROLE_SCAN', normalizeString(discord.requiredRoleScan));
    setEnvValue(nextValues, 'noona-portal', 'REQUIRED_ROLE_SEARCH', normalizeString(discord.requiredRoleSearch));
    setEnvValue(nextValues, 'noona-portal', 'REQUIRED_ROLE_RECOMMEND', normalizeString(discord.requiredRoleRecommend));
    setEnvValue(nextValues, 'noona-portal', 'REQUIRED_ROLE_SUBSCRIBE', normalizeString(discord.requiredRoleSubscribe));
    setEnvValue(nextValues, 'noona-portal', 'PORTAL_JOIN_DEFAULT_ROLES', normalizeString(discord.joinDefaultRoles));
    setEnvValue(nextValues, 'noona-portal', 'PORTAL_JOIN_DEFAULT_LIBRARIES', normalizeString(discord.joinDefaultLibraries));
    setEnvValue(nextValues, 'noona-komf', 'KOMF_APPLICATION_YML', normalizeString(komf.applicationYml));

    return {
        storageRoot: trimString(profile.storageRoot) || trimString(defaultStorageRoot),
        kavitaMode: kavita.mode === 'external' ? 'external' : 'managed',
        kavitaBaseUrl: trimString(kavita.baseUrl) || 'http://noona-kavita:5000',
        kavitaApiKey: normalizeString(kavita.apiKey),
        kavitaAdminUsername: trimString(kavita?.account?.username),
        kavitaAdminEmail: trimString(kavita?.account?.email),
        kavitaAdminPassword: normalizeString(kavita?.account?.password),
        kavitaAdminPasswordConfirm: normalizeString(kavita?.account?.password),
        kavitaSharedLibraryPath: trimString(kavita.sharedLibraryPath) || trimString(defaultSharedLibraryPath),
        komfMode: komf.mode === 'external' ? 'external' : 'managed',
        komfBaseUrl: trimString(komf.baseUrl),
        values: nextValues,
    };
};
