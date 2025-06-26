const rawList = [
    {
        name: 'noona-redis',
        image: 'redis/redis-stack:latest',
        ports: {
            '6379/tcp': [{HostPort: '6379'}],
            '8001/tcp': [{HostPort: '8001'}],
        },
        exposed: {
            '6379/tcp': {},
            '8001/tcp': {}
        },
        env: ['SERVICE_NAME=noona-redis'],
        volumes: ['/noona-redis-data:/data'],
    },
    {
        name: 'noona-mongo',
        image: 'mongo:7',
        ports: {
            '27017/tcp': [{HostPort: '27017'}],
        },
        exposed: {
            '27017/tcp': {},
        },
        env: ['MONGO_INITDB_ROOT_USERNAME=root', 'MONGO_INITDB_ROOT_PASSWORD=example', 'SERVICE_NAME=noona-mongo'],
        volumes: ['/noona-mongo-data:/data/db'],
    }
];

const addonDockers = Object.fromEntries(
    rawList.map(service => [service.name, service])
);

export default addonDockers;
