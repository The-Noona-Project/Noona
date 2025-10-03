// services/warden/docker/noonaDockers.mjs

import { buildVaultTokenRegistry, stringifyTokenMap } from './vaultTokens.mjs';

const DEBUG = process.env.DEBUG || 'false';
const HOST_SERVICE_URL = process.env.HOST_SERVICE_URL || 'http://localhost';
const DOCKER_WARDEN_URL =
    process.env.WARDEN_DOCKER_URL || process.env.INTERNAL_WARDEN_BASE_URL || 'http://noona-warden:4001';

const rawList = [
    'noona-sage',
    'noona-moon',
    'noona-oracle',
    'noona-raven',
    'noona-portal',
    'noona-vault'
];

const tokensByService = buildVaultTokenRegistry(rawList);

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

    if (token) {
        env.push(`VAULT_API_TOKEN=${token}`);
    }

    if (name === 'noona-sage') {
        env.push(`WARDEN_BASE_URL=${DOCKER_WARDEN_URL}`);
    }

    if (name === 'noona-vault') {
        const tokenMapString = stringifyTokenMap(tokensByService);
        env.push(`PORT=3005`, `VAULT_TOKEN_MAP=${tokenMapString}`);
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
