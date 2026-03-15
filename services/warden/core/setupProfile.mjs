const MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000';
const PLACEHOLDER_SECRET = '********';
const MANAGED_SERVICE_ALIASES = Object.freeze({
    kavita: 'noona-kavita',
    komf: 'noona-komf',
});
const DISCORD_PORTAL_ENV_KEYS = Object.freeze({
    botToken: 'DISCORD_BOT_TOKEN',
    clientId: 'DISCORD_CLIENT_ID',
    clientSecret: 'DISCORD_CLIENT_SECRET',
    guildId: 'DISCORD_GUILD_ID',
    guildRoleId: 'DISCORD_GUILD_ROLE_ID',
    defaultRoleId: 'DISCORD_DEFAULT_ROLE_ID',
    superuserId: 'DISCORD_SUPERUSER_ID',
    requiredRoleDing: 'REQUIRED_ROLE_DING',
    requiredRoleScan: 'REQUIRED_ROLE_SCAN',
    requiredRoleSearch: 'REQUIRED_ROLE_SEARCH',
    requiredRoleRecommend: 'REQUIRED_ROLE_RECOMMEND',
    requiredRoleSubscribe: 'REQUIRED_ROLE_SUBSCRIBE',
    joinDefaultRoles: 'PORTAL_JOIN_DEFAULT_ROLES',
    joinDefaultLibraries: 'PORTAL_JOIN_DEFAULT_LIBRARIES',
});
const PROFILE_SECRET_PATHS = Object.freeze([
    ['kavita', 'apiKey'],
    ['kavita', 'account', 'password'],
    ['discord', 'botToken'],
    ['discord', 'clientSecret'],
]);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeOptionalString = (value) => {
    const normalized = normalizeString(value);
    return normalized || '';
};
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clonePlainObject = (value) => (isPlainObject(value) ? JSON.parse(JSON.stringify(value)) : null);
const normalizeMode = (value, fallback = 'managed') => {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === 'external' ? 'external' : fallback;
};

const normalizeManagedServiceName = (value) => {
    const normalized = normalizeString(value);
    return MANAGED_SERVICE_ALIASES[normalized] || normalized;
};

const readPathValue = (source, pathSegments = []) => {
    let current = source;
    for (const segment of pathSegments) {
        if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return '';
        }
        current = current[segment];
    }

    return normalizeOptionalString(current);
};

const restoreMaskedSecret = (value, currentSnapshot, pathSegments) => {
    const normalized = normalizeOptionalString(value);
    if (normalized !== PLACEHOLDER_SECRET) {
        return normalized;
    }

    return readPathValue(currentSnapshot, pathSegments);
};

const parseLegacySelectedServices = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    const selected = [];
    const seen = new Set();
    for (const entry of value) {
        const name =
            typeof entry === 'string'
                ? entry
                : isPlainObject(entry)
                    ? entry.name
                    : '';
        const normalized = normalizeManagedServiceName(name);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        selected.push(normalized);
    }

    return selected;
};

const readLegacySelectedServices = (snapshot = {}) => {
    for (const key of ['selected', 'selectedServices', 'services']) {
        const selected = parseLegacySelectedServices(snapshot?.[key]);
        if (selected.length > 0) {
            return selected;
        }
    }

    return [];
};

const readLegacyValues = (snapshot = {}) => {
    if (!isPlainObject(snapshot?.values)) {
        return {};
    }

    const values = {};
    for (const [rawServiceName, rawEnv] of Object.entries(snapshot.values)) {
        const serviceName = normalizeManagedServiceName(rawServiceName);
        if (!serviceName || !isPlainObject(rawEnv)) {
            continue;
        }

        const env = {};
        for (const [rawKey, rawValue] of Object.entries(rawEnv)) {
            const key = normalizeString(rawKey);
            if (!key) {
                continue;
            }

            env[key] = normalizeOptionalString(rawValue);
        }

        values[serviceName] = env;
    }

    return values;
};

