// services/vault/shared/vaultApp.mjs
import express from 'express';
import crypto from 'node:crypto';

let cachedHandlePacket = null;

async function getDefaultHandlePacket() {
    if (!cachedHandlePacket) {
        const module = await import('../../../utilities/database/packetParser.mjs');
        cachedHandlePacket = module.handlePacket;
    }

    return cachedHandlePacket;
}

const fallbackLogger = {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    debug: (...args) => (console.debug ? console.debug(...args) : console.log(...args)),
};

const parseBooleanInput = (value) => {
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
const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeUsername = (value) => normalizeString(value);
const normalizeUsernameKey = (value) => normalizeUsername(value).toLowerCase();
const normalizeRole = (value, fallback = 'member') => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'admin' || normalized === 'member') {
        return normalized;
    }
    return fallback;
};
const MOON_OP_PERMISSION_KEYS = Object.freeze([
    'moon_login',
    'lookup_new_title',
    'download_new_title',
    'check_download_missing_titles',
    'user_management',
    'admin',
]);
const MOON_OP_PERMISSION_SET = new Set(MOON_OP_PERMISSION_KEYS);
const DEFAULT_MEMBER_PERMISSION_KEYS = Object.freeze([
    'moon_login',
    'lookup_new_title',
    'download_new_title',
    'check_download_missing_titles',
]);
const sortMoonPermissions = (permissions = []) => {
    const present = new Set(Array.isArray(permissions) ? permissions : []);
    return MOON_OP_PERMISSION_KEYS.filter((entry) => present.has(entry));
};
const normalizePermissionEntry = (value) => normalizeString(value).toLowerCase();
const normalizePermissionList = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized = [];
    for (const entry of value) {
        const key = normalizePermissionEntry(entry);
        if (!key || !MOON_OP_PERMISSION_SET.has(key)) {
            continue;
        }
        normalized.push(key);
    }

    return sortMoonPermissions(Array.from(new Set(normalized)));
};
const validatePermissionListInput = (value) => {
    if (!Array.isArray(value)) {
        return {ok: false, error: 'permissions must be provided as an array.'};
    }

    const normalized = [];
    for (const entry of value) {
        const key = normalizePermissionEntry(entry);
        if (!key) {
            continue;
        }
        if (!MOON_OP_PERMISSION_SET.has(key)) {
            return {ok: false, error: `Unsupported permission: ${key}`};
        }
        normalized.push(key);
    }

    return {
        ok: true,
        permissions: sortMoonPermissions(Array.from(new Set(normalized))),
    };
};
const defaultPermissionsForRole = (role) =>
    normalizeRole(role, 'member') === 'admin'
        ? [...MOON_OP_PERMISSION_KEYS]
        : [...DEFAULT_MEMBER_PERMISSION_KEYS];
const isValidUsername = (username) => VALID_USERNAME_PATTERN.test(username);
const isValidPassword = (password) => typeof password === 'string' && password.length >= 8;
const parseUserTimestamp = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) return 0;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const hashPassword = (password) => {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
    });

    return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
};

const verifyPassword = (password, stored) => {
    if (typeof password !== 'string' || password.length === 0) return false;
    if (typeof stored !== 'string' || !stored.trim()) return false;

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

    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
};

