// services/warden/docker/noonaDockers.mjs

/**
 * Describes available Noona-managed Docker services.
 * These are core components started and managed by Warden.
 * Each entry defines its image, port, environment, and networking config.
 */

const DEBUG = process.env.DEBUG || 'false';

/**
 * Raw list of service definitions in preferred launch order.
 * Sage must come before Moon since Moon depends on its backend.
 */
const rawList = [
    {
        name: 'noona-sage',
        image: 'captainpax/noona-sage:latest',
        port: 3004,
        internalPort: 3004,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-sage'],
    },
    {
        name: 'noona-moon',
        image: 'captainpax/noona-moon:latest',
        port: 3000,           // exposed on host
        internalPort: 80,     // nginx listens on 80 in the container
        env: [
            'TEST_BUTTON=Giga Chad Lvl +1',
            `DEBUG=${DEBUG}`,
            'SERVICE_NAME=noona-moon',
        ],
    },
    {
        name: 'noona-oracle',
        image: 'captainpax/noona-oracle:latest',
        port: 3001,
        internalPort: 3001,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-oracle'],
    },
    {
        name: 'noona-raven',
        image: 'captainpax/noona-raven:latest',
        port: 3002,
        internalPort: 3002,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-raven'],
    },
    {
        name: 'noona-portal',
        image: 'captainpax/noona-portal:latest',
        port: 3003,
        internalPort: 3003,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-portal'],
    },
    {
        name: 'noona-vault',
        image: 'captainpax/noona-vault:latest',
        port: 3005,
        internalPort: 3005,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-vault'],
    },
];

/**
 * Converts the raw list into a map keyed by container name,
 * and adds Docker-compatible port and network settings.
 */
const noonaDockers = Object.fromEntries(
    rawList.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = internal
            ? {[`${internal}/tcp`]: {}}
            : undefined;

        const ports = internal && service.port
            ? {[`${internal}/tcp`]: [{HostPort: String(service.port)}]}
            : undefined;

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
