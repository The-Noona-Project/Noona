/**
 * Describes addon containers that Noona can optionally run.
 * These are not required for core system but offer extra capabilities.
 */
const rawList = [
    {
        name: 'noona-redis',
        image: 'redis/redis-stack:latest',
        ports: {
            '6379/tcp': [{HostPort: '6379'}],
            '8001/tcp': [{HostPort: '8001'}]
        },
        exposed: {
            '6379/tcp': {},
            '8001/tcp': {}
        },
        env: [],
        volumes: [
            '/noona-redis-data:/data'
        ]
    }
];

const addonDockers = Object.fromEntries(
    rawList.map(service => [service.name, service])
);

export default addonDockers;