const firstNonEmpty = (...values) => {
    for (const candidate of values) {
        const normalized = normalizeOptionalString(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return '';
};

const createEmptyProfile = () => ({
    version: 3,
    storageRoot: '',
    kavita: {
        mode: 'managed',
        baseUrl: MANAGED_KAVITA_BASE_URL,
        apiKey: '',
        sharedLibraryPath: '',
        account: {
            username: '',
            email: '',
            password: '',
        },
    },
    komf: {
        mode: 'managed',
        baseUrl: '',
        applicationYml: '',
    },
    discord: {
        botToken: '',
        clientId: '',
        clientSecret: '',
        guildId: '',
        guildRoleId: '',
        defaultRoleId: '',
        superuserId: '',
        requiredRoleDing: '',
        requiredRoleScan: '',
        requiredRoleSearch: '',
        requiredRoleRecommend: '',
        requiredRoleSubscribe: '',
        joinDefaultRoles: '',
        joinDefaultLibraries: '',
    },
    savedAt: null,
});

const normalizePublicProfile = (snapshot = {}, {currentSnapshot = null} = {}) => {
    const currentProfile = isPlainObject(currentSnapshot) ? currentSnapshot : createEmptyProfile();
    const legacyValues = readLegacyValues(snapshot);
    const legacySelected = readLegacySelectedServices(snapshot);
    const legacyKavita = isPlainObject(snapshot?.integrations?.kavita) ? snapshot.integrations.kavita : {};
    const legacyKomf = isPlainObject(snapshot?.integrations?.komf) ? snapshot.integrations.komf : {};
    const publicProfile = createEmptyProfile();

    publicProfile.version = Number.isFinite(Number(snapshot?.version))
        ? Math.max(1, Math.floor(Number(snapshot.version)))
        : 3;
    publicProfile.storageRoot = firstNonEmpty(
        snapshot?.storageRoot,
        legacyValues?.['noona-vault']?.NOONA_DATA_ROOT,
        legacyValues?.['noona-raven']?.NOONA_DATA_ROOT,
        legacyValues?.['noona-kavita']?.NOONA_DATA_ROOT,
        legacyValues?.['noona-komf']?.NOONA_DATA_ROOT,
        currentProfile?.storageRoot,
    );

    const kavitaMode = normalizeMode(
        snapshot?.kavita?.mode ?? legacyKavita?.mode ?? (legacySelected.includes('noona-kavita') ? 'managed' : 'external'),
        currentProfile?.kavita?.mode || 'managed',
    );
    publicProfile.kavita.mode = kavitaMode;
    publicProfile.kavita.baseUrl = firstNonEmpty(
        snapshot?.kavita?.baseUrl,
        legacyKavita?.baseUrl,
        legacyValues?.['noona-portal']?.KAVITA_BASE_URL,
        legacyValues?.['noona-raven']?.KAVITA_BASE_URL,
        currentProfile?.kavita?.baseUrl,
        kavitaMode === 'managed' ? MANAGED_KAVITA_BASE_URL : '',
    );
    publicProfile.kavita.apiKey = restoreMaskedSecret(
        snapshot?.kavita?.apiKey ?? legacyKavita?.apiKey ?? firstNonEmpty(
            legacyValues?.['noona-portal']?.KAVITA_API_KEY,
            legacyValues?.['noona-raven']?.KAVITA_API_KEY,
            legacyValues?.['noona-komf']?.KOMF_KAVITA_API_KEY,
        ),
        currentProfile,
        ['kavita', 'apiKey'],
    );
    publicProfile.kavita.sharedLibraryPath = firstNonEmpty(
        snapshot?.kavita?.sharedLibraryPath,
        legacyKavita?.sharedLibraryPath,
        legacyValues?.['noona-raven']?.KAVITA_DATA_MOUNT,
        currentProfile?.kavita?.sharedLibraryPath,
    );
    publicProfile.kavita.account = {
        username: firstNonEmpty(
            snapshot?.kavita?.account?.username,
            legacyKavita?.account?.username,
            legacyValues?.['noona-kavita']?.KAVITA_ADMIN_USERNAME,
            currentProfile?.kavita?.account?.username,
        ),
        email: firstNonEmpty(
            snapshot?.kavita?.account?.email,
            legacyKavita?.account?.email,
            legacyValues?.['noona-kavita']?.KAVITA_ADMIN_EMAIL,
            currentProfile?.kavita?.account?.email,
        ),
        password: restoreMaskedSecret(
            snapshot?.kavita?.account?.password ?? legacyKavita?.account?.password ?? legacyValues?.['noona-kavita']?.KAVITA_ADMIN_PASSWORD,
            currentProfile,
            ['kavita', 'account', 'password'],
        ),
    };

    publicProfile.komf.mode = normalizeMode(
        snapshot?.komf?.mode ?? legacyKomf?.mode ?? (legacySelected.includes('noona-komf') ? 'managed' : 'external'),
        currentProfile?.komf?.mode || 'managed',
    );
    publicProfile.komf.baseUrl = firstNonEmpty(
        snapshot?.komf?.baseUrl,
        legacyKomf?.baseUrl,
        currentProfile?.komf?.baseUrl,
    );
    publicProfile.komf.applicationYml = firstNonEmpty(
        snapshot?.komf?.applicationYml,
        legacyValues?.['noona-komf']?.KOMF_APPLICATION_YML,
        currentProfile?.komf?.applicationYml,
    );

    publicProfile.discord = {
        botToken: restoreMaskedSecret(
            snapshot?.discord?.botToken ?? legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.botToken],
            currentProfile,
            ['discord', 'botToken'],
        ),
        clientId: firstNonEmpty(
            snapshot?.discord?.clientId,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.clientId],
            currentProfile?.discord?.clientId,
        ),
        clientSecret: restoreMaskedSecret(
            snapshot?.discord?.clientSecret ?? legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.clientSecret],
            currentProfile,
            ['discord', 'clientSecret'],
        ),
        guildId: firstNonEmpty(
            snapshot?.discord?.guildId,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.guildId],
            currentProfile?.discord?.guildId,
        ),
        guildRoleId: firstNonEmpty(
            snapshot?.discord?.guildRoleId,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.guildRoleId],
            currentProfile?.discord?.guildRoleId,
        ),
        defaultRoleId: firstNonEmpty(
            snapshot?.discord?.defaultRoleId,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.defaultRoleId],
            currentProfile?.discord?.defaultRoleId,
        ),
        superuserId: firstNonEmpty(
            snapshot?.discord?.superuserId,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.superuserId],
            currentProfile?.discord?.superuserId,
        ),
        requiredRoleDing: firstNonEmpty(
            snapshot?.discord?.requiredRoleDing,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.requiredRoleDing],
            currentProfile?.discord?.requiredRoleDing,
        ),
        requiredRoleScan: firstNonEmpty(
            snapshot?.discord?.requiredRoleScan,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.requiredRoleScan],
            currentProfile?.discord?.requiredRoleScan,
        ),
        requiredRoleSearch: firstNonEmpty(
            snapshot?.discord?.requiredRoleSearch,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.requiredRoleSearch],
            currentProfile?.discord?.requiredRoleSearch,
        ),
        requiredRoleRecommend: firstNonEmpty(
            snapshot?.discord?.requiredRoleRecommend,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.requiredRoleRecommend],
            currentProfile?.discord?.requiredRoleRecommend,
        ),
        requiredRoleSubscribe: firstNonEmpty(
            snapshot?.discord?.requiredRoleSubscribe,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.requiredRoleSubscribe],
            currentProfile?.discord?.requiredRoleSubscribe,
        ),
        joinDefaultRoles: firstNonEmpty(
            snapshot?.discord?.joinDefaultRoles,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.joinDefaultRoles],
            currentProfile?.discord?.joinDefaultRoles,
        ),
        joinDefaultLibraries: firstNonEmpty(
            snapshot?.discord?.joinDefaultLibraries,
            legacyValues?.['noona-portal']?.[DISCORD_PORTAL_ENV_KEYS.joinDefaultLibraries],
            currentProfile?.discord?.joinDefaultLibraries,
        ),
    };

    publicProfile.savedAt = normalizeOptionalString(snapshot?.savedAt) || currentProfile?.savedAt || null;
    return publicProfile;
};

