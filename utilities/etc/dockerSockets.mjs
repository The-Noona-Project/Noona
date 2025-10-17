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

export default normalizeDockerSocket;