const sanitizeUser = (user) => {
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

export function parseTokenMap(tokenMapString = '') {
    const tokenPairs = tokenMapString
        .split(',')
        .map(pair => pair.trim())
        .filter(Boolean)
        .map(pair => {
            const [service, token] = pair.split(':');
            return [service?.trim(), token?.trim()];
        })
        .filter(([service, token]) => Boolean(service && token));

    const tokensByService = Object.fromEntries(tokenPairs);
    const serviceByToken = Object.fromEntries(
        tokenPairs.map(([service, token]) => [token, service])
    );

    return { tokenPairs, tokensByService, serviceByToken };
}

export function extractBearerToken(req) {
    const authHeader = req.headers?.authorization || '';
    if (typeof authHeader !== 'string') return null;

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
}

export function createRequireAuth({ serviceByToken = {}, debug = fallbackLogger.debug } = {}) {
    return function requireAuth(req, res, next) {
        const token = extractBearerToken(req);
        if (!token) {
            return res
                .status(401)
                .json({ error: 'Missing or invalid Authorization header' });
        }

        const serviceName = serviceByToken[token];
        if (!serviceName) {
            debug(`[Vault] ❌ Unknown token presented: ${token.slice(0, 6)}***`);
            return res.status(401).json({ error: 'Unauthorized service token' });
        }

        req.serviceName = serviceName;
        next();
    };
}

export function createVaultApp(options = {}) {
    const {
        env = process.env,
        handlePacket,
        expressFactory = express,
        logger: loggerOption = {},
        log,
        warn,
        debug,
        isDebugEnabled,
        setDebug,
    } = options;

    const logger = {
        ...fallbackLogger,
        ...loggerOption,
    };

    if (typeof log === 'function') {
        logger.log = log;
    }

    if (typeof warn === 'function') {
        logger.warn = warn;
    }

    if (typeof debug === 'function') {
        logger.debug = debug;
    }

    const { tokenPairs, tokensByService, serviceByToken } = parseTokenMap(
        env.VAULT_TOKEN_MAP || ''
    );

    if (!tokenPairs.length) {
        logger.warn('[Vault] ⚠️ No service tokens were loaded. Protected routes will reject all requests.');
    } else {
        const serviceList = tokenPairs.map(([service]) => service).join(', ');
        logger.log(`[Vault] Loaded API tokens for: ${serviceList}`);
    }

    const app = expressFactory();
    app.use(express.json());

    const requireAuth = createRequireAuth({ serviceByToken, debug: logger.debug });
    const getDebugState =
        typeof isDebugEnabled === 'function'
            ? isDebugEnabled
            : typeof loggerOption?.isDebugEnabled === 'function'
                ? loggerOption.isDebugEnabled
                : () => false;
    const applyDebugState =
        typeof setDebug === 'function'
            ? setDebug
            : typeof loggerOption?.setDebug === 'function'
                ? loggerOption.setDebug
                : () => {
                };

    const resolvePacketHandler = async () => {
        if (handlePacket) {
            return handlePacket;
        }

        return await getDefaultHandlePacket();
    };

    app.get('/v1/vault/health', (req, res) => {
        res.send('Vault is up and running');
    });

    app.get('/v1/vault/debug', requireAuth, (req, res) => {
        res.json({enabled: getDebugState() === true});
    });

    app.post('/v1/vault/debug', requireAuth, (req, res) => {
        const enabled = parseBooleanInput(req.body?.enabled);
        if (enabled == null) {
            res.status(400).json({error: 'enabled must be a boolean value.'});
            return;
        }

        applyDebugState(enabled);
        logger.debug(`[Vault] Debug mode set to ${enabled} by ${req.serviceName}`);
        res.json({enabled: getDebugState() === true});
    });

    app.post('/v1/vault/handle', requireAuth, async (req, res) => {
        const packet = req.body;

        logger.debug(`[Vault] Handling packet from ${req.serviceName}`);
        const handler = await resolvePacketHandler();

        const result = await handler(packet);
        if (result?.error) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result ?? {});
    });

    const SECRETS_COLLECTION = env.VAULT_SECRETS_COLLECTION || 'vault_secrets';
    const USERS_COLLECTION = env.VAULT_USERS_COLLECTION || 'noona_users';

    const listAuthUsers = async () => {
        const handler = await resolvePacketHandler();
        const result = await handler({
            storageType: 'mongo',
            operation: 'findMany',
            payload: {
                collection: USERS_COLLECTION,
                query: {},
            },
        });

        if (result?.error) {
            throw new Error(String(result.error || 'Unable to load users.'));
        }

        if (!Array.isArray(result?.data)) {
            return [];
        }

        return result.data.filter((entry) => entry && typeof entry === 'object');
    };

    const normalizedLookupKey = (user) => {
        const fromNormalized = normalizeUsernameKey(user?.usernameNormalized);
        if (fromNormalized) return fromNormalized;
        return normalizeUsernameKey(user?.username);
    };

    const findUserByLookupKey = (users, lookupKey) => {
        if (!lookupKey || !Array.isArray(users)) {
            return null;
        }

        return users.find((entry) => normalizedLookupKey(entry) === lookupKey) ?? null;
    };

    const buildUserLookupQuery = (user, fallbackLookupKey = '') => {
        if (user && Object.prototype.hasOwnProperty.call(user, '_id')) {
            return {_id: user._id};
        }

        const usernameNormalized = normalizeUsernameKey(user?.usernameNormalized);
        if (usernameNormalized) {
            return {usernameNormalized};
        }

        const username = normalizeUsername(user?.username);
        if (username) {
            return {username};
        }

        if (fallbackLookupKey) {
            return {usernameNormalized: fallbackLookupKey};
        }

        return null;
    };

    const refreshNormalizedUsernameIfMissing = async (user, lookupKey, actor = 'system') => {
        if (!user || !lookupKey) {
            return user;
        }

        if (normalizeUsernameKey(user.usernameNormalized) === lookupKey) {
            return user;
        }

        const query = buildUserLookupQuery(user, lookupKey);
        if (!query) {
            return user;
        }

        const handler = await resolvePacketHandler();
        const now = new Date().toISOString();
        const result = await handler({
            storageType: 'mongo',
            operation: 'update',
            payload: {
                collection: USERS_COLLECTION,
                query,
                update: {
                    $set: {
                        usernameNormalized: lookupKey,
                        updatedAt: now,
                        updatedBy: actor,
                    },
                },
            },
        });

        if (result?.error) {
            return user;
        }

        return {
            ...user,
            usernameNormalized: lookupKey,
            updatedAt: now,
            updatedBy: actor,
        };
    };

    const sortUsersByRecency = (users) =>
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

    app.get('/api/users', requireAuth, async (req, res) => {
        try {
            const roleRaw = normalizeString(req.query?.role);
            const roleFilter = roleRaw ? roleRaw.toLowerCase() : null;
            if (roleFilter && roleFilter !== 'admin' && roleFilter !== 'member') {
                res.status(400).json({error: 'role must be "admin" or "member".'});
                return;
            }

            const users = await listAuthUsers();
            const filtered = roleFilter
                ? users.filter((entry) => sanitizeUser(entry)?.role === roleFilter)
                : users;

            res.json({users: sortUsersByRecency(filtered).map((entry) => sanitizeUser(entry)).filter(Boolean)});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to list users.'});
        }
    });

    app.get('/api/users/:username', requireAuth, async (req, res) => {
        const lookup = normalizeUsername(req.params?.username);
        const lookupKey = normalizeUsernameKey(lookup);
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'});
            return;
        }

        try {
            const users = await listAuthUsers();
            let user = findUserByLookupKey(users, lookupKey);
            if (!user) {
                res.status(404).json({error: 'User not found.'});
                return;
            }

            user = await refreshNormalizedUsernameIfMissing(user, lookupKey, req.serviceName);
            res.json({user: sanitizeUser(user)});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to read user.'});
        }
    });

    app.post('/api/users', requireAuth, async (req, res) => {
        const username = normalizeUsername(req.body?.username);
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const roleInput = req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')
            ? req.body.role
            : 'member';
        const hasPermissionsInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions');
        const hasBootstrapFlagInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'isBootstrapUser');

        if (!isValidUsername(username)) {
            res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'});
            return;
        }

        if (!isValidPassword(password)) {
            res.status(400).json({error: 'password must be at least 8 characters.'});
            return;
        }

        const roleRaw = normalizeString(roleInput).toLowerCase();
        if (roleRaw && roleRaw !== 'admin' && roleRaw !== 'member') {
            res.status(400).json({error: 'role must be "admin" or "member".'});
            return;
        }
        let role = normalizeRole(roleRaw, 'member');
        let permissions = defaultPermissionsForRole(role);
        if (hasPermissionsInput) {
            const parsedPermissions = validatePermissionListInput(req.body?.permissions);
            if (!parsedPermissions.ok) {
                res.status(400).json({error: parsedPermissions.error});
                return;
            }
            permissions = parsedPermissions.permissions;
        }
        if (role === 'admin' && !permissions.includes('admin')) {
            permissions = sortMoonPermissions([...permissions, 'admin']);
        }
        if (role !== 'admin' && permissions.includes('admin')) {
            role = 'admin';
        }
        if (role !== 'admin') {
            permissions = sortMoonPermissions(permissions.filter((entry) => entry !== 'admin'));
        }

        let isBootstrapUser = false;
        if (hasBootstrapFlagInput) {
            const parsedFlag = parseBooleanInput(req.body?.isBootstrapUser);
            if (parsedFlag == null) {
                res.status(400).json({error: 'isBootstrapUser must be a boolean value.'});
                return;
            }
            isBootstrapUser = parsedFlag;
        }

        try {
            const usernameNormalized = normalizeUsernameKey(username);
            const users = await listAuthUsers();
            if (findUserByLookupKey(users, usernameNormalized)) {
                res.status(409).json({error: 'User already exists.'});
                return;
            }

            const now = new Date().toISOString();
            const handler = await resolvePacketHandler();
            const result = await handler({
                storageType: 'mongo',
                operation: 'insert',
                payload: {
                    collection: USERS_COLLECTION,
                    data: {
                        username,
                        usernameNormalized,
                        passwordHash: hashPassword(password),
                        role,
                        permissions,
                        isBootstrapUser,
                        createdAt: now,
                        updatedAt: now,
                        createdBy: req.serviceName,
                        updatedBy: req.serviceName,
                    },
                },
            });

            if (result?.error) {
                throw new Error(String(result.error || 'Unable to create user.'));
            }

            res.status(201).json({
                ok: true,
                user: sanitizeUser({
                    username,
                    usernameNormalized,
                    role,
                    permissions,
                    isBootstrapUser,
                    createdAt: now,
                    updatedAt: now,
                }),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to create user.'});
        }
    });

    app.put('/api/users/:username', requireAuth, async (req, res) => {
        const currentLookup = normalizeUsername(req.params?.username);
        const currentLookupKey = normalizeUsernameKey(currentLookup);
        if (!currentLookupKey) {
            res.status(400).json({error: 'username is required.'});
            return;
        }

        const hasUsernameUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'username');
        const hasPasswordUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'password');
        const hasRoleUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role');
        const hasPermissionsUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions');
        const hasBootstrapFlagUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'isBootstrapUser');

        if (!hasUsernameUpdate && !hasPasswordUpdate && !hasRoleUpdate && !hasPermissionsUpdate && !hasBootstrapFlagUpdate) {
            res.status(400).json({error: 'At least one user field must be updated.'});
            return;
        }

        try {
            const users = await listAuthUsers();
            const targetUser = findUserByLookupKey(users, currentLookupKey);
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'});
                return;
            }

            const nextUsername = hasUsernameUpdate ? normalizeUsername(req.body?.username) : normalizeUsername(targetUser.username);
            if (!isValidUsername(nextUsername)) {
                res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'});
                return;
            }
            const nextLookupKey = normalizeUsernameKey(nextUsername);

            const conflicting = users.find((entry) => {
                const entryLookup = normalizedLookupKey(entry);
                if (!entryLookup) return false;
                if (entryLookup !== nextLookupKey) return false;
                return entryLookup !== currentLookupKey;
            });
            if (conflicting) {
                res.status(409).json({error: 'Username is already in use.'});
                return;
            }

            const currentRole = normalizeRole(targetUser?.role, 'member');
            let nextRole = hasRoleUpdate ? normalizeRole(req.body?.role, currentRole) : currentRole;
            let nextPermissions = normalizePermissionList(targetUser?.permissions);
            const targetHasExplicitPermissions = Array.isArray(targetUser?.permissions);
            if (!targetHasExplicitPermissions && nextPermissions.length === 0) {
                nextPermissions = defaultPermissionsForRole(currentRole);
            }

            if (hasPermissionsUpdate) {
                const parsedPermissions = validatePermissionListInput(req.body?.permissions);
                if (!parsedPermissions.ok) {
                    res.status(400).json({error: parsedPermissions.error});
                    return;
                }
                nextPermissions = parsedPermissions.permissions;
                if (!hasRoleUpdate) {
                    nextRole = nextPermissions.includes('admin') ? 'admin' : 'member';
                }
            } else if (hasRoleUpdate) {
                nextPermissions = defaultPermissionsForRole(nextRole);
            }

            if (nextRole === 'admin' && !nextPermissions.includes('admin')) {
                nextPermissions = sortMoonPermissions([...nextPermissions, 'admin']);
            }
            if (nextRole !== 'admin') {
                nextPermissions = sortMoonPermissions(nextPermissions.filter((entry) => entry !== 'admin'));
            }

            let nextBootstrapFlag = parseBooleanInput(targetUser?.isBootstrapUser) === true;
            if (hasBootstrapFlagUpdate) {
                const parsedFlag = parseBooleanInput(req.body?.isBootstrapUser);
                if (parsedFlag == null) {
                    res.status(400).json({error: 'isBootstrapUser must be a boolean value.'});
                    return;
                }
                nextBootstrapFlag = parsedFlag;
            }

            const updateSet = {
                updatedAt: new Date().toISOString(),
                updatedBy: req.serviceName,
            };
            let changed = false;

            if (hasUsernameUpdate && nextUsername !== normalizeUsername(targetUser.username)) {
                updateSet.username = nextUsername;
                updateSet.usernameNormalized = nextLookupKey;
                changed = true;
            }

            if (hasPasswordUpdate) {
                const password = typeof req.body?.password === 'string' ? req.body.password : '';
                if (!isValidPassword(password)) {
                    res.status(400).json({error: 'password must be at least 8 characters.'});
                    return;
                }
                updateSet.passwordHash = hashPassword(password);
                changed = true;
            }

            const normalizedTarget = sanitizeUser(targetUser) ?? {};
            if (hasRoleUpdate || hasPermissionsUpdate) {
                if (normalizeRole(normalizedTarget.role, 'member') !== nextRole) {
                    updateSet.role = nextRole;
                    changed = true;
                }
                const currentPermissions = normalizePermissionList(normalizedTarget.permissions);
                if (JSON.stringify(currentPermissions) !== JSON.stringify(nextPermissions)) {
                    updateSet.permissions = nextPermissions;
                    changed = true;
                }
            }

            if (hasBootstrapFlagUpdate && Boolean(normalizedTarget.isBootstrapUser) !== Boolean(nextBootstrapFlag)) {
                updateSet.isBootstrapUser = nextBootstrapFlag;
                changed = true;
            }

            if (!changed) {
                const stableUser = {
                    ...targetUser,
                    username: nextUsername,
                    usernameNormalized: nextLookupKey,
                    role: nextRole,
                    permissions: nextPermissions,
                    isBootstrapUser: nextBootstrapFlag,
                };
                res.json({ok: true, user: sanitizeUser(stableUser)});
                return;
            }

            const query = buildUserLookupQuery(targetUser, currentLookupKey);
            if (!query) {
                res.status(400).json({error: 'Unable to resolve user lookup query.'});
                return;
            }

            const handler = await resolvePacketHandler();
            const result = await handler({
                storageType: 'mongo',
                operation: 'update',
                payload: {
                    collection: USERS_COLLECTION,
                    query,
                    update: {$set: updateSet},
                },
            });

            if (result?.error) {
                throw new Error(String(result.error || 'Unable to update user.'));
            }

            const refreshedUsers = await listAuthUsers();
            const refreshedUser = findUserByLookupKey(refreshedUsers, nextLookupKey);
            const fallbackUser = {
                ...targetUser,
                ...updateSet,
                username: nextUsername,
                usernameNormalized: nextLookupKey,
                role: nextRole,
                permissions: nextPermissions,
                isBootstrapUser: nextBootstrapFlag,
            };
            res.json({ok: true, user: sanitizeUser(refreshedUser ?? fallbackUser)});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to update user.'});
        }
    });

    app.delete('/api/users/:username', requireAuth, async (req, res) => {
        const lookup = normalizeUsername(req.params?.username);
        const lookupKey = normalizeUsernameKey(lookup);
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'});
            return;
        }

        try {
            const users = await listAuthUsers();
            const targetUser = findUserByLookupKey(users, lookupKey);
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'});
                return;
            }

            const query = buildUserLookupQuery(targetUser, lookupKey);
            if (!query) {
                res.status(400).json({error: 'Unable to resolve user lookup query.'});
                return;
            }

            const handler = await resolvePacketHandler();
            const result = await handler({
                storageType: 'mongo',
                operation: 'delete',
                payload: {
                    collection: USERS_COLLECTION,
                    query,
                },
            });

            if (result?.error) {
                throw new Error(String(result.error || 'Unable to delete user.'));
            }

            res.json({deleted: Number(result?.deleted) > 0});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to delete user.'});
        }
    });

    app.post('/api/users/authenticate', requireAuth, async (req, res) => {
        const username = normalizeUsername(req.body?.username);
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const lookupKey = normalizeUsernameKey(username);

        if (!lookupKey || !password) {
            res.status(400).json({error: 'username and password are required.'});
            return;
        }

        try {
            const users = await listAuthUsers();
            let user = findUserByLookupKey(users, lookupKey);
            if (!user) {
                res.status(401).json({error: 'Invalid credentials.'});
                return;
            }

            user = await refreshNormalizedUsernameIfMissing(user, lookupKey, req.serviceName);

            if (!verifyPassword(password, user?.passwordHash)) {
                res.status(401).json({error: 'Invalid credentials.'});
                return;
            }

            res.json({
                authenticated: true,
                user: sanitizeUser(user),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to authenticate user.'});
        }
    });

    app.get('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'find',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            const message = String(result.error || '');
            if (message.toLowerCase().includes('no document found')) {
                res.status(404).json({error: 'Secret not found.'});
                return;
            }

            res.status(500).json({error: message || 'Unable to read secret.'});
            return;
        }

        const doc = result?.data;
        if (!doc || typeof doc !== 'object' || !Object.prototype.hasOwnProperty.call(doc, 'secret')) {
            res.status(404).json({error: 'Secret not found.'});
            return;
        }

        res.json(doc.secret ?? null);
    });

    app.put('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'secret')) {
            res.status(400).json({error: 'secret is required.'});
            return;
        }

        const now = new Date().toISOString();
        const secret = req.body.secret;
        const handler = await resolvePacketHandler();

        const packet = {
            storageType: 'mongo',
            operation: 'update',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
                update: {
                    $set: {
                        path: rawPath,
                        secret,
                        updatedAt: now,
                        updatedBy: req.serviceName,
                    },
                    $setOnInsert: {
                        createdAt: now,
                        createdBy: req.serviceName,
                    },
                },
                upsert: true,
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to write secret.')});
            return;
        }

        res.json({ok: true});
    });

    app.delete('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'delete',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to delete secret.')});
            return;
        }

        res.json({deleted: Number(result?.deleted) > 0});
    });

    const port = env.PORT || 3005;

    return {
        app,
        port,
        requireAuth,
        tokensByService,
        serviceByToken,
        logger,
    };
}

export default createVaultApp;
