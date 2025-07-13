// services/warden/docker/noonaDockers.mjs
import crypto from 'crypto';

const DEBUG = process.env.DEBUG || 'false';

function genPassword() {
    return crypto.randomBytes(24).toString('base64url'); // Strong and Docker-friendly
}

const rawList = [
    'noona-sage',
    'noona-moon',
    'noona-oracle',
    'noona-raven',
    'noona-portal',
    'noona-vault'
];

const passwordMap = {};
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
    const password = genPassword();
    passwordMap[name] = password;

    const env = [
        `DEBUG=${DEBUG}`,
        `SERVICE_NAME=${name}`,
        `WARDENPASS=${password}`
    ];

    // Vault gets the full password map
    if (name === 'noona-vault') {
        const passMapString = Object.entries(passwordMap)
            .map(([svc, pass]) => `${svc}:${pass}`)
            .join(',');
        env.push(`PORT=3005`, `WARDENPASSMAP=${passMapString}`);
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
