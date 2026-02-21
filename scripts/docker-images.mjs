#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const DEFAULT_NAMESPACE = process.env.NOONA_DOCKER_NAMESPACE || 'captainpax';
const DEFAULT_TAG = process.env.NOONA_DOCKER_TAG || 'latest';

const ROOT = resolve('.');

const SERVICES = [
    {name: 'noona-warden', dockerfile: 'warden.Dockerfile'},
    {name: 'noona-moon', dockerfile: 'moon.Dockerfile'},
    {name: 'noona-sage', dockerfile: 'sage.Dockerfile'},
    {name: 'noona-vault', dockerfile: 'vault.Dockerfile'},
    {name: 'noona-raven', dockerfile: 'raven.Dockerfile'},
    {name: 'noona-portal', dockerfile: 'portal.Dockerfile'},
    {name: 'noona-oracle', dockerfile: 'oracle.Dockerfile', optional: true},
];

const ALIASES = Object.freeze({
    warden: 'noona-warden',
    moon: 'noona-moon',
    sage: 'noona-sage',
    vault: 'noona-vault',
    raven: 'noona-raven',
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
            '  node docker-images.mjs build [--services moon,sage] [--tag latest] [--namespace captainpax] [--no-cache]',
            '  node docker-images.mjs push  [--services moon,sage] [--tag latest] [--namespace captainpax]',
            '  node docker-images.mjs publish [--services moon,sage] [--tag latest] [--namespace captainpax] [--no-cache]',
            '',
            'Env:',
            '  NOONA_DOCKER_NAMESPACE   Default namespace (default: captainpax)',
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

const resolveImageTag = (serviceName, {namespace, tag}) => `${namespace}/${serviceName}:${tag}`;

const runDocker = (args) =>
    new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('docker', args, {stdio: 'inherit', cwd: ROOT, shell: false});
        child.on('error', rejectPromise);
        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`docker ${args.join(' ')} failed (exit ${code})`));
        });
    });

const canBuildService = (service) => {
    const dockerfilePath = resolve(ROOT, service.dockerfile);
    if (!existsSync(dockerfilePath)) {
        return {ok: false, reason: `Missing Dockerfile: ${service.dockerfile}`};
    }

    // Oracle is currently optional in this checkout (services/oracle may not exist).
    if (service.name === 'noona-oracle' && !existsSync(resolve(ROOT, 'services/oracle'))) {
        return {ok: false, reason: 'Missing services/oracle; skipping noona-oracle.'};
    }

    return {ok: true};
};

const buildService = async (service, {namespace, tag, noCache}) => {
    const preflight = canBuildService(service);
    if (!preflight.ok) {
        console.warn(`[skip] ${service.name}: ${preflight.reason}`);
        return {ok: true, skipped: true};
    }

    const image = resolveImageTag(service.name, {namespace, tag});
    const dockerArgs = ['build', '-f', service.dockerfile, '-t', image];
    if (noCache) dockerArgs.push('--no-cache');
    dockerArgs.push('.');

    console.log(`[build] ${service.name} -> ${image}`);
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

    const namespace = String(args.namespace || DEFAULT_NAMESPACE).trim();
    const tag = String(args.tag || DEFAULT_TAG).trim();
    const noCache = args['no-cache'] === true || String(args['no-cache'] || '').toLowerCase() === 'true';

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

    if (command === 'build' || command === 'publish') {
        for (const svc of selected) {
            await buildService(svc, {namespace, tag, noCache});
        }
    }

    if (command === 'push' || command === 'publish') {
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
