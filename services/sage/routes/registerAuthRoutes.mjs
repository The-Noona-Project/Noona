// services/sage/routes/registerAuthRoutes.mjs

export function registerAuthRoutes(context = {}) {
    const {
        app,
        applyProtectedBootstrapUserFlag,
        authenticateAuthUser,
        authenticatePendingAdmin,
        buildDiscordLookupKey,
        buildOauthRedirectTarget,
        consumeOauthState,
        createAuthUser,
        createSessionToken,
        defaultPermissionsForRole,
        deleteAuthUser,
        DISCORD_AUTH_PROVIDER,
        DISCORD_CALLBACK_PATH,
        dropSession,
        exchangeDiscordAuthorizationCode,
        fetchDiscordIdentity,
        finalizePendingAdminToVault,
        findUserByDiscordId,
        findUserByLookupKey,
        generateTemporaryPassword,
        hasMoonPermission,
        hasVaultUserApi,
        inferRoleFromPermissions,
        isValidPassword,
        isValidUsername,
        listAuthUsers,
        LOCAL_AUTH_PROVIDER,
        logger,
        markDiscordAuthConfigTested,
        MOON_OP_PERMISSION_KEYS,
        normalizeRole,
        normalizeString,
        normalizeUserLookupKey,
        normalizeUsername,
        normalizeUsernameKey,
        pendingAdminPublicUser,
        pendingAdminState,
        publicUser,
        readDefaultMemberPermissions,
        readDiscordAuthConfig,
        requireAdminSession,
        requirePermissionSession,
        requireSession,
        resolveProtectedBootstrapLookupKey,
        resolveStoredAuthProvider,
        resolveSetupCompleted,
        saveDiscordAuthConfig,
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
        writeDefaultMemberPermissions,
        writeDiscordAdminToVault,
        writeOauthState,
        writeSession,
    } = context
    const normalizeDiscordUserId = (value) => {
        const normalized = normalizeString(value)
        return /^\d{5,32}$/.test(normalized) ? normalized : ''
    }
    const normalizeOauthMode = (value) => {
        const normalized = normalizeString(value).toLowerCase()
        if (normalized === 'test' || normalized === 'login' || normalized === 'bootstrap') {
            return normalized
        }
        return ''
    }
    const buildDiscordAuthorizeUrl = ({clientId, redirectUri, state}) => {
        const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: 'identify email',
            state,
            prompt: 'consent',
        })
        return `https://discord.com/oauth2/authorize?${params.toString()}`
    }
    const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(normalizeString(value))
    const buildDiscordLoginError = (authResult) => {
        if (normalizeString(authResult?.error)) {
            return normalizeString(authResult.error)
        }
        if (normalizeString(authResult?.provider) === DISCORD_AUTH_PROVIDER) {
            return 'This account uses Discord login.'
        }
        return 'Invalid credentials.'
    }

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

            if (!hasVaultUserApi()) {
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

    app.get('/api/auth/discord/config', async (_req, res) => {
        try {
            const config = await readDiscordAuthConfig()
            res.json({
                configured: config.configured === true,
                clientId: config.clientId,
                callbackPath: config.callbackPath || DISCORD_CALLBACK_PATH,
                updatedAt: config.updatedAt || null,
                lastTestedAt: config.lastTestedAt || null,
                lastTestedUser: config.lastTestedUser || null,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load Discord auth config: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load Discord auth config.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/discord/config', async (req, res) => {
        try {
            const setupCompleted = await resolveSetupCompleted()
            if (setupCompleted) {
                const session = await requireAdminSession(req, res)
                if (!session) return
            }

            const clientId = normalizeString(req.body?.clientId)
            const clientSecret = normalizeString(req.body?.clientSecret)
            if (!clientId || !clientSecret) {
                res.status(400).json({error: 'clientId and clientSecret are required.'})
                return
            }

            const config = await saveDiscordAuthConfig({clientId, clientSecret})
            res.json({
                ok: true,
                configured: true,
                clientId: config.clientId,
                callbackPath: config.callbackPath || DISCORD_CALLBACK_PATH,
                updatedAt: config.updatedAt || null,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to save Discord auth config: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to save Discord auth config.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/discord/start', async (req, res) => {
        try {
            const mode = normalizeOauthMode(req.body?.mode)
            if (!mode) {
                res.status(400).json({error: 'mode must be one of: test, login, bootstrap.'})
                return
            }

            const redirectUri = normalizeString(req.body?.redirectUri)
            if (!isAbsoluteHttpUrl(redirectUri)) {
                res.status(400).json({error: 'redirectUri must be an absolute http(s) URL.'})
                return
            }
            const redirectOrigin = new URL(redirectUri).origin

            const returnTo = buildOauthRedirectTarget(
                req.body?.returnTo,
                mode === 'login' ? '/' : '/setupwizard/summary',
                redirectOrigin,
            )
            const config = await readDiscordAuthConfig()
            if (!config.configured || !config.clientId) {
                res.status(400).json({error: 'Discord OAuth is not configured yet.'})
                return
            }

            const setupCompleted = await resolveSetupCompleted()
            if (mode === 'bootstrap' && setupCompleted) {
                res.status(409).json({error: 'Setup is already complete. Use Discord login instead.'})
                return
            }

            const state = createSessionToken()
            await writeOauthState(state, {
                mode,
                redirectUri,
                returnTo,
                startedAt: new Date().toISOString(),
            })

            res.json({
                ok: true,
                mode,
                state,
                callbackPath: config.callbackPath || DISCORD_CALLBACK_PATH,
                authorizeUrl: buildDiscordAuthorizeUrl({
                    clientId: config.clientId,
                    redirectUri,
                    state,
                }),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to start Discord OAuth flow: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to start Discord OAuth flow.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/discord/callback', async (req, res) => {
        try {
            const code = normalizeString(req.body?.code)
            const state = normalizeString(req.body?.state)
            if (!code || !state) {
                res.status(400).json({error: 'code and state are required.'})
                return
            }

            const oauthState = await consumeOauthState(state)
            if (!oauthState || typeof oauthState !== 'object') {
                res.status(400).json({error: 'OAuth state is missing or expired. Start the Discord flow again.'})
                return
            }

            const mode = normalizeOauthMode(oauthState.mode)
            const redirectUri = normalizeString(oauthState.redirectUri)
            if (!mode || !isAbsoluteHttpUrl(redirectUri)) {
                res.status(400).json({error: 'OAuth state is invalid. Start the Discord flow again.'})
                return
            }
            const redirectOrigin = new URL(redirectUri).origin
            const returnTo = buildOauthRedirectTarget(
                oauthState.returnTo,
                mode === 'login' ? '/' : '/setupwizard/summary',
                redirectOrigin,
            )

            const oauthPayload = await exchangeDiscordAuthorizationCode({code, redirectUri})
            const accessToken = normalizeString(oauthPayload?.access_token)
            if (!accessToken) {
                res.status(502).json({error: 'Discord did not return an access token.'})
                return
            }

            const identity = await fetchDiscordIdentity(accessToken)

            if (mode === 'test') {
                const tested = await markDiscordAuthConfigTested(identity)
                res.json({
                    ok: true,
                    mode,
                    stage: 'tested',
                    returnTo,
                    user: identity,
                    lastTestedAt: tested?.lastTestedAt || null,
                })
                return
            }

            if (mode === 'bootstrap') {
                const setupCompleted = await resolveSetupCompleted()
                if (setupCompleted) {
                    res.status(409).json({error: 'Setup is already complete. Use Discord login instead.'})
                    return
                }

                const persisted = await writeDiscordAdminToVault(identity)
                const token = createSessionToken()
                const sessionUser = toSessionUser(persisted.user, persisted.user?.username)
                await writeSession(token, sessionUser, sessionTtlSeconds)

                res.json({
                    ok: true,
                    mode,
                    stage: 'bootstrapped',
                    returnTo,
                    created: persisted.created === true,
                    token,
                    user: sessionUser,
                })
                return
            }

            const users = await listAuthUsers()
            let matchedUser = findUserByDiscordId(users, identity.id)
            if (!matchedUser) {
                const defaults = await readDefaultMemberPermissions()
                const createdRole = inferRoleFromPermissions(defaults.permissions, 'member')
                const created = await createAuthUser({
                    username: identity.globalName || identity.username || `Discord ${identity.id}`,
                    role: createdRole,
                    permissions: defaults.permissions,
                    authProvider: DISCORD_AUTH_PROVIDER,
                    discordUserId: identity.id,
                    discordUsername: identity.username || null,
                    discordGlobalName: identity.globalName || null,
                    avatarUrl: identity.avatarUrl || null,
                    email: identity.email || null,
                })
                matchedUser = created?.user || null
            }

            if (!matchedUser) {
                res.status(502).json({error: 'Unable to create or load the Discord-linked Noona account.'})
                return
            }

            const lookupKey = normalizeUserLookupKey(matchedUser)
            let refreshedUser = matchedUser
            if (lookupKey) {
                const payload = await updateAuthUser(lookupKey, {
                    username: matchedUser.username,
                    authProvider: DISCORD_AUTH_PROVIDER,
                    discordUserId: identity.id,
                    discordUsername: identity.username || null,
                    discordGlobalName: identity.globalName || null,
                    avatarUrl: identity.avatarUrl || null,
                    email: identity.email || null,
                })
                refreshedUser = payload?.user || matchedUser
            }

            const sessionUser = toSessionUser(refreshedUser, refreshedUser?.username)
            if (!hasMoonPermission(sessionUser, 'moon_login')) {
                res.status(403).json({error: 'Moon login permission is required for this account.'})
                return
            }

            const token = createSessionToken()
            await writeSession(token, sessionUser, sessionTtlSeconds)
            res.json({
                ok: true,
                mode,
                stage: 'authenticated',
                returnTo,
                token,
                user: sessionUser,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to complete Discord OAuth flow: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to complete Discord OAuth flow.')
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

            if (!authResult?.authenticated && hasVaultUserApi()) {
                authResult = await authenticateAuthUser({username, password})
            }

            if (!authResult?.authenticated && !hasVaultUserApi() && !pendingAdminState.value) {
                res.status(503).json({error: 'Vault storage is not configured.'})
                return
            }

            if (!authResult?.authenticated || !authResult.user) {
                res.status(401).json({error: buildDiscordLoginError(authResult)})
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

    app.get('/api/auth/users/default-permissions', async (req, res) => {
        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        try {
            const defaults = await readDefaultMemberPermissions()
            res.json({
                key: defaults.key,
                defaultPermissions: defaults.permissions,
                permissions: [...MOON_OP_PERMISSION_KEYS],
                updatedAt: defaults.updatedAt || null,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load default user permissions: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load default user permissions.')
            res.status(status).json({error: message})
        }
    })

    app.put('/api/auth/users/default-permissions', async (req, res) => {
        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const parsedPermissions = validatePermissionListInput(req.body?.permissions)
        if (!parsedPermissions.ok) {
            res.status(400).json({error: parsedPermissions.error})
            return
        }

        try {
            const defaults = await writeDefaultMemberPermissions(parsedPermissions.permissions)
            res.json({
                ok: true,
                key: defaults.key,
                defaultPermissions: defaults.permissions,
                permissions: [...MOON_OP_PERMISSION_KEYS],
                updatedAt: defaults.updatedAt || null,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to update default user permissions: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to update default user permissions.')
            res.status(status).json({error: message})
        }
    })

    app.get('/api/auth/users', async (req, res) => {
        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        try {
            const users = await listAuthUsers()
            const defaults = await readDefaultMemberPermissions()
            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            const mappedUsers = users
                .map((entry) => applyProtectedBootstrapUserFlag(publicUser(entry), protectedLookupKey))
                .filter((entry) => Boolean(entry.usernameNormalized))
            res.json({
                users: mappedUsers,
                permissions: [...MOON_OP_PERMISSION_KEYS],
                defaultPermissions: defaults.permissions,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to list auth users: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to list users.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/users', async (req, res) => {
        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const discordUserId = normalizeDiscordUserId(req.body?.discordUserId)
        const isDiscordUser = Boolean(discordUserId)
        const username = isDiscordUser ? normalizeString(req.body?.username) : normalizeUsername(req.body?.username)
        const password = typeof req.body?.password === 'string' ? req.body.password : ''
        const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        let role = hasRoleInput ? normalizeRole(req.body?.role, 'member') : 'member'
        const hasPermissionsInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions')
        let permissions = hasPermissionsInput ? [] : null

        if (hasPermissionsInput) {
            const parsedPermissions = validatePermissionListInput(req.body?.permissions)
            if (!parsedPermissions.ok) {
                res.status(400).json({error: parsedPermissions.error})
                return
            }
            permissions = parsedPermissions.permissions
        }

        if (isDiscordUser) {
            if (!discordUserId) {
                res.status(400).json({error: 'discordUserId is required for Discord-auth users.'})
                return
            }
        } else {
            if (!isValidUsername(username)) {
                res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                return
            }

            if (!isValidPassword(password)) {
                res.status(400).json({error: 'password must be at least 8 characters.'})
                return
            }
        }

        try {
            if (!Array.isArray(permissions)) {
                permissions =
                    role === 'admin'
                        ? defaultPermissionsForRole(role)
                        : (await readDefaultMemberPermissions()).permissions
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

            const payload = await createAuthUser({
                username: username || `Discord ${discordUserId}`,
                ...(isDiscordUser ? {} : {password}),
                role,
                permissions,
                isBootstrapUser: false,
                authProvider: isDiscordUser ? DISCORD_AUTH_PROVIDER : LOCAL_AUTH_PROVIDER,
                discordUserId: isDiscordUser ? discordUserId : null,
            })
            res.status(201).json({
                ok: true,
                user: publicUser(payload?.user, username || buildDiscordLookupKey(discordUserId))
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to create auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to create user.')
            res.status(status).json({error: message})
        }
    })

    app.put('/api/auth/users/:username', async (req, res) => {
        if (!hasVaultUserApi()) {
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

            const targetIsDiscord = resolveStoredAuthProvider(targetUser, LOCAL_AUTH_PROVIDER) === DISCORD_AUTH_PROVIDER
            const updates = {}
            if (hasUsernameUpdate) {
                const nextUsername = targetIsDiscord ? normalizeString(req.body?.username) : normalizeUsername(req.body?.username)
                if (!nextUsername) {
                    res.status(400).json({error: 'username is required.'})
                    return
                }
                if (!targetIsDiscord && !isValidUsername(nextUsername)) {
                    res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                    return
                }
                updates.username = nextUsername
            }

            if (hasPasswordUpdate) {
                if (targetIsDiscord) {
                    res.status(400).json({error: 'Discord-auth users do not use password resets.'})
                    return
                }
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
                updates.permissions =
                    updates.role === 'admin'
                        ? defaultPermissionsForRole(updates.role)
                        : (await readDefaultMemberPermissions()).permissions
            }

            if (updates.role === 'admin' && Array.isArray(updates.permissions) && !updates.permissions.includes('admin')) {
                updates.permissions = sortMoonPermissions([...updates.permissions, 'admin'])
            }
            if (updates.role !== 'admin' && Array.isArray(updates.permissions)) {
                updates.permissions = sortMoonPermissions(updates.permissions.filter((entry) => entry !== 'admin'))
            }

            const payload = await updateAuthUser(lookupUsername, updates)
            const updated = publicUser(payload?.user, updates.username || lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUserLookupKey(session)) {
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
        if (!hasVaultUserApi()) {
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

            if (resolveStoredAuthProvider(targetUser, LOCAL_AUTH_PROVIDER) === DISCORD_AUTH_PROVIDER) {
                res.status(400).json({error: 'Discord-auth users do not use password resets.'})
                return
            }

            const password = generateTemporaryPassword()
            const payload = await updateAuthUser(lookupUsername, {password})
            const updated = publicUser(payload?.user, lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUserLookupKey(session)) {
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
        if (!hasVaultUserApi()) {
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

            if (lookupKey === normalizeUserLookupKey(session)) {
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
