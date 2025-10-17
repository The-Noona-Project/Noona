import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WINDOWS_PIPE_PREFIX = '//./pipe/';
const WINDOWS_PIPE_PATTERN = /^(?:\\\\\.\\pipe\\|\/\/\.\/pipe\/)/i;

function normalizeWindowsPipePath(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const replaced = value.replace(/\\/g, '/');
    const segments = replaced.split('/').map((part) => part.trim()).filter(Boolean);

    if (!segments.length) {
        return null;
    }

    // Remove optional leading dot segment produced by patterns like //./pipe or .\pipe
    if (segments[0] === '.') {
        segments.shift();
    }

    // Normalise any lingering '." prefix (e.g. .\pipe after trimming)
    if (segments[0]?.startsWith('.')) {
        segments[0] = segments[0].replace(/^\.+/, '');
    }

    if (segments[0]?.toLowerCase() !== 'pipe') {
        segments.unshift('pipe');
    }

    return `${WINDOWS_PIPE_PREFIX}${segments.slice(1).join('/')}`;
}

export function normalizeDockerSocket(candidate) {
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

    if (trimmed.startsWith('tcp://')) {
        return null;
    }

    if (trimmed.startsWith('npipe://')) {
        const remainder = trimmed.slice('npipe://'.length);
        return normalizeWindowsPipePath(remainder);
    }

    if (WINDOWS_PIPE_PATTERN.test(trimmed)) {
        return normalizeWindowsPipePath(trimmed);
    }

    return trimmed;
}

export function isWindowsPipePath(candidate) {
    if (!candidate || typeof candidate !== 'string') {
        return false;
    }

    const normalized = candidate.replace(/\\/g, '/');
    return normalized.toLowerCase().startsWith(WINDOWS_PIPE_PREFIX);
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
