// services/vault/routes/registerUserRoutes.mjs

import {createUserStore} from '../users/createUserStore.mjs';
import {
    defaultPermissionsForRole,
    hashPassword,
    isValidPassword,
    isValidUsername,
    normalizePermissionList,
    normalizeRole,
    normalizeString,
    normalizeUsername,
    normalizeUsernameKey,
    parseBooleanInput,
    sanitizeUser,
    sortMoonPermissions,
    sortUsersByRecency,
    validatePermissionListInput,
    verifyPassword,
} from '../users/userAuth.mjs';

export function registerUserRoutes(context = {}) {
    const {
        app,
        authorizer,
        requireAuth,
        resolvePacketHandler,
        usersCollection,
    } = context;

    const {
        buildUserLookupQuery,
        findUserByLookupKey,
        listAuthUsers,
        normalizedLookupKey,
        refreshNormalizedUsernameIfMissing,
    } = createUserStore({resolvePacketHandler, usersCollection});

    const ensureUserAccess = (req, res) => {
        const access = authorizer?.canAccessUsers?.(req.serviceName) ?? {ok: true};
        if (access.ok === true) {
            return true;
        }

        res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
        return false;
    };

    app.get('/api/users', requireAuth, async (req, res) => {
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
                    collection: usersCollection,
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
                new Error(String(result.error || 'Unable to create user.'));
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
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
                if (!entryLookup) {
                    return false;
                }
                if (entryLookup !== nextLookupKey) {
                    return false;
                }
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
                    collection: usersCollection,
                    query,
                    update: {$set: updateSet},
                },
            });

            if (result?.error) {
                new Error(String(result.error || 'Unable to update user.'));
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
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
                    collection: usersCollection,
                    query,
                },
            });

            if (result?.error) {
                new Error(String(result.error || 'Unable to delete user.'));
            }

            res.json({deleted: Number(result?.deleted) > 0});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: message || 'Unable to delete user.'});
        }
    });

    app.post('/api/users/authenticate', requireAuth, async (req, res) => {
        if (!ensureUserAccess(req, res)) {
            return;
        }

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
}

export default registerUserRoutes;
