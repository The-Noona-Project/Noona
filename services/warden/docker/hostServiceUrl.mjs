const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

const normalizeValue = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/\/+$/, '');
};

const parseAbsoluteUrl = (value) => {
    try {
        return new URL(value);
    } catch {
        return null;
    }
};

export function resolveServerIp(env = process.env) {
    const candidate = normalizeValue(env?.SERVER_IP);
    if (!candidate) {
        return '';
    }

    if (!ABSOLUTE_URL_PATTERN.test(candidate)) {
        return candidate;
    }

    const parsed = parseAbsoluteUrl(candidate);
    return parsed?.hostname || '';
}

export function resolveHostServiceBase(env = process.env) {
    const direct = normalizeValue(env?.HOST_SERVICE_URL);
    if (direct) {
        return ABSOLUTE_URL_PATTERN.test(direct) ? direct : `http://${direct}`;
    }

    const serverIp = resolveServerIp(env);
    return serverIp ? `http://${serverIp}` : 'http://localhost';
}

export function resolveHostServiceHost(env = process.env) {
    const serverIp = resolveServerIp(env);
    if (serverIp) {
        return serverIp;
    }

    const direct = normalizeValue(env?.HOST_SERVICE_URL);
    if (!direct) {
        return 'localhost';
    }

    if (!ABSOLUTE_URL_PATTERN.test(direct)) {
        return direct;
    }

    const parsed = parseAbsoluteUrl(direct);
    return parsed?.hostname || 'localhost';
}

export function resolveSharedHostEnvEntries(env = process.env) {
    const serverIp = resolveServerIp(env);
    return serverIp ? [`SERVER_IP=${serverIp}`] : [];
}