export const deriveSetupProfileInternals = (snapshot = {}) => {
    const profile = normalizePublicProfile(snapshot);
    const selected = ['noona-portal', 'noona-raven'];
    if (profile.kavita.mode === 'managed') {
        selected.push('noona-kavita');
    }
    if (profile.komf.mode === 'managed') {
        selected.push('noona-komf');
    }

    const values = {};

    const kavitaBaseUrl = normalizeOptionalString(profile.kavita.baseUrl) || MANAGED_KAVITA_BASE_URL;
    const kavitaApiKey = normalizeOptionalString(profile.kavita.apiKey);

    values['noona-portal'] = {
        ...(values['noona-portal'] || {}),
        KAVITA_BASE_URL: kavitaBaseUrl,
        KAVITA_API_KEY: kavitaApiKey,
        [DISCORD_PORTAL_ENV_KEYS.botToken]: normalizeOptionalString(profile.discord.botToken),
        [DISCORD_PORTAL_ENV_KEYS.clientId]: normalizeOptionalString(profile.discord.clientId),
        [DISCORD_PORTAL_ENV_KEYS.clientSecret]: normalizeOptionalString(profile.discord.clientSecret),
        [DISCORD_PORTAL_ENV_KEYS.guildId]: normalizeOptionalString(profile.discord.guildId),
        [DISCORD_PORTAL_ENV_KEYS.guildRoleId]: normalizeOptionalString(profile.discord.guildRoleId),
        [DISCORD_PORTAL_ENV_KEYS.defaultRoleId]: normalizeOptionalString(profile.discord.defaultRoleId),
        [DISCORD_PORTAL_ENV_KEYS.superuserId]: normalizeOptionalString(profile.discord.superuserId),
        [DISCORD_PORTAL_ENV_KEYS.requiredRoleDing]: normalizeOptionalString(profile.discord.requiredRoleDing),
        [DISCORD_PORTAL_ENV_KEYS.requiredRoleScan]: normalizeOptionalString(profile.discord.requiredRoleScan),
        [DISCORD_PORTAL_ENV_KEYS.requiredRoleSearch]: normalizeOptionalString(profile.discord.requiredRoleSearch),
        [DISCORD_PORTAL_ENV_KEYS.requiredRoleRecommend]: normalizeOptionalString(profile.discord.requiredRoleRecommend),
        [DISCORD_PORTAL_ENV_KEYS.requiredRoleSubscribe]: normalizeOptionalString(profile.discord.requiredRoleSubscribe),
        [DISCORD_PORTAL_ENV_KEYS.joinDefaultRoles]: normalizeOptionalString(profile.discord.joinDefaultRoles),
        [DISCORD_PORTAL_ENV_KEYS.joinDefaultLibraries]: normalizeOptionalString(profile.discord.joinDefaultLibraries),
    };

    values['noona-raven'] = {
        ...(values['noona-raven'] || {}),
        KAVITA_BASE_URL: kavitaBaseUrl,
        KAVITA_API_KEY: kavitaApiKey,
        KAVITA_DATA_MOUNT: profile.kavita.mode === 'external' ? normalizeOptionalString(profile.kavita.sharedLibraryPath) : '',
        KAVITA_LIBRARY_ROOT: profile.kavita.mode === 'managed' ? '/manga' : '',
    };

    if (profile.kavita.mode === 'managed') {
        values['noona-kavita'] = {
            ...(values['noona-kavita'] || {}),
            KAVITA_ADMIN_USERNAME: normalizeOptionalString(profile.kavita.account?.username),
            KAVITA_ADMIN_EMAIL: normalizeOptionalString(profile.kavita.account?.email),
            KAVITA_ADMIN_PASSWORD: normalizeOptionalString(profile.kavita.account?.password),
        };
    }

    if (profile.komf.mode === 'managed') {
        values['noona-komf'] = {
            ...(values['noona-komf'] || {}),
            KOMF_KAVITA_BASE_URI: kavitaBaseUrl,
            KOMF_KAVITA_API_KEY: kavitaApiKey,
            KOMF_APPLICATION_YML: normalizeOptionalString(profile.komf.applicationYml),
        };
    }

    return {
        selected: Array.from(new Set(selected)).sort((left, right) => left.localeCompare(right)),
        selectionMode: 'selected',
        values,
    };
};

