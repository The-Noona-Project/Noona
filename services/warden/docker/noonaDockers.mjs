// services/warden/docker/noonaDockers.mjs

const DEBUG = process.env.DEBUG || 'false';

const rawList = [
    {
        name: 'noona-sage',
        image: 'captainpax/noona-sage:latest',
        port: 3004,
        internalPort: 3004,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-sage'],
        health: 'http://noona-sage:3004/health',
    },
    {
        name: 'noona-moon',
        image: 'captainpax/noona-moon:latest',
        port: 3000,
        internalPort: 3000,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-moon'],
        health: 'http://noona-moon:3000/',
    },
    {
        name: 'noona-oracle',
        image: 'captainpax/noona-oracle:latest',
        port: 3001,
        internalPort: 3001,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-oracle'],
        health: 'http://noona-oracle:3001/',
    },
    {
        name: 'noona-raven',
        image: 'captainpax/noona-raven:latest',
        port: 3002,
        internalPort: 8080,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-raven'],
        health: 'http://noona-raven:3002/',
    },
    {
        name: 'noona-portal',
        image: 'captainpax/noona-portal:latest',
        port: 3003,
        internalPort: 3003,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-portal'],
        health: 'http://noona-portal:3003/',
    },
    {
        name: 'noona-vault',
        image: 'captainpax/noona-vault:latest',
        port: 3005,
        internalPort: 3005,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-vault', 'PORT=3005'],
        health: 'http://noona-vault:3005/v1/vault/health',
    },
];

const noonaDockers = Object.fromEntries(
    rawList.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = internal ? { [`${internal}/tcp`]: {} } : {};
        const ports =
            internal && service.port
                ? { [`${internal}/tcp`]: [{ HostPort: String(service.port) }] }
                : {};

        return [
            service.name,
            {
                ...service,
                exposed,
                ports,
            },
        ];
    })
);

export default noonaDockers;
