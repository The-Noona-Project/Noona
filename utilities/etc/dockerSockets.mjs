import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WINDOWS_PIPE_PREFIX = '//./pipe/';
const WINDOWS_PIPE_PATTERN = /^(?:\.\/|[\\/]+\.?)*pipe(?:[\\/]|$)/i;
const TCP_PROTOCOL_PATTERN = /^(?:tcp|https?|http):\/\//i;

function formatHostForUrl(hostname) {
    if (typeof hostname !== 'string') {
        return '';
    }

    if (hostname.includes(':') && !hostname.startsWith('[')) {
        return `[${hostname}]`;
    }

    return hostname;
}

export function parseTcpDockerSocket(candidate) {
    if (!candidate || typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed || !TCP_PROTOCOL_PATTERN.test(trimmed)) {
        return null;
    }

    try {
        const url = new URL(trimmed);
        const rawProtocol = url.protocol.replace(':', '').toLowerCase();
        if (!TCP_PROTOCOL_PATTERN.test(`${rawProtocol}://`)) {
            return null;
        }

        const hostname = url.hostname?.trim();
        if (!hostname) {
            return null;
        }

        const normalizedHost = formatHostForUrl(hostname);
        const protocol = rawProtocol === 'https' ? 'https' : 'http';
        const defaultPort = protocol === 'https' ? 2376 : 2375;
        const port = url.port ? Number.parseInt(url.port, 10) : defaultPort;
        const normalizedPort = Number.isFinite(port) && port > 0 ? port : defaultPort;
        const href = `${rawProtocol}://${normalizedHost}:${normalizedPort}`;

        return {
            host: hostname,
            port: normalizedPort,
            protocol,
            rawProtocol,
            href,
        };
    } catch {
        return null;
    }
}

export function isTcpDockerSocket(candidate) {
    if (!candidate || typeof candidate !== 'string') {
        return false;
    }

    return TCP_PROTOCOL_PATTERN.test(candidate.trim());
}

function normalizeWindowsPipePath(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const replaced = value.replace(/\\/g, '/');

    if (!WINDOWS_PIPE_PATTERN.test(replaced)) {
        return null;
    }

    const segments = replaced
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);

    if (!segments.length) {
        return null;
    }

    while (segments[0] === '.') {
        segments.shift();
    }

    if (segments[0]?.startsWith('.')) {
        segments[0] = segments[0].replace(/^\.+/, '');
        if (!segments[0]) {
            segments.shift();
        }
    }

    if (!segments.length || segments[0]?.toLowerCase() !== 'pipe') {
        return null;
    }

    const suffix = segments.slice(1).join('/');
    if (!suffix) {
        return WINDOWS_PIPE_PREFIX.slice(0, -1);
    }

    return `${WINDOWS_PIPE_PREFIX}${suffix}`;
}

export function normalizeDockerSocket(candidate, { allowRemote = false } = {}) {
    if (!candidate || typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('unix://')) {
        return trimmed.slice('unix://'.length);
    }

    if (TCP_PROTOCOL_PATTERN.test(trimmed)) {
        if (!allowRemote) {
            return null;
        }

        const parsed = parseTcpDockerSocket(trimmed);
        return parsed?.href ?? null;
    }

    if (trimmed.startsWith('npipe://')) {
        const remainder = trimmed.slice('npipe://'.length);
        return normalizeWindowsPipePath(remainder);
    }

    const normalizedPipe = normalizeWindowsPipePath(trimmed);
    if (normalizedPipe) {
        return normalizedPipe;
    }

    return trimmed;
}

export function isWindowsPipePath(candidate) {
    if (!candidate || typeof candidate !== 'string') {
        return false;
    }

    const normalized = candidate.replace(/\\/g, '/');
    return WINDOWS_PIPE_PATTERN.test(normalized);
}

export function defaultDockerSocketDetector({
    env = process.env,
    fs: fsModule = fs,
    process: processModule = process,
    spawnSync: spawnSyncImpl = spawnSync,
} = {}) {
    const sockets = new Set();

    const addCandidate = (candidate) => {
        const normalized = normalizeDockerSocket(candidate);
        if (normalized) {
            sockets.add(normalized);
        }
    };

    const envCandidates = [env?.NOONA_HOST_DOCKER_SOCKETS, env?.HOST_DOCKER_SOCKETS]
        .filter(value => typeof value === 'string' && value.trim().length > 0)
        .flatMap(value => value.split(',').map(entry => normalizeDockerSocket(entry)));

    for (const candidate of envCandidates) {
        if (candidate) {
            sockets.add(candidate);
        }
    }

    const dockerHost = normalizeDockerSocket(env?.DOCKER_HOST);
    if (dockerHost) {
        sockets.add(dockerHost);
    }

    const unixSocketDefaults = [
        '/var/run/docker.sock',
        '/var/run/docker/docker.sock',
        '/run/docker.sock',
        '/run/docker/docker.sock',
        '/var/run/podman/podman.sock',
        '/run/podman/podman.sock',
    ];

    const defaultCandidates = processModule?.platform === 'win32'
        ? [
            'npipe:////./pipe/docker_engine',
            '\\\\.\\pipe\\docker_engine',
            '//./pipe/docker_engine',
            ...unixSocketDefaults,
        ]
        : unixSocketDefaults;

    for (const candidate of defaultCandidates) {
        addCandidate(candidate);
    }

    if (processModule?.platform === 'win32' && typeof spawnSyncImpl === 'function') {
        try {
            const command = [
                'Get-ChildItem',
                String.raw`-Path '\\.\pipe\'`,
                "-Filter '*docker*'",
                '| Select -ExpandProperty FullName',
            ].join(' ');

            const probe = spawnSyncImpl('powershell.exe', [
                '-NoProfile',
                '-Command',
                command,
            ], { encoding: 'utf8' });

            if (probe?.stdout) {
                probe.stdout
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .forEach(addCandidate);
            }
        } catch (error) {
            // Ignore PowerShell discovery errors on Windows.
        }
    }

    if (typeof fsModule?.readdirSync === 'function') {
        const directories = [
            '/var/run',
            '/run',
            '/var/run/docker',
            '/run/docker',
            '/var/run/podman',
            '/run/podman',
        ];

        for (const directory of directories) {
            try {
                const entries = fsModule.readdirSync(directory, { withFileTypes: true });

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }

                    const isSocket = typeof entry.isSocket === 'function' && entry.isSocket();
                    const isFile = typeof entry.isFile === 'function' && entry.isFile();

                    if (!isSocket && !isFile) {
                        continue;
                    }

                    const name = entry.name;
                    if (!name || !name.toLowerCase().includes('sock')) {
                        continue;
                    }

                    if (!/(docker|podman)/i.test(name)) {
                        continue;
                    }

                    const fullPath = path.posix.join(directory, name);
                    sockets.add(fullPath);
                }
            } catch (error) {
                // Ignore inaccessible directories.
            }
        }
    }

    return Array.from(sockets);
}

export default normalizeDockerSocket;
