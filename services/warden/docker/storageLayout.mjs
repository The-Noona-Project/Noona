import os from 'node:os';
import path from 'node:path';

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

export const DEFAULT_UNIX_NOONA_DATA_ROOT = '/mnt/user/noona';

export function normalizePathValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeContainerPath(value) {
    const normalized = normalizePathValue(value).replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }

    return normalized.replace(/\/+$/, '') || '/';
}

export function isWindowsAbsolutePath(value) {
    return WINDOWS_DRIVE_PATH_PATTERN.test(value);
}

export function toAbsoluteHostPath(value, {cwd = process.cwd()} = {}) {
    const trimmed = normalizePathValue(value);
    if (!trimmed) {
        return null;
    }

    if (isWindowsAbsolutePath(trimmed) || path.isAbsolute(trimmed)) {
        return path.normalize(trimmed);
    }

    return path.normalize(path.resolve(cwd, trimmed));
}

export function isLikelyNamedDockerVolume(source) {
    const trimmed = normalizePathValue(source);
    if (!trimmed) {
        return true;
    }

    if (trimmed.startsWith('.')) {
        return false;
    }

    if (isWindowsAbsolutePath(trimmed) || path.isAbsolute(trimmed)) {
        return false;
    }

    return !trimmed.includes('/') && !trimmed.includes('\\');
}

export function normalizeVaultFolderName(value, fallback = 'vault') {
    const trimmed = normalizePathValue(value);
    if (!trimmed) {
        return fallback;
    }

    if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
        return fallback;
    }

    const cleaned = trimmed.replace(/[:*?"<>|]/g, '').trim();
    return cleaned || fallback;
}

const resolveWindowsNoonaDataRoot = (env = process.env) => {
    const appData = normalizePathValue(env.APPDATA);
    if (appData) {
        return path.join(appData, 'noona');
    }

    const homeDir = normalizePathValue(env.USERPROFILE) || os.homedir();
    return path.join(homeDir, 'AppData', 'Roaming', 'noona');
};

export function resolveNoonaDataRoot({
                                         candidate = null,
                                         env = process.env,
                                         cwd = process.cwd(),
                                         platform = process.platform,
                                     } = {}) {
    const explicit = normalizePathValue(candidate);
    if (explicit) {
        return toAbsoluteHostPath(explicit, {cwd});
    }

    const envCandidate =
        normalizePathValue(env.NOONA_DATA_ROOT) ||
        normalizePathValue(env.NOONA_ROOT_DIR) ||
        normalizePathValue(env.NOONA_DATA_DIR);

    if (envCandidate) {
        return toAbsoluteHostPath(envCandidate, {cwd});
    }

    if (platform === 'win32') {
        return path.normalize(resolveWindowsNoonaDataRoot(env));
    }

    return path.normalize(DEFAULT_UNIX_NOONA_DATA_ROOT);
}

const buildFolderEntry = (hostPath, containerPath = null) => ({
    hostPath: path.normalize(hostPath),
    containerPath,
});

export function buildNoonaStorageLayout(rootPath, {vaultFolderName = 'vault'} = {}) {
    const root = path.normalize(rootPath);
    const normalizedVaultFolder = normalizeVaultFolderName(vaultFolderName, 'vault');

    return {
        root,
        services: {
            'noona-moon': {
                logs: buildFolderEntry(path.join(root, 'moon', 'logs'), '/var/log/noona'),
            },
            'noona-portal': {
                logs: buildFolderEntry(path.join(root, 'portal', 'logs'), '/var/log/noona'),
            },
            'noona-raven': {
                downloads: buildFolderEntry(path.join(root, 'raven', 'downloads'), '/downloads'),
                logs: buildFolderEntry(path.join(root, 'raven', 'logs'), '/app/logs'),
            },
            'noona-sage': {
                logs: buildFolderEntry(path.join(root, 'sage', 'logs'), '/var/log/noona'),
            },
            'noona-vault': {
                logs: buildFolderEntry(path.join(root, normalizedVaultFolder, 'logs'), '/var/log/noona'),
                redis: buildFolderEntry(path.join(root, normalizedVaultFolder, 'redis'), '/data'),
                mongo: buildFolderEntry(path.join(root, normalizedVaultFolder, 'mongo'), '/data/db'),
            },
            'noona-redis': {
                data: buildFolderEntry(path.join(root, normalizedVaultFolder, 'redis'), '/data'),
            },
            'noona-mongo': {
                data: buildFolderEntry(path.join(root, normalizedVaultFolder, 'mongo'), '/data/db'),
            },
            'noona-kavita': {
                config: buildFolderEntry(path.join(root, 'kavita', 'config'), '/kavita/config'),
                manga: buildFolderEntry(path.join(root, 'raven', 'downloads'), '/manga'),
            },
            'noona-komf': {
                config: buildFolderEntry(path.join(root, 'komf', 'config'), '/config'),
            },
        },
    };
}

export function describeNoonaStorageLayout(rootPath, options = {}) {
    const layout = buildNoonaStorageLayout(rootPath, options);
    const order = [
        'noona-moon',
        'noona-portal',
        'noona-raven',
        'noona-sage',
        'noona-vault',
        'noona-redis',
        'noona-mongo',
        'noona-kavita',
        'noona-komf',
    ];

    const services = order
        .map((service) => {
            const folders = layout.services[service];
            if (!folders) {
                return null;
            }

            return {
                service,
                folders: Object.entries(folders).map(([key, value]) => ({
                    key,
                    hostPath: value.hostPath,
                    containerPath: value.containerPath,
                })),
            };
        })
        .filter(Boolean);

    return {
        root: layout.root,
        services,
    };
}

export default {
    buildNoonaStorageLayout,
    describeNoonaStorageLayout,
    isLikelyNamedDockerVolume,
    isWindowsAbsolutePath,
    normalizeContainerPath,
    normalizePathValue,
    normalizeVaultFolderName,
    resolveNoonaDataRoot,
    toAbsoluteHostPath,
};
