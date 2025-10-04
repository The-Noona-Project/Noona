// services/warden/docker/noonaDockers.mjs

import { buildVaultTokenRegistry, stringifyTokenMap } from './vaultTokens.mjs';

const DEBUG = process.env.DEBUG || 'false';
const HOST_SERVICE_URL = process.env.HOST_SERVICE_URL || 'http://localhost';
const DOCKER_WARDEN_URL =
    process.env.WARDEN_DOCKER_URL || process.env.INTERNAL_WARDEN_BASE_URL || 'http://noona-warden:4001';

const DEFAULT_VAULT_MONGO_URI = process.env.MONGO_URI || 'mongodb://noona-mongo:27017';
const DEFAULT_VAULT_REDIS_HOST = process.env.REDIS_HOST || 'noona-redis';
const DEFAULT_VAULT_REDIS_PORT = process.env.REDIS_PORT || '6379';

const rawList = [
    'noona-sage',
    'noona-moon',
    'noona-oracle',
    'noona-raven',
    'noona-portal',
    'noona-vault'
];

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
        'noona-moon': 3000,
        'noona-oracle': 3001,
        'noona-raven': 3002,
        'noona-portal': 3003,
        'noona-vault': 3005
    };

    const internalPort = name === 'noona-raven' ? 8080 : portMap[name];
    const token = tokensByService[name];

    const env = [
        `DEBUG=${DEBUG}`,
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
                key: 'DISCORD_GUILD_ID',
                label: 'Discord Guild ID',
                description: 'Identifier of the Discord server that the portal should connect to.',
            },
            {
                key: 'KAVITA_BASE_URL',
                label: 'Kavita Base URL',
                description: 'Base URL of the Kavita instance providing library content.',
            },
            {
                key: 'KAVITA_API_KEY',
                label: 'Kavita API Key',
                description: 'API key used by the portal when communicating with Kavita.',
            },
            {
                key: 'VAULT_BASE_URL',
                label: 'Vault Base URL',
                description: 'URL where the Vault service is exposed for the portal.',
            },
            {
                key: 'VAULT_ACCESS_TOKEN',
                label: 'Vault Access Token',
                description: 'Authentication token that allows the portal to access Vault.',
            },
        ];

        portalEnvFields.forEach(field => {
            env.push(`${field.key}=`);
            envConfig.push(
                createEnvField(field.key, '', {
                    label: field.label,
                    description: field.description,
                    required: true,
                }),
            );
        });
    }

    if (name === 'noona-vault') {
        const tokenMapString = stringifyTokenMap(tokensByService);
        env.push(
            `PORT=3005`,
            `VAULT_TOKEN_MAP=${tokenMapString}`,
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
            createEnvField('MONGO_URI', DEFAULT_VAULT_MONGO_URI, {
                label: 'MongoDB URI',
                description: 'MongoDB connection URI used by Vault for persistent storage.',
                warning: 'Defaults to mongodb://noona-mongo:27017 inside the Docker network.',
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

        return `http://${name}:${portMap[name]}/`;
    })();

    return {
        name,
        image: `captainpax/${name}:latest`,
        port: portMap[name],
        internalPort,
        env,
        envConfig,
        hostServiceUrl,
        health: healthChecks
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
