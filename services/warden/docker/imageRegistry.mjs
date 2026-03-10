const DEFAULT_NOONA_DOCKER_REGISTRY = 'docker.darkmatterservers.com';
const DEFAULT_NOONA_DOCKER_PROJECT = 'the-noona-project';
const DEFAULT_NOONA_DOCKER_TAG = 'latest';

function normalizeNamespace(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function normalizeTag(value) {
    if (typeof value !== 'string') {
        return DEFAULT_NOONA_DOCKER_TAG;
    }

    const trimmed = value.trim();
    return trimmed || DEFAULT_NOONA_DOCKER_TAG;
}

export function resolveNoonaImageNamespace(env = process.env) {
    const namespace = normalizeNamespace(env?.NOONA_DOCKER_NAMESPACE);
    if (namespace) {
        return namespace;
    }

    const registry = normalizeNamespace(env?.NOONA_DOCKER_REGISTRY) || DEFAULT_NOONA_DOCKER_REGISTRY;
    const project = normalizeNamespace(env?.NOONA_DOCKER_PROJECT) || DEFAULT_NOONA_DOCKER_PROJECT;
    return `${registry}/${project}`;
}

export function resolveNoonaImage(name, options = {}) {
    const env = options?.env || process.env;
    const namespace = resolveNoonaImageNamespace(env);
    const serviceName = typeof name === 'string' ? name.trim() : '';
    const tag = normalizeTag(options?.tag || env?.NOONA_DOCKER_TAG);

    if (!serviceName) {
        throw new Error('Noona image name must be a non-empty string.');
    }

    return `${namespace}/${serviceName}:${tag}`;
}

export {
    DEFAULT_NOONA_DOCKER_PROJECT,
    DEFAULT_NOONA_DOCKER_REGISTRY,
    DEFAULT_NOONA_DOCKER_TAG,
};
