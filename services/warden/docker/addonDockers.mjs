// services/warden/docker/addonDockers.mjs

const HOST_SERVICE_URL = process.env.HOST_SERVICE_URL || 'http://localhost';

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

const rawList = [
    {
        name: 'noona-redis',
        image: 'redis/redis-stack:latest',
        port: 8001,
        internalPort: 8001,
        ports: {
            '6379/tcp': [{ HostPort: '6379' }],
            '8001/tcp': [{ HostPort: '8001' }],
        },
        exposed: {
            '6379/tcp': {},
            '8001/tcp': {},
        },
        env: ['SERVICE_NAME=noona-redis'],
        envConfig: [
            createEnvField('SERVICE_NAME', 'noona-redis', {
                label: 'Service Name',
                readOnly: true,
                description: 'Identifier used when naming the Redis container.',
            }),
        ],
        volumes: ['/noona-redis-data:/data'],
        health: 'http://noona-redis:8001/',
        hostServiceUrl: `${HOST_SERVICE_URL}:8001`,
    },
    {
        name: 'noona-mongo',
        image: 'mongo:8',
        port: 27017,
        internalPort: 27017,
        ports: {
            '27017/tcp': [{ HostPort: '27017' }],
        },
        exposed: {
            '27017/tcp': {},
        },
        env: [
            'MONGO_INITDB_ROOT_USERNAME=root',
            'MONGO_INITDB_ROOT_PASSWORD=example',
            'SERVICE_NAME=noona-mongo',
        ],
        envConfig: [
            createEnvField('MONGO_INITDB_ROOT_USERNAME', 'root', {
                label: 'Mongo Root Username',
                warning: 'Changing the username requires updating every consumer that connects to Mongo.',
            }),
            createEnvField('MONGO_INITDB_ROOT_PASSWORD', 'example', {
                label: 'Mongo Root Password',
                warning: 'Use a strong password and store it securely. Changing it requires updating dependent services.',
            }),
            createEnvField('SERVICE_NAME', 'noona-mongo', {
                label: 'Service Name',
                readOnly: true,
                description: 'Identifier used when naming the Mongo container.',
            }),
        ],
        volumes: ['/noona-mongo-data:/data/db'],
        health: null, // Mongo doesn't expose an HTTP endpoint
        hostServiceUrl: `mongodb://localhost:27017`,
    },
];

const addonDockers = Object.fromEntries(
    rawList.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = service.exposed || (internal ? { [`${internal}/tcp`]: {} } : {});
        const ports = service.ports || (internal && service.port
            ? { [`${internal}/tcp`]: [{ HostPort: String(service.port) }] }
            : {});

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

export default addonDockers;
