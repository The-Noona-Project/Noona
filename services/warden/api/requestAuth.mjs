import {buildWardenApiTokenRegistry} from '../docker/wardenApiTokens.mjs';

export const WARDEN_API_CLIENT_NAMES = Object.freeze([
    'noona-sage',
    'noona-portal',
]);

const PORTAL_ALLOWED_PERMISSIONS = new Set([
    'read-services',
    'read-install-progress',
    'read-installation-logs',
    'read-service-health',
    'read-service-logs',
    'read-updates',
]);

export function extractBearerToken(headers = {}) {
    const authHeader = headers?.authorization || headers?.Authorization || '';
    if (typeof authHeader !== 'string') {
        return null;
    }

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
}

export function buildWardenApiServiceByToken(env = process.env) {
    const tokensByService = buildWardenApiTokenRegistry(WARDEN_API_CLIENT_NAMES, {env});
    return Object.fromEntries(
        Object.entries(tokensByService)
            .filter(([, token]) => typeof token === 'string' && token.trim())
            .map(([service, token]) => [token, service]),
    );
}

export function resolveWardenPermission(req, url, segments = []) {
    if (req?.method === 'GET' && url?.pathname === '/health') {
        return null;
    }

    if (req?.method === 'GET' && url?.pathname === '/api/debug') {
        return 'read-debug';
    }

    if (req?.method === 'POST' && url?.pathname === '/api/debug') {
        return 'manage-debug';
    }

    if (
        req?.method === 'GET'
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[2] === 'install'
        && segments[3] === 'progress'
    ) {
        return 'read-install-progress';
    }

    if (
        req?.method === 'GET'
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[2] === 'installation'
        && segments[3] === 'logs'
    ) {
        return 'read-installation-logs';
    }

    if (req?.method === 'GET' && url?.pathname === '/api/services') {
        return 'read-services';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'health'
        && req?.method === 'GET'
    ) {
        return 'read-service-health';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'logs'
        && req?.method === 'GET'
    ) {
        return 'read-service-logs';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'config'
        && req?.method === 'GET'
    ) {
        return 'read-service-config';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'config'
        && req?.method === 'PUT'
    ) {
        return 'manage-service-config';
    }

    if (req?.method === 'POST' && url?.pathname === '/api/services/install') {
        return 'manage-install';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'test'
        && req?.method === 'POST'
    ) {
        return 'manage-service-test';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'restart'
        && req?.method === 'POST'
    ) {
        return 'manage-service-restart';
    }

    if (
        segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'update'
        && req?.method === 'POST'
    ) {
        return 'manage-service-update';
    }

    if (
        req?.method === 'GET'
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[2] === 'updates'
    ) {
        return 'read-updates';
    }

    if (
        req?.method === 'POST'
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[2] === 'updates'
        && segments[3] === 'check'
    ) {
        return 'manage-updates-check';
    }

    if (req?.method === 'GET' && url?.pathname === '/api/storage/layout') {
        return 'read-storage-layout';
    }

    if (req?.method === 'GET' && url?.pathname === '/api/setup/config') {
        return 'read-setup-config';
    }

    if (req?.method === 'POST' && url?.pathname === '/api/setup/config') {
        return 'manage-setup-config';
    }

    if (
        req?.method === 'POST'
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[2] === 'noona-raven'
        && segments[3] === 'detect'
    ) {
        return 'manage-raven-detect';
    }

    if (
        req?.method === 'POST'
        && segments[0] === 'api'
        && segments[1] === 'ecosystem'
    ) {
        return 'manage-ecosystem';
    }

    return 'unknown';
}

export function isWardenRequestAuthorized(serviceName, permission) {
    if (!permission) {
        return true;
    }

    if (!serviceName) {
        return false;
    }

    if (serviceName === 'noona-sage') {
        return true;
    }

    if (serviceName === 'noona-portal') {
        return PORTAL_ALLOWED_PERMISSIONS.has(permission);
    }

    return false;
}

export function authenticateWardenRequest(req, {
    serviceByToken,
    logger,
} = {}) {
    const token = extractBearerToken(req?.headers || {});
    if (!token) {
        return {
            ok: false,
            status: 401,
            body: {error: 'Missing or invalid Authorization header.'},
        };
    }

    const serviceName = serviceByToken?.[token];
    if (!serviceName) {
        logger?.warn?.('[Warden API] Unknown service token presented.');
        return {
            ok: false,
            status: 401,
            body: {error: 'Unauthorized service token.'},
        };
    }

    return {
        ok: true,
        serviceName,
    };
}

export default {
    authenticateWardenRequest,
    buildWardenApiServiceByToken,
    extractBearerToken,
    isWardenRequestAuthorized,
    resolveWardenPermission,
    WARDEN_API_CLIENT_NAMES,
};
