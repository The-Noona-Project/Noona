#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

function normalizeNamespace(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function hasExplicitRegistryHost(value) {
    return typeof value === 'string' && (value.includes('.') || value.includes(':') || value === 'localhost');
}

const DEFAULT_REGISTRY = process.env.NOONA_DOCKER_REGISTRY || 'docker.darkmatterservers.com';
const DEFAULT_PROJECT = process.env.NOONA_DOCKER_PROJECT || 'the-noona-project';
const DEFAULT_NAMESPACE = normalizeNamespace(
    process.env.NOONA_DOCKER_NAMESPACE || `${DEFAULT_REGISTRY}/${DEFAULT_PROJECT}`,
);
const DEFAULT_TAG = process.env.NOONA_DOCKER_TAG || 'latest';
const DEFAULT_AUTO_LOGIN = process.env.NOONA_DOCKER_AUTO_LOGIN == null
    ? true
    : isTruthyFlag(process.env.NOONA_DOCKER_AUTO_LOGIN);
const DEFAULT_LOGIN_USERNAME = process.env.NOONA_DOCKER_USERNAME || 'robot$noona-builder';
const DEFAULT_LOGIN_PASSWORD = process.env.NOONA_DOCKER_PASSWORD || 'yUKTTk8NulwFmPyt4NC38MJjcjHMONOg';

const ROOT = resolve('.');

const SERVICES = [
    {name: 'noona-warden', dockerfile: 'dockerfiles/warden.Dockerfile'},
    {name: 'noona-moon', dockerfile: 'dockerfiles/moon.Dockerfile'},
    {name: 'noona-sage', dockerfile: 'dockerfiles/sage.Dockerfile'},
    {name: 'noona-vault', dockerfile: 'dockerfiles/vault.Dockerfile'},
    {name: 'noona-raven', dockerfile: 'dockerfiles/raven.Dockerfile'},
    {name: 'noona-kavita', dockerfile: 'dockerfiles/kavita.Dockerfile'},
    {name: 'noona-komf', dockerfile: 'dockerfiles/komf.Dockerfile'},
    {name: 'noona-portal', dockerfile: 'dockerfiles/portal.Dockerfile'},
    {name: 'noona-oracle', dockerfile: 'dockerfiles/oracle.Dockerfile', optional: true},
];

const ALIASES = Object.freeze({
    warden: 'noona-warden',
    moon: 'noona-moon',
    sage: 'noona-sage',
    vault: 'noona-vault',
    raven: 'noona-raven',
    kavita: 'noona-kavita',
    komf: 'noona-komf',
    portal: 'noona-portal',
    oracle: 'noona-oracle',
});

const usage = () => {
    console.log(
        [
            'Noona Docker helper',
            '',
            'Usage:',
            '  node docker-images.mjs list',
            '  node docker-images.mjs build [--services moon,sage,kavita,komf] [--tag latest] [--namespace docker.darkmatterservers.com/the-noona-project] [--no-cache]',
            '  node docker-images.mjs push  [--services moon,sage,kavita,komf] [--tag latest] [--namespace docker.darkmatterservers.com/the-noona-project] [--skip-login]',
            '  node docker-images.mjs publish [--services moon,sage,kavita,komf] [--tag latest] [--namespace docker.darkmatterservers.com/the-noona-project] [--no-cache] [--skip-login]',
            '',
            'Env:',
            `  NOONA_DOCKER_NAMESPACE   Full namespace override (default: ${DEFAULT_NAMESPACE})`,
            `  NOONA_DOCKER_REGISTRY    Registry host when namespace override is unset (default: ${DEFAULT_REGISTRY})`,
            `  NOONA_DOCKER_PROJECT     Registry project when namespace override is unset (default: ${DEFAULT_PROJECT})`,
            `  NOONA_DOCKER_AUTO_LOGIN  Run docker login before push/publish when credentials are present (default: ${DEFAULT_AUTO_LOGIN})`,
            `  NOONA_DOCKER_USERNAME    Registry username override for automatic docker login (default: ${DEFAULT_LOGIN_USERNAME})`,
            '  NOONA_DOCKER_PASSWORD    Registry password/token override for automatic docker login',
            '  NOONA_DOCKER_TAG         Default tag (default: latest)',
        ].join('\n'),
    );
};

const parseArgs = (argv) => {
    const args = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token) continue;

        if (token === '--help' || token === '-h') {
            args.help = true;
            continue;
        }

        if (token.startsWith('--')) {
            const [rawKey, rawValue] = token.split('=');
            const key = rawKey.slice(2);
            const value = rawValue ?? argv[index + 1];
            if (rawValue == null) {
                index += 1;
            }
            args[key] = value ?? true;
            continue;
        }

        args._.push(token);
    }

    return args;
};

const normalizeServiceToken = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (ALIASES[trimmed]) return ALIASES[trimmed];
    if (trimmed.startsWith('noona-')) return trimmed;
    return `noona-${trimmed}`;
};

const splitServiceList = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string') return null;

    return value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
};

const selectServices = ({servicesArg}) => {
    const requested = splitServiceList(servicesArg);
    if (!requested || requested.length === 0) {
        return SERVICES;
    }

    const normalized = requested.map(normalizeServiceToken).filter(Boolean);
    const wanted = new Set(normalized);
    return SERVICES.filter((entry) => wanted.has(entry.name));
};

const resolveRegistryHost = (namespace) => {
    const normalized = normalizeNamespace(namespace);
    if (!normalized) return '';

    const [candidate] = normalized.split('/');
    return hasExplicitRegistryHost(candidate) ? candidate : '';
};

