// services/vault/users/userAuth.mjs

import crypto from 'node:crypto';

export const parseBooleanInput = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value > 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        if (['1', 'true', 'yes', 'on', 'super'].includes(normalized)) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return null;
};

const VALID_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

export const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
export const normalizeUsername = (value) => normalizeString(value);
export const normalizeUsernameKey = (value) => normalizeUsername(value).toLowerCase();
export const normalizeRole = (value, fallback = 'member') => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'admin' || normalized === 'member') {
        return normalized;
    }
    return fallback;
};

const LEGACY_MOON_PERMISSION_ALIASES = Object.freeze({
    lookup_new_title: 'library_management',
    download_new_title: 'download_management',
    check_download_missing_titles: 'download_management',
});
const SUPPORTED_MOON_PERMISSION_KEYS = Object.freeze([
    'moon_login',
    'library_management',
    'download_management',
    'user_management',
    'admin',
    ...Object.keys(LEGACY_MOON_PERMISSION_ALIASES),
]);
export const MOON_OP_PERMISSION_KEYS = Object.freeze([
    'moon_login',
    'library_management',
    'download_management',
    'user_management',
    'admin',
]);

const MOON_OP_PERMISSION_SET = new Set(SUPPORTED_MOON_PERMISSION_KEYS);
const DEFAULT_MEMBER_PERMISSION_KEYS = Object.freeze([
    'moon_login',
    'library_management',
    'download_management',
]);

export const sortMoonPermissions = (permissions = []) => {
    const present = new Set(Array.isArray(permissions) ? permissions : []);
    return MOON_OP_PERMISSION_KEYS.filter((entry) => present.has(entry));
};

const normalizePermissionEntry = (value) => normalizeString(value).toLowerCase();
const normalizePermissionKey = (value) => {
    const key = normalizePermissionEntry(value);
    if (!key || !MOON_OP_PERMISSION_SET.has(key)) {
        return '';
    }

    return LEGACY_MOON_PERMISSION_ALIASES[key] ?? key;
};

export const normalizePermissionList = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized = [];
    for (const entry of value) {
        const key = normalizePermissionKey(entry);
        if (!key) {
            continue;
        }
        normalized.push(key);
    }

    return sortMoonPermissions(Array.from(new Set(normalized)));
};

export const validatePermissionListInput = (value) => {
    if (!Array.isArray(value)) {
        return {ok: false, error: 'permissions must be provided as an array.'};
    }

    const normalized = [];
    for (const entry of value) {
        const rawKey = normalizePermissionEntry(entry);
        if (!rawKey) {
            continue;
        }
        if (!MOON_OP_PERMISSION_SET.has(rawKey)) {
            return {ok: false, error: `Unsupported permission: ${rawKey}`};
        }
        normalized.push(LEGACY_MOON_PERMISSION_ALIASES[rawKey] ?? rawKey);
    }

    return {
        ok: true,
        permissions: sortMoonPermissions(Array.from(new Set(normalized))),
    };
};

export const defaultPermissionsForRole = (role) =>
    normalizeRole(role, 'member') === 'admin'
        ? [...MOON_OP_PERMISSION_KEYS]
        : [...DEFAULT_MEMBER_PERMISSION_KEYS];

export const isValidUsername = (username) => VALID_USERNAME_PATTERN.test(username);
export const isValidPassword = (password) => typeof password === 'string' && password.length >= 8;

export const parseUserTimestamp = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return 0;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const hashPassword = (password) => {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
    });

    return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
};

export const verifyPassword = (password, stored) => {
    if (typeof password !== 'string' || password.length === 0) {
        return false;
    }
    if (typeof stored !== 'string' || !stored.trim()) {
        return false;
    }

    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false;
    }

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const saltB64 = parts[4];
    const hashB64 = parts[5];
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
        return false;
    }

    let salt;
    let expected;
    try {
        salt = Buffer.from(saltB64, 'base64');
        expected = Buffer.from(hashB64, 'base64');
    } catch {
        return false;
    }

    let derived;
    try {
        derived = crypto.scryptSync(password, salt, expected.length, {N, r, p});
    } catch {
        return false;
    }

    if (derived.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(derived, expected);
};

export const sanitizeUser = (user) => {
    if (!user || typeof user !== 'object') {
        return null;
    }

    const role = normalizeRole(user.role, 'member');
    let permissions = normalizePermissionList(user.permissions);
    const hasExplicitPermissions = Array.isArray(user.permissions);
    if (!hasExplicitPermissions && permissions.length === 0) {
        permissions = defaultPermissionsForRole(role);
    }
    if (role === 'admin' && !permissions.includes('admin')) {
        permissions = sortMoonPermissions([...permissions, 'admin']);
    }
    if (role !== 'admin') {
        permissions = sortMoonPermissions(permissions.filter((entry) => entry !== 'admin'));
    }
    const normalizedRole = permissions.includes('admin') ? 'admin' : 'member';

    return {
        username: normalizeUsername(user.username),
        usernameNormalized: normalizeUsernameKey(user.usernameNormalized || user.username),
        role: normalizedRole,
        permissions,
        isBootstrapUser: parseBooleanInput(user?.isBootstrapUser) === true,
        createdAt: normalizeString(user.createdAt) || null,
        updatedAt: normalizeString(user.updatedAt) || null,
    };
};

export const sortUsersByRecency = (users) =>
    [...users].sort((left, right) => {
        const leftUpdated = parseUserTimestamp(left?.updatedAt);
        const rightUpdated = parseUserTimestamp(right?.updatedAt);
        if (leftUpdated !== rightUpdated) {
            return rightUpdated - leftUpdated;
        }

        const leftCreated = parseUserTimestamp(left?.createdAt);
        const rightCreated = parseUserTimestamp(right?.createdAt);
        if (leftCreated !== rightCreated) {
            return rightCreated - leftCreated;
        }

        return normalizeUsername(left?.username).localeCompare(normalizeUsername(right?.username));
    });