export const normalizeSetupProfileSnapshot = (snapshot = {}, options = {}) => {
    if (!isPlainObject(snapshot)) {
        return null;
    }

    const profile = normalizePublicProfile(snapshot, options);
    const derived = deriveSetupProfileInternals(profile);

    return {
        version: Math.max(3, Number.isFinite(Number(profile.version)) ? Math.floor(Number(profile.version)) : 3),
        storageRoot: profile.storageRoot || null,
        kavita: clonePlainObject(profile.kavita),
        komf: clonePlainObject(profile.komf),
        discord: clonePlainObject(profile.discord),
        savedAt: profile.savedAt || null,
        selected: derived.selected,
        selectionMode: derived.selectionMode,
        values: derived.values,
    };
};

const cloneProfileValue = (snapshot = {}) => ({
    version: Number.isFinite(Number(snapshot?.version)) ? Math.max(3, Math.floor(Number(snapshot.version))) : 3,
    storageRoot: normalizeOptionalString(snapshot?.storageRoot) || null,
    kavita: {
        mode: normalizeMode(snapshot?.kavita?.mode),
        baseUrl: normalizeOptionalString(snapshot?.kavita?.baseUrl),
        apiKey: normalizeOptionalString(snapshot?.kavita?.apiKey),
        sharedLibraryPath: normalizeOptionalString(snapshot?.kavita?.sharedLibraryPath),
        account: {
            username: normalizeOptionalString(snapshot?.kavita?.account?.username),
            email: normalizeOptionalString(snapshot?.kavita?.account?.email),
            password: normalizeOptionalString(snapshot?.kavita?.account?.password),
        },
    },
    komf: {
        mode: normalizeMode(snapshot?.komf?.mode),
        baseUrl: normalizeOptionalString(snapshot?.komf?.baseUrl),
        applicationYml: normalizeOptionalString(snapshot?.komf?.applicationYml),
    },
    discord: {
        botToken: normalizeOptionalString(snapshot?.discord?.botToken),
        clientId: normalizeOptionalString(snapshot?.discord?.clientId),
        clientSecret: normalizeOptionalString(snapshot?.discord?.clientSecret),
        guildId: normalizeOptionalString(snapshot?.discord?.guildId),
        guildRoleId: normalizeOptionalString(snapshot?.discord?.guildRoleId),
        defaultRoleId: normalizeOptionalString(snapshot?.discord?.defaultRoleId),
        superuserId: normalizeOptionalString(snapshot?.discord?.superuserId),
        requiredRoleDing: normalizeOptionalString(snapshot?.discord?.requiredRoleDing),
        requiredRoleScan: normalizeOptionalString(snapshot?.discord?.requiredRoleScan),
        requiredRoleSearch: normalizeOptionalString(snapshot?.discord?.requiredRoleSearch),
        requiredRoleRecommend: normalizeOptionalString(snapshot?.discord?.requiredRoleRecommend),
        requiredRoleSubscribe: normalizeOptionalString(snapshot?.discord?.requiredRoleSubscribe),
        joinDefaultRoles: normalizeOptionalString(snapshot?.discord?.joinDefaultRoles),
        joinDefaultLibraries: normalizeOptionalString(snapshot?.discord?.joinDefaultLibraries),
    },
    savedAt: normalizeOptionalString(snapshot?.savedAt) || null,
});

export const toPublicSetupSnapshot = (snapshot = {}, {maskSecrets = false} = {}) => {
    const normalized = normalizeSetupProfileSnapshot(snapshot);
    if (!normalized) {
        return null;
    }

    const publicSnapshot = cloneProfileValue(normalized);
    if (!maskSecrets) {
        return publicSnapshot;
    }

    for (const pathSegments of PROFILE_SECRET_PATHS) {
        let current = publicSnapshot;
        for (let index = 0; index < pathSegments.length - 1; index += 1) {
            current = current?.[pathSegments[index]];
            if (!isPlainObject(current)) {
                break;
            }
        }

        if (!isPlainObject(current)) {
            continue;
        }

        const key = pathSegments[pathSegments.length - 1];
        if (normalizeOptionalString(current[key])) {
            current[key] = PLACEHOLDER_SECRET;
        }
    }

    return publicSnapshot;
};

export const SETUP_PROFILE_SECRET_PLACEHOLDER = PLACEHOLDER_SECRET;
