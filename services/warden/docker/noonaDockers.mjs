// services/warden/docker/noonaDockers.mjs

import {resolveHostServiceBase, resolveSharedHostEnvEntries} from './hostServiceUrl.mjs';
import {resolveNoonaImage} from './imageRegistry.mjs';
import {buildVaultTokenRegistry, stringifyTokenMap} from './vaultTokens.mjs';

const DEBUG = process.env.DEBUG || 'false';
const HOST_SERVICE_URL = resolveHostServiceBase();
const SHARED_HOST_ENV = resolveSharedHostEnvEntries();
const DOCKER_WARDEN_URL =
    process.env.WARDEN_DOCKER_URL
    || process.env.INTERNAL_WARDEN_BASE_URL
    || 'http://noona-warden:4001';

const DEFAULT_MONGO_ROOT_USERNAME =
    process.env.MONGO_INITDB_ROOT_USERNAME
    || 'root';
const DEFAULT_MONGO_ROOT_PASSWORD =
    process.env.MONGO_INITDB_ROOT_PASSWORD
    || 'example';
const DEFAULT_VAULT_MONGO_URI =
    process.env.MONGO_URI ||
    `mongodb://${encodeURIComponent(DEFAULT_MONGO_ROOT_USERNAME)}:${encodeURIComponent(DEFAULT_MONGO_ROOT_PASSWORD)}@noona-mongo:27017/admin?authSource=admin`;
const DEFAULT_VAULT_REDIS_HOST =
    process.env.REDIS_HOST
    || 'noona-redis';
const DEFAULT_VAULT_REDIS_PORT =
    process.env.REDIS_PORT
    || '6379';
const DEFAULT_VAULT_DATA_FOLDER =
    process.env.VAULT_DATA_FOLDER
    || 'vault';
const DEFAULT_VAULT_REDIS_HOST_MOUNT_PATH =
    process.env.VAULT_REDIS_HOST_MOUNT_PATH || '';
const DEFAULT_VAULT_MONGO_HOST_MOUNT_PATH =
    process.env.VAULT_MONGO_HOST_MOUNT_PATH || '';
const DEFAULT_PORTAL_VAULT_BASE_URL =
    process.env.PORTAL_VAULT_BASE_URL
    || 'http://noona-vault:3005';
const DEFAULT_PORTAL_RAVEN_BASE_URL =
    process.env.RAVEN_BASE_URL
    || process.env.PORTAL_RAVEN_BASE_URL
    || 'http://noona-raven:8080';
const DEFAULT_PORTAL_WARDEN_BASE_URL =
    process.env.WARDEN_BASE_URL
    || process.env.PORTAL_WARDEN_BASE_URL
    || DOCKER_WARDEN_URL;
const DEFAULT_PORTAL_ACTIVITY_POLL_MS =
    process.env.PORTAL_ACTIVITY_POLL_MS
    || '15000';
const DEFAULT_RAVEN_VAULT_URL =
    process.env.RAVEN_VAULT_URL
    || 'http://noona-vault:3005';
const DEFAULT_RAVEN_PORTAL_BASE_URL =
    process.env.PORTAL_BASE_URL
    || process.env.RAVEN_PORTAL_BASE_URL
    || 'http://noona-portal:3003';
const DEFAULT_RAVEN_DOWNLOAD_THREADS =
    process.env.RAVEN_DOWNLOAD_THREADS
    || '3';
const DEFAULT_KAVITA_BASE_URL =
    process.env.KAVITA_BASE_URL
    || 'http://noona-kavita:5000';
const DEFAULT_RAVEN_KAVITA_LIBRARY_ROOT =
    process.env.RAVEN_KAVITA_LIBRARY_ROOT
    || '/manga';
const DEFAULT_MOON_WEBGUI_PORT = (() => {
    const candidate = Number.parseInt(process.env.WEBGUI_PORT || '3000', 10);
    if (Number.isFinite(candidate) && candidate >= 1 && candidate <= 65535) {
        return String(candidate);
    }

    return '3000';
})();
const DEFAULT_MOON_WEBGUI_PORT_NUMBER = Number.parseInt(DEFAULT_MOON_WEBGUI_PORT, 10);

const rawList = [
    'noona-sage',
    'noona-moon',
    'noona-oracle',
    'noona-raven',
    'noona-portal',
    'noona-vault'
];

