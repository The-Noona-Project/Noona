// services/warden/docker/noonaDockers.mjs

/**
 * Describes available Noona Docker services.
 * Each service contains name, image, port, and environment variables.
 * Warden uses this to start and manage them.
 */
const DEBUG = process.env.DEBUG
const rawList = [
    {
        name: 'noona-moon',
        image: 'captainpax/noona-moon:latest',
        port: 3000,
        env: ['TEST_BUTTON=Giga Chad Lvl +1', `DEBUG=${DEBUG}`]
    },
    {
        name: 'noona-oracle',
        image: 'captainpax/noona-oracle:latest',
        port: 3001,
        env: []
    },
    {
        name: 'noona-raven',
        image: 'captainpax/noona-raven:latest',
        port: 3002,
        env: []
    },
    {
        name: 'noona-portal',
        image: 'captainpax/noona-portal:latest',
        port: 3003,
        env: []
    },
    {
        name: 'noona-sage',
        image: 'captainpax/noona-sage:latest',
        port: 3004,
        env: []
    },
    {
        name: 'noona-vault',
        image: 'captainpax/noona-vault:latest',
        port: 3005,
        env: []
    }
];

/**
 * Transforms the list into a map keyed by service name.
 */
const noonaDockers = Object.fromEntries(
    rawList.map(service => {
        const exposed = service.port
            ? {[`${service.port}/tcp`]: {}}
            : undefined;

        const ports = service.port
            ? {[`${service.port}/tcp`]: [{HostPort: String(service.port)}]}
            : undefined;

        return [service.name, {
            ...service,
            exposed,
            ports
        }];
    })
);

export default noonaDockers;
