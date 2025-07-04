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
        volumes: ['/noona-redis-data:/data'],
        health: 'http://noona-redis:8001/',
    },
    {
        name: 'noona-mongo',
        image: 'mongo:7',
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
            'SERVICE_NAME=noona-mongo'
        ],
        volumes: ['/noona-mongo-data:/data/db'],
        health: null, // Mongo doesn't expose an HTTP health endpoint by default
    }
];

const addonDockers = Object.fromEntries(
    rawList.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = internal ? { [`${internal}/tcp`]: {} } : {};
        const ports = internal && service.port
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

export default addonDockers;
