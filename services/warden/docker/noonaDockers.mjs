const DEBUG = process.env.DEBUG || 'false';

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
        port: 3000,
        internalPort: 3000,
        env: [`DEBUG=${DEBUG}`, 'SERVICE_NAME=noona-moon'],
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
    }
];

const noonaDockers = Object.fromEntries(
    rawList.map(service => {
        const internal = service.internalPort || service.port;
        const exposed = internal ? {[`${internal}/tcp`]: {}} : undefined;
        const ports = internal && service.port
            ? {[`${internal}/tcp`]: [{HostPort: String(service.port)}]}
            : undefined;

        return [
            service.name,
            {
                ...service,
                exposed,
                ports,
            }
        ];
    })
);

export default noonaDockers;
