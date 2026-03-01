// services/warden/docker/addonDockers.mjs

const HOST_SERVICE_URL = process.env.HOST_SERVICE_URL || 'http://localhost';
const DEFAULT_TIMEZONE = process.env.TZ || 'UTC';

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
        description: 'Redis Stack used for caching, wizard state, and ephemeral service coordination.',
        image: 'redis/redis-stack:7.2.0-v19',
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
        description: 'MongoDB backing store used by Vault for persistent data.',
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
    {
        name: 'noona-kavita',
        description: 'Managed Kavita library server wired to the Noona downloads folder.',
        image: 'jvmilazz0/kavita:latest',
        port: 5000,
        internalPort: 5000,
        env: [
            'SERVICE_NAME=noona-kavita',
            `TZ=${DEFAULT_TIMEZONE}`,
            'KAVITA_CONFIG_HOST_MOUNT_PATH=',
            'KAVITA_LIBRARY_HOST_MOUNT_PATH=',
        ],
        envConfig: [
            createEnvField('SERVICE_NAME', 'noona-kavita', {
                label: 'Service Name',
                readOnly: true,
                description: 'Identifier used when naming the Kavita container.',
            }),
            createEnvField('TZ', DEFAULT_TIMEZONE, {
                label: 'Timezone',
                description: 'Timezone used by the managed Kavita container.',
                required: false,
            }),
            createEnvField('KAVITA_CONFIG_HOST_MOUNT_PATH', '', {
                label: 'Kavita Config Folder',
                description: 'Optional host folder mounted into Kavita at /kavita/config.',
                warning: 'Leave empty to use the default Noona storage root under kavita/config.',
                required: false,
            }),
            createEnvField('KAVITA_LIBRARY_HOST_MOUNT_PATH', '', {
                label: 'Kavita Library Folder',
                description: 'Optional host folder mounted into Kavita at /manga for the shared library.',
                warning: 'Leave empty to share the default Noona Raven downloads folder.',
                required: false,
            }),
        ],
        volumes: [],
        hostServiceUrl: `${HOST_SERVICE_URL}:5000`,
        health: 'http://noona-kavita:5000/',
        restartPolicy: {Name: 'unless-stopped'},
    },
    {
        name: 'komf',
        description: 'Managed Komf metadata helper wired to Kavita by default.',
        image: 'sndxr/komf:latest',
        port: 8085,
        internalPort: 8085,
        env: [
            'SERVICE_NAME=komf',
            'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
            'KOMF_KAVITA_API_KEY=',
            'KOMF_LOG_LEVEL=INFO',
            'KOMF_CONFIG_HOST_MOUNT_PATH=',
        ],
        envConfig: [
            createEnvField('SERVICE_NAME', 'komf', {
                label: 'Service Name',
                readOnly: true,
                description: 'Identifier used when naming the Komf container.',
            }),
            createEnvField('KOMF_KAVITA_BASE_URI', 'http://noona-kavita:5000', {
                label: 'Kavita Base URI',
                description: 'Kavita base URL used by Komf.',
            }),
            createEnvField('KOMF_KAVITA_API_KEY', '', {
                label: 'Kavita API Key',
                description: 'API key Komf uses to talk to Kavita.',
            }),
            createEnvField('KOMF_LOG_LEVEL', 'INFO', {
                label: 'Komf Log Level',
                description: 'Logging level used by the Komf container.',
                required: false,
            }),
            createEnvField('KOMF_CONFIG_HOST_MOUNT_PATH', '', {
                label: 'Komf Config Folder',
                description: 'Optional host folder mounted into Komf at /config.',
                warning: 'Leave empty to use the default Noona storage root under komf/config.',
                required: false,
            }),
        ],
        volumes: [],
        hostServiceUrl: `${HOST_SERVICE_URL}:8085`,
        health: null,
        user: '1000:1000',
        restartPolicy: {Name: 'unless-stopped'},
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