const SERVICE_DESCRIPTIONS = Object.freeze({
    'noona-moon': 'Moon is the Noona web UI (front-end).',
    'noona-sage': 'Sage is the setup gateway and API proxy for Warden, Raven, and Vault.',
    'noona-portal': 'Portal is the external API gateway (Discord helpers, onboarding, integrations).',
    'noona-raven': 'Raven handles scraping, downloads, and library management.',
    'noona-vault': 'Vault stores secrets and shared settings for the stack.',
    'noona-oracle': 'Oracle provides optional automation and helper services.',
});

const tokensByService = buildVaultTokenRegistry(rawList);

const createEnvField = (key, defaultValue, {
    label = key,
    description = null,
    warning = null,
    required = true,
    readOnly = false,
} = {}) => ({
    key,
    label,
    defaultValue,
    description,
    warning,
    required,
    readOnly,
});

const serviceDefs = rawList.map(name => {
    const portMap = {
        'noona-sage': 3004,
        'noona-moon': DEFAULT_MOON_WEBGUI_PORT_NUMBER,
        'noona-oracle': 3001,
        'noona-raven': 3002,
        'noona-portal': 3003,
        'noona-vault': 3005
    };

    const internalPort = name === 'noona-raven' ? 8080 : portMap[name];
    const token = tokensByService[name];

    const env = [
        `DEBUG=${DEBUG}`,
        ...SHARED_HOST_ENV,
        `SERVICE_NAME=${name}`
    ];

    const envConfig = [
        createEnvField('DEBUG', DEBUG, {
            label: 'Debug Logging',
            description: 'Controls verbose logging output inside the container.',
            warning: 'Leave as "false" unless diagnosing issues to avoid noisy logs.',
        }),
        createEnvField('SERVICE_NAME', name, {
            label: 'Service Name',
            readOnly: true,
            description: 'Identifier used for the container and internal routing.',
        }),
    ];

    if (token) {
        env.push(`VAULT_API_TOKEN=${token}`);
        envConfig.push(
            createEnvField('VAULT_API_TOKEN', token, {
                label: 'Vault API Token',
                readOnly: true,
                description: 'Auto-generated token used for secure communication with Vault.',
            }),
        );
    }

    if (name === 'noona-sage') {
        env.push(`WARDEN_BASE_URL=${DOCKER_WARDEN_URL}`);
        envConfig.push(
            createEnvField('WARDEN_BASE_URL', DOCKER_WARDEN_URL, {
                label: 'Warden Base URL',
                warning: 'Adjust only if Warden is reachable at a custom URL within the Docker network.',
            }),
        );
    }

    if (name === 'noona-raven') {
        env.push(`VAULT_URL=${DEFAULT_RAVEN_VAULT_URL}`);
        env.push(`PORTAL_BASE_URL=${DEFAULT_RAVEN_PORTAL_BASE_URL}`);
        env.push(`RAVEN_DOWNLOAD_THREADS=${DEFAULT_RAVEN_DOWNLOAD_THREADS}`);
        env.push(`KAVITA_BASE_URL=${DEFAULT_KAVITA_BASE_URL}`);
        env.push('KAVITA_API_KEY=');
        env.push(`KAVITA_LIBRARY_ROOT=${DEFAULT_RAVEN_KAVITA_LIBRARY_ROOT}`);
        envConfig.push(
            createEnvField('APPDATA', '', {
                label: 'Raven Downloads Root',
                description:
                    'Container path Raven should treat as the base for downloads (e.g. /kavita-data).',
                warning:
                    'When Kavita auto-detection fails, provide the container directory you want to persist.',
                required: false,
            }),
            createEnvField('KAVITA_DATA_MOUNT', '', {
                label: 'Kavita Data Mount (Host Path)',
                description:
                    'Optional host path that Warden will bind into the container alongside the Raven downloads root.',
                warning:
                    'Supply this when Warden cannot discover your Kavita container automatically.',
                required: false,
            }),
            createEnvField('KAVITA_BASE_URL', DEFAULT_KAVITA_BASE_URL, {
                label: 'Kavita Base URL',
                description: 'Base URL Raven should use when syncing managed library types into Kavita.',
                required: false,
            }),
            createEnvField('KAVITA_API_KEY', '', {
                label: 'Kavita API Key',
                description: 'API key Raven can use to create Kavita libraries for new media types.',
                required: false,
            }),
            createEnvField('KAVITA_LIBRARY_ROOT', DEFAULT_RAVEN_KAVITA_LIBRARY_ROOT, {
                label: 'Kavita Library Root',
                description: 'Folder path as seen from Kavita for Raven downloads when auto-creating libraries.',
                required: false,
            }),
            createEnvField('PORTAL_BASE_URL', DEFAULT_RAVEN_PORTAL_BASE_URL, {
                label: 'Portal Base URL',
                description: 'Optional Portal endpoint Raven can use to request Kavita library creation.',
                required: false,
            }),
            createEnvField('VAULT_URL', DEFAULT_RAVEN_VAULT_URL, {
                label: 'Vault Service URL',
                warning:
                    'Change only if Vault is reachable for Raven at a non-default address inside the Docker network.',
            }),
            createEnvField('RAVEN_DOWNLOAD_THREADS', DEFAULT_RAVEN_DOWNLOAD_THREADS, {
                label: 'Raven Download Threads',
                description: 'Maximum concurrent download jobs Raven should run.',
                warning: 'Changing this value requires restarting noona-raven.',
                required: false,
            }),
        );
    }

    if (name === 'noona-moon') {
        env.push(`WEBGUI_PORT=${DEFAULT_MOON_WEBGUI_PORT}`);
        env.push('MOON_EXTERNAL_URL=');
        envConfig.push(
            createEnvField('WEBGUI_PORT', DEFAULT_MOON_WEBGUI_PORT, {
                label: 'Moon Web GUI Port',
                description: 'Port Moon listens on for the web interface and the port Warden publishes on the host.',
                warning: 'Changing this port requires restarting noona-moon and updating any bookmarks or reverse proxies.',
                required: false,
            }),
            createEnvField('MOON_EXTERNAL_URL', '', {
                label: 'Moon External URL',
                description:
                    'Optional public Moon URL used in external links (for example Discord recommendation DMs) instead of local host links.',
                warning:
                    'Set a full URL such as https://moon.example.com when users cannot reach the local host_service_url.',
                required: false,
            }),
        );
    }

    if (name === 'noona-portal') {
        const portalEnvFields = [
            {
                key: 'DISCORD_BOT_TOKEN',
                label: 'Discord Bot Token',
                description: 'Authentication token for the Discord bot used by the portal.',
            },
            {
                key: 'DISCORD_CLIENT_ID',
                label: 'Discord Client ID',
                description: 'OAuth2 client identifier for the Discord application.',
            },
            {
                key: 'DISCORD_CLIENT_SECRET',
                label: 'Discord Client Secret',
                description: 'OAuth2 client secret for Discord social login and callback testing.',
            },
            {
                key: 'DISCORD_GUILD_ID',
                label: 'Discord Guild ID',
                description: 'Identifier of the Discord server that the portal should connect to.',
            },
            {
                key: 'DISCORD_GUILD_ROLE_ID',
                label: 'Discord Guild Role ID',
                description: 'Role identifier assigned to new members after onboarding.',
                required: false,
            },
            {
                key: 'DISCORD_DEFAULT_ROLE_ID',
                label: 'Discord Default Role ID',
                description: 'Fallback role identifier to grant onboarded members when a guild role is not specified.',
                required: false,
            },
            {
                key: 'KAVITA_BASE_URL',
                label: 'Kavita Base URL',
                description: 'Base URL of the Kavita instance providing library content.',
                defaultValue: DEFAULT_KAVITA_BASE_URL,
            },
            {
                key: 'KAVITA_EXTERNAL_URL',
                label: 'Kavita External URL',
                description:
                    'Optional public Kavita URL used in Moon buttons and Discord messages instead of internal Docker-network URLs.',
                required: false,
            },
            {
                key: 'KAVITA_API_KEY',
                label: 'Kavita API Key',
                description: 'API key used by the portal when communicating with Kavita.',
            },
            {
                key: 'PORTAL_JOIN_DEFAULT_ROLES',
                label: 'Default /join Roles',
                description:
                    'Comma-separated Kavita roles applied when the Discord /join command creates a user. Supports "*" for all roles and exclusions like "*,-admin".',
                defaultValue: '*,-admin',
                required: false,
            },
            {
                key: 'PORTAL_JOIN_DEFAULT_LIBRARIES',
                label: 'Default /join Libraries',
                description:
                    'Comma-separated Kavita library names or ids granted when the Discord /join command creates a user. Use "*" to grant every available library.',
                defaultValue: '*',
                required: false,
            },
            {
                key: 'VAULT_BASE_URL',
                label: 'Vault Base URL',
                description: 'URL where the Vault service is exposed for the portal.',
                defaultValue: DEFAULT_PORTAL_VAULT_BASE_URL,
            },
            {
                key: 'RAVEN_BASE_URL',
                label: 'Raven Base URL',
                description: 'URL Portal should use when polling Raven download activity.',
                defaultValue: DEFAULT_PORTAL_RAVEN_BASE_URL,
                required: false,
            },
            {
                key: 'WARDEN_BASE_URL',
                label: 'Warden Base URL',
                description: 'URL Portal should use when polling Warden for install/update activity.',
                defaultValue: DEFAULT_PORTAL_WARDEN_BASE_URL,
                required: false,
            },
            {
                key: 'PORTAL_ACTIVITY_POLL_MS',
                label: 'Activity Poll Interval',
                description: 'Polling interval in milliseconds for Portal Discord bot activity updates.',
                defaultValue: DEFAULT_PORTAL_ACTIVITY_POLL_MS,
                required: false,
            },
            {
                key: 'PORTAL_REDIS_NAMESPACE',
                label: 'Portal Redis Namespace',
                description: 'Namespace prefix used for onboarding state stored in Redis.',
                defaultValue: 'portal:onboarding',
                required: false,
            },
            {
                key: 'PORTAL_TOKEN_TTL',
                label: 'Portal Token TTL',
                description: 'Time-to-live in seconds for onboarding tokens cached in Redis.',
                defaultValue: '900',
                required: false,
            },
            {
                key: 'PORTAL_HTTP_TIMEOUT',
                label: 'Portal HTTP Timeout',
                description: 'HTTP client timeout in milliseconds for outbound portal requests.',
                defaultValue: '10000',
                required: false,
            },
            {
                key: 'REQUIRED_GUILD_ID',
                label: 'Required Discord Guild ID',
                description: 'Restricts slash command usage to interactions originating from this guild ID.',
                required: false,
            },
            {
                key: 'REQUIRED_ROLE_DING',
                label: 'Required Role for /ding',
                description: 'Discord role ID required to execute the /ding command.',
                required: false,
            },
            {
                key: 'REQUIRED_ROLE_JOIN',
                label: 'Required Role for /join',
                description: 'Discord role ID required to execute the /join command.',
                required: false,
            },
            {
                key: 'REQUIRED_ROLE_SCAN',
                label: 'Required Role for /scan',
                description: 'Discord role ID required to execute the /scan command.',
                required: false,
            },
            {
                key: 'REQUIRED_ROLE_SEARCH',
                label: 'Required Role for /search',
                description: 'Discord role ID required to execute the /search command.',
                required: false,
            },
        ];

        portalEnvFields.forEach(field => {
            const defaultValue = field.defaultValue ?? '';
            env.push(`${field.key}=${defaultValue}`);
            envConfig.push(
                createEnvField(field.key, defaultValue, {
                    label: field.label,
                    description: field.description,
                    required: field.required !== false,
                }),
            );
        });
    }

    if (name === 'noona-vault') {
        const tokenMapString = stringifyTokenMap(tokensByService);
        env.push(
            `PORT=3005`,
            `VAULT_TOKEN_MAP=${tokenMapString}`,
            `VAULT_DATA_FOLDER=${DEFAULT_VAULT_DATA_FOLDER}`,
            `VAULT_REDIS_HOST_MOUNT_PATH=${DEFAULT_VAULT_REDIS_HOST_MOUNT_PATH}`,
            `VAULT_MONGO_HOST_MOUNT_PATH=${DEFAULT_VAULT_MONGO_HOST_MOUNT_PATH}`,
            `MONGO_URI=${DEFAULT_VAULT_MONGO_URI}`,
            `REDIS_HOST=${DEFAULT_VAULT_REDIS_HOST}`,
            `REDIS_PORT=${DEFAULT_VAULT_REDIS_PORT}`,
        );
        envConfig.push(
            createEnvField('PORT', '3005', {
                label: 'Vault Port',
                warning: 'Changing the port requires updating every service that talks to Vault.',
            }),
            createEnvField('VAULT_TOKEN_MAP', tokenMapString, {
                label: 'Vault Token Map',
                readOnly: true,
                description: 'Serialized lookup table allowing other services to authenticate with Vault.',
            }),
            createEnvField('VAULT_DATA_FOLDER', DEFAULT_VAULT_DATA_FOLDER, {
                label: 'Vault Data Folder',
                description:
                    'Folder name created next to the Raven mount root and used for Redis/Mongo persistence.',
                warning:
                    'Changing this folder name requires restarting the ecosystem so Redis and Mongo remount to the new path.',
            }),
            createEnvField('VAULT_REDIS_HOST_MOUNT_PATH', DEFAULT_VAULT_REDIS_HOST_MOUNT_PATH, {
                label: 'Redis Host Mount Folder',
                description:
                    'Optional host folder mounted into Redis at /data. Leave empty to use the default folder under Vault Data Folder.',
                warning:
                    'Changing this path requires restarting Redis (or restarting the ecosystem) to remount storage.',
                required: false,
            }),
            createEnvField('VAULT_MONGO_HOST_MOUNT_PATH', DEFAULT_VAULT_MONGO_HOST_MOUNT_PATH, {
                label: 'MongoDB Host Mount Folder',
                description:
                    'Optional host folder mounted into MongoDB at /data/db. Leave empty to use the default folder under Vault Data Folder.',
                warning:
                    'Changing this path requires restarting MongoDB (or restarting the ecosystem) to remount storage.',
                required: false,
            }),
            createEnvField('MONGO_URI', DEFAULT_VAULT_MONGO_URI, {
                label: 'MongoDB URI',
                description: 'MongoDB connection URI used by Vault for persistent storage.',
                warning: 'Defaults to Mongo auth on noona-mongo:27017/admin?authSource=admin inside the Docker network.',
            }),
            createEnvField('REDIS_HOST', DEFAULT_VAULT_REDIS_HOST, {
                label: 'Redis Host',
                description: 'Hostname of the Redis instance used for Vault caching.',
                warning: 'Defaults to noona-redis when running within the Noona stack.',
            }),
            createEnvField('REDIS_PORT', DEFAULT_VAULT_REDIS_PORT, {
                label: 'Redis Port',
                description: 'Port number used to connect to the configured Redis host.',
                warning: 'Match the port exposed by your Redis container (defaults to 6379).',
            }),
        );
    }

    const hostServiceUrl = portMap[name]
        ? `${HOST_SERVICE_URL}:${portMap[name]}`
        : null;

    const healthChecks = (() => {
        if (name === 'noona-sage') {
            return 'http://noona-sage:3004/health';
        }

        if (name === 'noona-vault') {
            return 'http://noona-vault:3005/v1/vault/health';
        }

        if (name === 'noona-raven') {
            return 'http://noona-raven:8080/v1/library/health';
        }

        if (name === 'noona-portal') {
            return 'http://noona-portal:3003/health';
        }

        if (name === 'noona-moon') {
            return `http://noona-moon:${internalPort}/`;
        }

        return `http://${name}:${portMap[name]}/`;
    })();

    const healthTries = name === 'noona-portal' ? 90 : undefined;
    const healthDelayMs = name === 'noona-portal' ? 1000 : undefined;

    return {
        name,
        image: resolveNoonaImage(name),
        description: SERVICE_DESCRIPTIONS[name] ?? null,
        port: portMap[name],
        internalPort,
        env,
        envConfig,
        hostServiceUrl,
        health: healthChecks,
        healthTries,
        healthDelayMs,
    };
});

const noonaDockers = Object.fromEntries(
    serviceDefs.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = internal ? { [`${internal}/tcp`]: {} } : {};
        const ports =
            internal && service.port
                ? { [`${internal}/tcp`]: [{ HostPort: String(service.port) }] }
                : {};
        return [service.name, { ...service, exposed, ports }];
    })
);

export default noonaDockers;
