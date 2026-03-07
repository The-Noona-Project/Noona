// services/warden/docker/addonDockers.mjs

import {resolveHostServiceBase, resolveHostServiceHost, resolveSharedHostEnvEntries,} from './hostServiceUrl.mjs';
import {resolveNoonaImage} from './imageRegistry.mjs';
import {DEFAULT_MANAGED_KOMF_APPLICATION_YML} from './komfConfigTemplate.mjs';

const HOST_SERVICE_URL = resolveHostServiceBase();
const HOST_SERVICE_HOST = resolveHostServiceHost();
const SHARED_HOST_ENV = resolveSharedHostEnvEntries();
const DEFAULT_TIMEZONE = process.env.TZ || 'UTC';
const DEFAULT_KAVITA_ADMIN_USERNAME = process.env.KAVITA_ADMIN_USERNAME || '';
const DEFAULT_KAVITA_ADMIN_EMAIL = process.env.KAVITA_ADMIN_EMAIL || '';
const DEFAULT_KAVITA_ADMIN_PASSWORD = process.env.KAVITA_ADMIN_PASSWORD || '';
const DEFAULT_MOON_WEBGUI_PORT = (() => {
    const candidate = Number.parseInt(process.env.WEBGUI_PORT || '3000', 10);
    if (Number.isFinite(candidate) && candidate >= 1 && candidate <= 65535) {
        return String(candidate);
    }

    return '3000';
})();
const DEFAULT_NOONA_MOON_BASE_URL = process.env.NOONA_MOON_BASE_URL || `${HOST_SERVICE_URL}:${DEFAULT_MOON_WEBGUI_PORT}`;
const DEFAULT_NOONA_PORTAL_BASE_URL = process.env.NOONA_PORTAL_BASE_URL || 'http://noona-portal:3003';
const DEFAULT_NOONA_SOCIAL_LOGIN_ONLY = process.env.NOONA_SOCIAL_LOGIN_ONLY || 'true';

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
        env: [...SHARED_HOST_ENV, 'SERVICE_NAME=noona-redis'],
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
            ...SHARED_HOST_ENV,
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
        hostServiceUrl: `mongodb://${HOST_SERVICE_HOST}:27017`,
    },
    {
        name: 'noona-kavita',
        description: 'Managed Kavita library server wired to the Noona downloads folder.',
        image: resolveNoonaImage('noona-kavita'),
        port: 5000,
        internalPort: 5000,
        env: [
            ...SHARED_HOST_ENV,
            'SERVICE_NAME=noona-kavita',
            `TZ=${DEFAULT_TIMEZONE}`,
            'KAVITA_CONFIG_HOST_MOUNT_PATH=',
            'KAVITA_LIBRARY_HOST_MOUNT_PATH=',
            `KAVITA_ADMIN_USERNAME=${DEFAULT_KAVITA_ADMIN_USERNAME}`,
            `KAVITA_ADMIN_EMAIL=${DEFAULT_KAVITA_ADMIN_EMAIL}`,
            `KAVITA_ADMIN_PASSWORD=${DEFAULT_KAVITA_ADMIN_PASSWORD}`,
            `NOONA_MOON_BASE_URL=${DEFAULT_NOONA_MOON_BASE_URL}`,
            `NOONA_PORTAL_BASE_URL=${DEFAULT_NOONA_PORTAL_BASE_URL}`,
            `NOONA_SOCIAL_LOGIN_ONLY=${DEFAULT_NOONA_SOCIAL_LOGIN_ONLY}`,
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
            createEnvField('KAVITA_ADMIN_USERNAME', DEFAULT_KAVITA_ADMIN_USERNAME, {
                label: 'Initial Kavita Admin Username',
                description: 'Optional username the managed noona-kavita image should use when bootstrapping the first admin account.',
                warning: 'Provide this with the matching email and password if you want Noona to create the first Kavita admin automatically.',
                required: false,
            }),
            createEnvField('KAVITA_ADMIN_EMAIL', DEFAULT_KAVITA_ADMIN_EMAIL, {
                label: 'Initial Kavita Admin Email',
                description: 'Optional email address used when the managed noona-kavita image registers the first admin account.',
                warning: 'Provide this with the matching username and password if you want Noona to create the first Kavita admin automatically.',
                required: false,
            }),
            createEnvField('KAVITA_ADMIN_PASSWORD', DEFAULT_KAVITA_ADMIN_PASSWORD, {
                label: 'Initial Kavita Admin Password',
                description: 'Optional password used when the managed noona-kavita image registers the first admin account.',
                warning: 'Store and rotate this carefully if you keep it in managed service settings.',
                required: false,
            }),
            createEnvField('NOONA_MOON_BASE_URL', DEFAULT_NOONA_MOON_BASE_URL, {
                label: 'Noona Moon Base URL',
                description: 'Public Moon login URL Kavita should use for the "Log in with Noona" button.',
                warning: 'Override this with your reverse-proxy URL when users cannot reach the default host-service Moon address.',
                required: false,
            }),
            createEnvField('NOONA_PORTAL_BASE_URL', DEFAULT_NOONA_PORTAL_BASE_URL, {
                label: 'Noona Portal Base URL',
                description: 'Internal Portal URL Kavita uses to redeem one-time Noona login tokens.',
                warning: 'Change this only if Portal is reachable from Kavita at a different internal address.',
                required: false,
            }),
            createEnvField('NOONA_SOCIAL_LOGIN_ONLY', DEFAULT_NOONA_SOCIAL_LOGIN_ONLY, {
                label: 'Noona Social Login Only',
                description: 'When true, managed Kavita hides the username/password form and rejects local password logins in favor of the Noona login handoff.',
                warning: 'Leave this enabled unless you intentionally need to restore direct Kavita password logins.',
                required: false,
            }),
        ],
        volumes: [],
        hostServiceUrl: `${HOST_SERVICE_URL}:5000`,
        health: 'http://noona-kavita:5000/api/Health',
        healthTries: 60,
        healthDelayMs: 1000,
        restartPolicy: {Name: 'unless-stopped'},
    },
    {
        name: 'noona-komf',
        description: 'Managed Komf metadata helper wired to Kavita by default.',
        image: 'sndxr/komf:latest',
        port: 8085,
        internalPort: 8085,
        env: [
            ...SHARED_HOST_ENV,
            'SERVICE_NAME=noona-komf',
            'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
            'KOMF_KAVITA_API_KEY=',
            'KOMF_LOG_LEVEL=INFO',
            'KOMF_CONFIG_HOST_MOUNT_PATH=',
        ],
        envConfig: [
            createEnvField('SERVICE_NAME', 'noona-komf', {
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
            createEnvField('KOMF_APPLICATION_YML', DEFAULT_MANAGED_KOMF_APPLICATION_YML, {
                label: 'Komf application.yml',
                description: 'Moon writes this YAML into /config/application.yml before managed Komf starts.',
                warning: 'Set valid metadataProviders and kavita.metadataUpdate blocks here, or Kavita metadata matching can fail.',
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