const resolveImageTag = (serviceName, {namespace, tag}) => `${namespace}/${serviceName}:${tag}`;

const runDocker = (args, options = {}) =>
    new Promise((resolvePromise, rejectPromise) => {
        const stdinText = typeof options.stdinText === 'string' ? options.stdinText : null;
        const child = spawn('docker', args, {
            stdio: stdinText == null ? 'inherit' : ['pipe', 'inherit', 'inherit'],
            cwd: ROOT,
            shell: false,
        });
        child.on('error', rejectPromise);
        if (stdinText != null && child.stdin) {
            child.stdin.on('error', () => {
            });
            child.stdin.end(stdinText);
        }
        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`docker ${args.join(' ')} failed (exit ${code})`));
        });
    });

const ensureRegistryLogin = async ({namespace, autoLogin = DEFAULT_AUTO_LOGIN} = {}) => {
    const registry = resolveRegistryHost(namespace);
    if (!registry || !autoLogin) {
        return;
    }

    const username = typeof DEFAULT_LOGIN_USERNAME === 'string' ? DEFAULT_LOGIN_USERNAME.trim() : '';
    const password = typeof DEFAULT_LOGIN_PASSWORD === 'string' ? DEFAULT_LOGIN_PASSWORD : '';
    if (!username || !password) {
        throw new Error(
            'Docker login is enabled, but the registry username/password are incomplete.',
        );
    }

    console.log(`[auth] docker login ${registry} as ${username}`);
    await runDocker(
        ['login', registry, '--username', username, '--password-stdin'],
        {stdinText: `${password}\n`},
    );
};

const canBuildService = (service) => {
    const dockerfilePath = resolve(ROOT, service.dockerfile);
    if (!existsSync(dockerfilePath)) {
        return {ok: false, reason: `Missing Dockerfile: ${service.dockerfile}`};
    }

    if (service.name === 'noona-kavita' && !existsSync(resolve(ROOT, 'services/kavita'))) {
        return {ok: false, reason: 'Missing services/kavita; skipping noona-kavita.'};
    }

    if (service.name === 'noona-komf' && !existsSync(resolve(ROOT, 'services/komf'))) {
        return {ok: false, reason: 'Missing services/komf; skipping noona-komf.'};
    }

    // Oracle is currently optional in this checkout (services/oracle may not exist).
    if (service.name === 'noona-oracle' && !existsSync(resolve(ROOT, 'services/oracle'))) {
        return {ok: false, reason: 'Missing services/oracle; skipping noona-oracle.'};
    }

    return {ok: true};
};

const buildService = async (service, {namespace, tag, noCache, push = false}) => {
    const preflight = canBuildService(service);
    if (!preflight.ok) {
        console.warn(`[skip] ${service.name}: ${preflight.reason}`);
        return {ok: true, skipped: true};
    }

    const image = resolveImageTag(service.name, {namespace, tag});
    const dockerArgs = ['buildx', 'build', '-f', service.dockerfile, '-t', image];
    if (noCache) dockerArgs.push('--no-cache');
    dockerArgs.push(push ? '--push' : '--load');
    dockerArgs.push('.');

    console.log(`[${push ? 'publish' : 'build'}] ${service.name} -> ${image}`);
    await runDocker(dockerArgs);
    return {ok: true, image};
};

const pushService = async (service, {namespace, tag}) => {
    const preflight = canBuildService(service);
    if (!preflight.ok) {
        console.warn(`[skip] ${service.name}: ${preflight.reason}`);
        return {ok: true, skipped: true};
    }

    const image = resolveImageTag(service.name, {namespace, tag});
    console.log(`[push] ${service.name} -> ${image}`);
    await runDocker(['push', image]);
    return {ok: true, image};
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const [commandRaw] = args._;
    const command = typeof commandRaw === 'string' ? commandRaw.trim().toLowerCase() : '';

    if (args.help || !command || command === 'help' || command === '--help') {
        usage();
        process.exitCode = command ? 0 : 1;
        return;
    }

    const namespace = normalizeNamespace(String(args.namespace || DEFAULT_NAMESPACE));
    const tag = String(args.tag || DEFAULT_TAG).trim();
    const noCache = args['no-cache'] === true || String(args['no-cache'] || '').toLowerCase() === 'true';

    if (!namespace) {
        console.error('Docker namespace cannot be empty.');
        process.exitCode = 2;
        return;
    }

    const selected = selectServices({servicesArg: args.services});
    if (command === 'list') {
        for (const svc of SERVICES) {
            const image = resolveImageTag(svc.name, {namespace, tag});
            console.log(`${svc.name}\t${image}\t${svc.dockerfile}`);
        }
        return;
    }

    if (selected.length === 0) {
        console.error('No services matched the selection.');
        process.exitCode = 2;
        return;
    }

    if (command === 'push' || command === 'publish') {
        await ensureRegistryLogin({
            namespace,
            autoLogin: args['skip-login'] === true ? false : DEFAULT_AUTO_LOGIN,
        });
    }

    if (command === 'build' || command === 'publish') {
        for (const svc of selected) {
            await buildService(svc, {namespace, tag, noCache, push: command === 'publish'});
        }
    }

    if (command === 'push') {
        for (const svc of selected) {
            await pushService(svc, {namespace, tag});
        }
    }

    if (command !== 'build' && command !== 'push' && command !== 'publish' && command !== 'list') {
        console.error(`Unknown command: ${command}`);
        usage();
        process.exitCode = 2;
    }
};

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
