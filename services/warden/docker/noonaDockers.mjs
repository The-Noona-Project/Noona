// services/warden/docker/noonaDockers.mjs

const DEBUG = process.env.DEBUG || 'false';

const DEFAULT_TOKENS = {
    'noona-sage': 'noona-sage-dev-token',
    'noona-moon': 'noona-moon-dev-token',
    'noona-oracle': 'noona-oracle-dev-token',
    'noona-raven': 'noona-raven-dev-token',
    'noona-portal': 'noona-portal-dev-token',
    'noona-vault': 'noona-vault-dev-token'
};

/**
 * Resolve the Vault token for a given service name.
 * @param {string} name - Service name (e.g., "noona-sage").
 * @returns {string} The resolved token: the environment variable value for `<NAME>_VAULT_TOKEN` if set, otherwise the entry from `DEFAULT_TOKENS` for the service, otherwise the fallback `"<name>-dev-token"`.
 */
function resolveToken(name) {
    const envKey = `${name.replace(/-/g, '_').toUpperCase()}_VAULT_TOKEN`;
    return process.env[envKey] || DEFAULT_TOKENS[name] || `${name}-dev-token`;
}

const rawList = [
    'noona-sage',
    'noona-moon',
    'noona-oracle',
    'noona-raven',
    'noona-portal',
    'noona-vault'
];

const tokensByService = Object.fromEntries(
    rawList.map(name => [name, resolveToken(name)])
);

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

    if (name === 'noona-vault') {
        const tokenMapString = Object.entries(tokensByService)
            .map(([svc, svcToken]) => `${svc}:${svcToken}`)
            .join(',');
        env.push(`PORT=3005`, `VAULT_TOKEN_MAP=${tokenMapString}`);
    }

    return {
        name,
        image: `captainpax/${name}:latest`,
        port: portMap[name],
        internalPort,
        env,
        health:
            name === 'noona-sage'
                ? 'http://noona-sage:3004/health'
                : name === 'noona-vault'
                    ? 'http://noona-vault:3005/v1/vault/health'
                    : `http://${name}:${portMap[name]}/`
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
