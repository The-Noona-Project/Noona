// services/sage/routes/registerAuthRoutes.mjs

export function registerAuthRoutes(context = {}) {
    const {
        app,
        applyProtectedBootstrapUserFlag,
        authenticateAuthUser,
        authenticatePendingAdmin,
        createAuthUser,
        createSessionToken,
        defaultPermissionsForRole,
        deleteAuthUser,
        dropSession,
        finalizePendingAdminToVault,
        findUserByLookupKey,
        generateTemporaryPassword,
        hasMoonPermission,
        hasVaultUserApi,
        inferRoleFromPermissions,
        isValidPassword,
        isValidUsername,
        listAuthUsers,
        logger,
        MOON_OP_PERMISSION_KEYS,
        normalizeRole,
        normalizeUserLookupKey,
        normalizeUsername,
        normalizeUsernameKey,
        pendingAdminPublicUser,
        pendingAdminState,
        publicUser,
        requireAdminSession,
        requirePermissionSession,
        requireSession,
        resolveProtectedBootstrapLookupKey,
        resolveSetupCompleted,
        selectPrimaryAdmin,
        serviceName,
        sessionTtlSeconds,
        setPendingAdminCredentials,
        sortMoonPermissions,
        toSessionUser,
        updateAuthUser,
        validatePermissionListInput,
        vaultClient,
        vaultErrorMessage,
        vaultErrorStatus,
        writeSession,
    } = context

    app.post('/api/auth/bootstrap', async (req, res) => {
        try {
            const setupCompleted = await resolveSetupCompleted()
            if (setupCompleted) {
                res.status(409).json({error: 'Setup already completed.'})
                return
            }

            const username = normalizeUsername(req.body?.username)
            const password = typeof req.body?.password === 'string' ? req.body.password : ''

            if (!username || !isValidUsername(username)) {
                res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                return
            }

            if (!isValidPassword(password)) {
                res.status(400).json({error: 'password must be at least 8 characters.'})
                return
            }

            const created = pendingAdminState.value == null
            setPendingAdminCredentials({username, password})

            res.json({
                ok: true,
                created,
                persisted: false,
                username,
                role: 'admin',
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to bootstrap admin user: ${error.message}`)
            const message = error instanceof Error && error.message.trim()
                ? error.message.trim()
                : 'Unable to bootstrap admin user.'
            const status = 502
            res.status(status).json({error: message})
        }
    })

    app.get('/api/auth/bootstrap/status', async (_req, res) => {
        try {
            const setupCompleted = await resolveSetupCompleted()
            const pendingUser = pendingAdminPublicUser()
            if (pendingUser) {
                res.json({
                    setupCompleted: setupCompleted === true,
                    adminExists: true,
                    username: pendingUser.username,
                    persisted: false,
                })
                return
            }

            if (!vaultClient?.users) {
                res.json({
                    setupCompleted: setupCompleted === true,
                    adminExists: false,
                    username: null,
                    persisted: false,
                })
                return
            }

            const users = await listAuthUsers()
            const existingAdmin = selectPrimaryAdmin(users)
            const username = normalizeUsername(existingAdmin?.username) || null

            res.json({
                setupCompleted: setupCompleted === true,
                adminExists: Boolean(existingAdmin),
                username,
                persisted: Boolean(existingAdmin),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load bootstrap status: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load bootstrap status.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/bootstrap/finalize', async (req, res) => {
        const session = await requireAdminSession(req, res)
        if (!session) return

        if (!pendingAdminState.value) {
            res.json({
                ok: true,
                persisted: false,
                username: normalizeUsername(session?.username) || null,
            })
            return
        }

        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        try {
            const persisted = await finalizePendingAdminToVault()
            if (req.sessionToken && session && typeof session === 'object') {
                await writeSession(req.sessionToken, session, sessionTtlSeconds)
            }

            res.json({
                ok: true,
                persisted: persisted.persisted === true,
                created: persisted.created === true,
                username: normalizeUsername(persisted.user?.username) || null,
                role: normalizeRole(persisted.user?.role, 'admin'),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to finalize bootstrap admin user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to finalize admin user.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/login', async (req, res) => {
        try {
            const username = normalizeUsername(req.body?.username)
            const password = typeof req.body?.password === 'string' ? req.body.password : ''

            if (!username || !password) {
                res.status(400).json({error: 'username and password are required.'})
                return
            }

            let authResult = authenticatePendingAdmin({username, password})

            if (!authResult?.authenticated && vaultClient?.users?.authenticate) {
                authResult = await authenticateAuthUser({username, password})
            }

            if (!authResult?.authenticated && !vaultClient?.users?.authenticate && !pendingAdminState.value) {
                res.status(503).json({error: 'Vault storage is not configured.'})
                return
            }

            if (!authResult?.authenticated || !authResult.user) {
                res.status(401).json({error: 'Invalid credentials.'})
                return
            }

            const token = createSessionToken()
            const session = toSessionUser(authResult.user, username)
            if (!hasMoonPermission(session, 'moon_login')) {
                res.status(403).json({error: 'Moon login permission is required for this account.'})
                return
            }
            await writeSession(token, session, sessionTtlSeconds)
            res.json({
                token,
                user: {
                    username: session.username,
                    role: session.role,
                    permissions: session.permissions,
                    isBootstrapUser: session.isBootstrapUser === true,
                },
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to login: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to login.')
            res.status(status).json({error: message})
        }
    })

    app.get('/api/auth/status', async (req, res) => {
        try {
            const session = await requireSession(req, res)
            if (!session) return
            res.json({user: session})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load auth status: ${error.message}`)
            res.status(502).json({error: 'Unable to validate session.'})
        }
    })

    app.post('/api/auth/logout', async (req, res) => {
        try {
            const session = await requireSession(req, res)
            if (!session) return

            await dropSession(req.sessionToken)
            res.json({ok: true})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to logout: ${error.message}`)
            res.status(502).json({error: 'Unable to logout.'})
        }
    })

    app.get('/api/auth/users', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        try {
            const users = await listAuthUsers()
            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            const mappedUsers = users
                .map((entry) => applyProtectedBootstrapUserFlag(publicUser(entry), protectedLookupKey))
                .filter((entry) => Boolean(entry.usernameNormalized))
            res.json({
                users: mappedUsers,
                permissions: [...MOON_OP_PERMISSION_KEYS],
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to list auth users: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to list users.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/users', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const username = normalizeUsername(req.body?.username)
        const password = typeof req.body?.password === 'string' ? req.body.password : ''
        const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        let role = hasRoleInput ? normalizeRole(req.body?.role, 'member') : 'member'
        const hasPermissionsInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions')
        let permissions = hasPermissionsInput ? [] : defaultPermissionsForRole(role)

        if (hasPermissionsInput) {
            const parsedPermissions = validatePermissionListInput(req.body?.permissions)
            if (!parsedPermissions.ok) {
                res.status(400).json({error: parsedPermissions.error})
                return
            }
            permissions = parsedPermissions.permissions
        }

        if (role === 'admin' && !permissions.includes('admin')) {
            permissions = sortMoonPermissions([...permissions, 'admin'])
        }
        if (role !== 'admin' && permissions.includes('admin')) {
            role = 'admin'
        }
        if (role !== 'admin') {
            permissions = sortMoonPermissions(permissions.filter((entry) => entry !== 'admin'))
        }

        if (!isValidUsername(username)) {
            res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
            return
        }

        if (!isValidPassword(password)) {
            res.status(400).json({error: 'password must be at least 8 characters.'})
            return
        }

        try {
            const payload = await createAuthUser({
                username,
                password,
                role,
                permissions,
                isBootstrapUser: false,
            })
            res.status(201).json({ok: true, user: publicUser(payload?.user, username)})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to create auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to create user.')
            res.status(status).json({error: message})
        }
    })

    app.put('/api/auth/users/:username', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupUsername) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        const hasUsernameUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'username')
        const hasPasswordUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'password')
        const hasRoleUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        const hasPermissionsUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions')

        if (!hasUsernameUpdate && !hasPasswordUpdate && !hasRoleUpdate && !hasPermissionsUpdate) {
            res.status(400).json({error: 'At least one user field must be updated.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be modified.'})
                return
            }

            const updates = {}
            if (hasUsernameUpdate) {
                const nextUsername = normalizeUsername(req.body?.username)
                if (!isValidUsername(nextUsername)) {
                    res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                    return
                }
                updates.username = nextUsername
            }

            if (hasPasswordUpdate) {
                const nextPassword = typeof req.body?.password === 'string' ? req.body.password : ''
                if (!isValidPassword(nextPassword)) {
                    res.status(400).json({error: 'password must be at least 8 characters.'})
                    return
                }
                updates.password = nextPassword
            }

            if (hasPermissionsUpdate) {
                const parsedPermissions = validatePermissionListInput(req.body?.permissions)
                if (!parsedPermissions.ok) {
                    res.status(400).json({error: parsedPermissions.error})
                    return
                }
                updates.permissions = parsedPermissions.permissions
                updates.role = inferRoleFromPermissions(parsedPermissions.permissions, normalizeRole(targetUser?.role, 'member'))
            } else if (hasRoleUpdate) {
                updates.role = normalizeRole(req.body?.role, normalizeRole(targetUser?.role, 'member'))
                updates.permissions = defaultPermissionsForRole(updates.role)
            }

            if (updates.role === 'admin' && Array.isArray(updates.permissions) && !updates.permissions.includes('admin')) {
                updates.permissions = sortMoonPermissions([...updates.permissions, 'admin'])
            }
            if (updates.role !== 'admin' && Array.isArray(updates.permissions)) {
                updates.permissions = sortMoonPermissions(updates.permissions.filter((entry) => entry !== 'admin'))
            }

            const payload = await updateAuthUser(lookupUsername, updates)
            const updated = publicUser(payload?.user, updates.username || lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUsernameKey(session?.usernameNormalized || session?.username)) {
                await writeSession(req.sessionToken, toSessionUser(updated, updated.username), sessionTtlSeconds)
            }

            res.json({ok: true, user: updated})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to update auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to update user.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/users/:username/reset-password', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be modified.'})
                return
            }

            const password = generateTemporaryPassword()
            const payload = await updateAuthUser(lookupUsername, {password})
            const updated = publicUser(payload?.user, lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUsernameKey(session?.usernameNormalized || session?.username)) {
                await writeSession(req.sessionToken, toSessionUser(updated, updated.username), sessionTtlSeconds)
            }

            res.json({ok: true, user: updated, password})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to reset auth user password: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to reset user password.')
            res.status(status).json({error: message})
        }
    })

    app.delete('/api/auth/users/:username', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be deleted.'})
                return
            }

            if (lookupKey === normalizeUsernameKey(session.usernameNormalized || session.username)) {
                res.status(400).json({error: 'Cannot delete the active session user.'})
                return
            }

            const payload = await deleteAuthUser(lookupUsername)
            if (payload?.deleted !== true) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            res.json({deleted: true})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to delete auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to delete user.')
            res.status(status).json({error: message})
        }
    })
}

export default registerAuthRoutes
