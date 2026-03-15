import crypto from 'node:crypto'

import {SetupValidationError} from '../lib/errors.mjs'

export const DEFAULT_MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000'
export const DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME = 'Noona Managed Services'
export const DEFAULT_MANAGED_KAVITA_SYSTEM_AUTH_KEY_NAME = 'opds'
export const DEFAULT_MANAGED_KAVITA_PLUGIN_NAME = 'Noona Managed Services'
export const DEFAULT_MANAGED_KAVITA_SERVICE_ACCOUNT = Object.freeze({
    username: 'noona-system',
    email: 'noona-system@noona.local',
})

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    return value.trim()
}

const parseResponseBody = async (response) => {
    if (response.status === 204) {
        return null
    }

    const text = await response.text()
    if (!text) {
        return null
    }

    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

const buildHttpError = (message, status, details = null) => {
    const error = new Error(message)
    error.status = status
    error.details = details
    return error
}

const createManagedServicePassword = (randomBytes = crypto.randomBytes) =>
    randomBytes(24).toString('base64url')

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))
const isRetryableServerStatus = (status) => Number.isInteger(status) && status >= 500 && status < 600
const isRetryableRegisterStatus = (status) => status === 400 || status === 409 || isRetryableServerStatus(status)
const isRetryableLoginStatus = (status) => status === 400 || status === 401 || isRetryableServerStatus(status)

const normalizeAuthKeys = (authKeys) => {
    if (!Array.isArray(authKeys)) {
        return []
    }

    return authKeys
        .map((entry) => {
            const key = normalizeString(entry?.key)
            if (!key) {
                return null
            }

            return {
                ...entry,
                key,
                name: normalizeString(entry?.name),
            }
        })
        .filter(Boolean)
}

const selectReusableAuthKey = (
    authKeys,
    preferredName = DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME,
) => {
    return prioritizeReusableAuthKeys(authKeys, preferredName)[0] || null
}

const prioritizeReusableAuthKeys = (
    authKeys,
    preferredName = DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME,
) => {
    const normalized = normalizeAuthKeys(authKeys)
    if (normalized.length === 0) {
        return []
    }

    const preferred = normalizeString(preferredName).toLowerCase()
    return [...normalized].sort((left, right) => {
        const score = (entry) => {
            const name = entry.name.toLowerCase()
            if (preferred && name === preferred) {
                return 0
            }

            if (name === DEFAULT_MANAGED_KAVITA_SYSTEM_AUTH_KEY_NAME) {
                return 1
            }

            if (name !== 'image-only') {
                return 2
            }

            return 3
        }

        return score(left) - score(right)
    })
}

const extractApiKeyFromUserPayload = (
    payload,
    preferredName = DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME,
) => {
    const direct = normalizeString(payload?.apiKey)
    if (direct) {
        return direct
    }

    return normalizeString(selectReusableAuthKey(payload?.authKeys, preferredName)?.key) || null
}

export const createManagedKavitaServiceAccount = (options = {}) => ({
    username: DEFAULT_MANAGED_KAVITA_SERVICE_ACCOUNT.username,
    email: DEFAULT_MANAGED_KAVITA_SERVICE_ACCOUNT.email,
    password: createManagedServicePassword(options.randomBytes),
})

const normalizeManagedAccount = (account) => {
    if (!account || typeof account !== 'object') {
        return null
    }

    const username = normalizeString(account.username)
    const password = normalizeString(account.password)
    if (!username || !password) {
        return null
    }

    const email = normalizeString(account.email) || null
    return {username, password, email}
}

const normalizeApiKeyCandidate = (candidate) => {
    if (typeof candidate === 'string') {
        const key = normalizeString(candidate)
        return key ? {key, name: '', source: 'candidate', pluginName: null} : null
    }

    if (!candidate || typeof candidate !== 'object') {
        return null
    }

    const key = normalizeString(candidate.apiKey ?? candidate.key)
    if (!key) {
        return null
    }

    return {
        key,
        name: normalizeString(candidate.name),
        source: normalizeString(candidate.source) || 'candidate',
        pluginName: normalizeString(candidate.pluginName) || null,
    }
}

const dedupeApiKeyCandidates = (candidates = []) => {
    const deduped = []
    const seen = new Set()

    for (const candidate of candidates) {
        const normalized = normalizeApiKeyCandidate(candidate)
        if (!normalized || seen.has(normalized.key)) {
            continue
        }

        seen.add(normalized.key)
        deduped.push(normalized)
    }

    return deduped
}

export const createManagedKavitaSetupClient = ({
                                                   baseUrl = DEFAULT_MANAGED_KAVITA_BASE_URL,
                                                   fetchImpl = fetch,
                                                   logger,
                                                   randomBytes = crypto.randomBytes,
                                                   serviceName = 'noona-sage',
                                               } = {}) => {
    const normalizedBaseUrl = new URL(baseUrl).toString()

    const request = async (path, {
        method = 'GET',
        body,
        bearerToken = null,
    } = {}) => {
        const headers = {
            Accept: 'application/json',
        }

        if (body != null) {
            headers['Content-Type'] = 'application/json'
        }

        const normalizedToken = normalizeString(bearerToken)
        if (normalizedToken) {
            headers.Authorization = `Bearer ${normalizedToken}`
        }

        const response = await fetchImpl(new URL(path, normalizedBaseUrl).toString(), {
            method,
            headers,
            body: body == null ? undefined : JSON.stringify(body),
        })

        const payload = await parseResponseBody(response)
        if (!response.ok) {
            const message =
                normalizeString(payload?.error) ||
                normalizeString(payload?.message) ||
                `Kavita request failed with status ${response.status}.`
            throw buildHttpError(message, response.status, payload)
        }

        return payload
    }

    const registerFirstAdmin = async (account) => {
        const normalized = normalizeManagedAccount(account)
        if (!normalized?.email) {
            throw new SetupValidationError('Managed Kavita registration requires a username, password, and email.')
        }

        return request('/api/Account/register', {
            method: 'POST',
            body: {
                username: normalized.username,
                email: normalized.email,
                password: normalized.password,
            },
        })
    }

    const validateApiKey = async ({
                                      apiKey,
                                      pluginName = DEFAULT_MANAGED_KAVITA_PLUGIN_NAME,
                                  } = {}) => {
        const normalizedApiKey = normalizeString(apiKey)
        if (!normalizedApiKey) {
            throw new SetupValidationError('Kavita API key validation requires a non-empty key.')
        }

        const normalizedPluginName = normalizeString(pluginName) || DEFAULT_MANAGED_KAVITA_PLUGIN_NAME

        try {
            return await request(
                `/api/plugin/authenticate?apiKey=${encodeURIComponent(normalizedApiKey)}&pluginName=${encodeURIComponent(normalizedPluginName)}`,
                {method: 'POST'},
            )
        } catch (error) {
            if (Number(error?.status) === 401) {
                return null
            }

            throw error
        }
    }

    const login = async (account) => {
        const normalized = normalizeManagedAccount(account)
        if (!normalized) {
            throw new SetupValidationError('Managed Kavita login requires a username and password.')
        }

        return request('/api/Account/login', {
            method: 'POST',
            body: {
                username: normalized.username,
                password: normalized.password,
            },
        })
    }

    const loginWithRetry = async (
        account,
        {
            attempts = 1,
            delayMs = 0,
        } = {},
    ) => {
        let lastError = null

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await login(account)
            } catch (error) {
                lastError = error

                if (attempt >= attempts) {
                    throw error
                }

                if (delayMs > 0) {
                    await sleep(delayMs)
                }
            }
        }

        throw lastError ?? new Error('Managed Kavita login retry failed.')
    }

    const acquireFirstAdminSession = async (
        account,
        {
            attempts = 20,
            delayMs = 1500,
        } = {},
    ) => {
        let lastError = null

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const user = await login(account)
                return {user, mode: 'login'}
            } catch (loginError) {
                lastError = loginError
                const loginStatus = Number(loginError?.status)
                if (!isRetryableLoginStatus(loginStatus)) {
                    throw loginError
                }
            }

            try {
                const user = await registerFirstAdmin(account)
                return {user, mode: 'register'}
            } catch (registerError) {
                lastError = registerError
                const registerStatus = Number(registerError?.status)
                if (!isRetryableRegisterStatus(registerStatus)) {
                    throw registerError
                }

                logger?.warn?.(
                    `[${serviceName}] Managed Kavita first-user registration is still settling for ${account.username}; retrying login/register (${attempt}/${attempts}).`,
                )
            }

            if (attempt < attempts && delayMs > 0) {
                await sleep(delayMs)
            }
        }

        throw lastError ?? new Error('Managed Kavita first-user session acquisition failed.')
    }

    const getAuthKeys = async ({token} = {}) => {
        const normalizedToken = normalizeString(token)
        if (!normalizedToken) {
            throw new SetupValidationError('Kavita auth key lookup requires a JWT token.')
        }

        return request('/api/Account/auth-keys', {
            method: 'GET',
            bearerToken: normalizedToken,
        })
    }

    const createAuthKey = async ({
                                     token,
                                     name = DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME,
                                     keyLength = 32,
                                     expiresUtc = null,
                                 } = {}) => {
        const normalizedToken = normalizeString(token)
        if (!normalizedToken) {
            throw new SetupValidationError('Kavita auth key creation requires a JWT token.')
        }

        return request('/api/Account/create-auth-key', {
            method: 'POST',
            bearerToken: normalizedToken,
            body: {
                name,
                keyLength,
                expiresUtc,
            },
        })
    }

    const ensureServiceApiKey = async ({
                                           account = null,
                                           allowRegister = false,
                                           authKeyName = DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME,
                                           candidateApiKeys = [],
                                           keyLength = 32,
                                           pluginName = DEFAULT_MANAGED_KAVITA_PLUGIN_NAME,
                                       } = {}) => {
        const attemptedKeys = new Set()
        const tryCandidateKeys = async (candidates = []) => {
            for (const candidate of dedupeApiKeyCandidates(candidates)) {
                if (attemptedKeys.has(candidate.key)) {
                    continue
                }

                attemptedKeys.add(candidate.key)
                const normalizedPluginName = candidate.pluginName || pluginName
                const authenticatedUser = await validateApiKey({
                    apiKey: candidate.key,
                    pluginName: normalizedPluginName,
                })

                if (!authenticatedUser) {
                    logger?.warn?.(
                        `[${serviceName}] Managed Kavita rejected API key candidate from ${candidate.source || 'candidate'}; trying another key.`,
                    )
                    continue
                }

                return {
                    apiKey: candidate.key,
                    authKey: candidate.name ? {key: candidate.key, name: candidate.name} : null,
                    mode: candidate.source || 'existing',
                    user: authenticatedUser,
                }
            }

            return null
        }

        let normalizedAccount = normalizeManagedAccount(account)
        let generatedAccount = false
        const reusableCandidate = await tryCandidateKeys(candidateApiKeys)
        if (reusableCandidate) {
            return {
                apiKey: reusableCandidate.apiKey,
                account: normalizedAccount,
                authKey: reusableCandidate.authKey,
                authKeys: [],
                mode: reusableCandidate.mode,
                user: reusableCandidate.user,
            }
        }

        if (!normalizedAccount && allowRegister) {
            normalizedAccount = createManagedKavitaServiceAccount({randomBytes})
            generatedAccount = true
        }

        if (!normalizedAccount) {
            throw new SetupValidationError('Managed Kavita setup needs account credentials or registration enabled.')
        }

        let user = null
        let mode = 'login'
        let authKeys = []

        if (allowRegister && generatedAccount) {
            const acquired = await acquireFirstAdminSession(normalizedAccount)
            user = acquired.user
            mode = acquired.mode
        } else if (allowRegister) {
            try {
                user = await login(normalizedAccount)
            } catch (error) {
                try {
                    mode = 'register'
                    user = await registerFirstAdmin(normalizedAccount)
                } catch (registerError) {
                    const status = Number(registerError?.status)
                    if (!isRetryableRegisterStatus(status)) {
                        throw registerError
                    }

                    logger?.warn?.(
                        `[${serviceName}] Managed Kavita registration did not settle cleanly for ${normalizedAccount.username}; retrying first-user login/register flow.`,
                    )

                    const acquired = await acquireFirstAdminSession(normalizedAccount, {
                        attempts: 20,
                        delayMs: 1500,
                    })
                    user = acquired.user
                    mode = acquired.mode
                }
            }
        } else {
            user = await login(normalizedAccount)
        }

        let apiKey = extractApiKeyFromUserPayload(user, authKeyName)
        let authKey = null
        let token = normalizeString(user?.token) || null
        authKeys = normalizeAuthKeys(user?.authKeys)

        const directApiKeyCandidate = apiKey
            ? [{
                key: apiKey,
                source: mode === 'register' ? 'register' : 'login',
                pluginName,
            }]
            : []
        const returnedAuthKeyCandidates = prioritizeReusableAuthKeys(authKeys, authKeyName).map((entry) => ({
            ...entry,
            source: 'auth-keys',
            pluginName,
        }))
        let validated = await tryCandidateKeys([
            ...directApiKeyCandidate,
            ...returnedAuthKeyCandidates,
        ])
        if (validated) {
            return {
                apiKey: validated.apiKey,
                account: normalizedAccount,
                authKey: validated.authKey,
                authKeys,
                mode,
                user: validated.user,
            }
        }

        apiKey = null

        if (!apiKey && mode === 'register') {
            try {
                user = await login(normalizedAccount)
                token = normalizeString(user?.token) || token
                authKeys = normalizeAuthKeys(user?.authKeys)
                mode = 'login'
            } catch (error) {
                logger?.warn?.(
                    `[${serviceName}] Managed Kavita follow-up login failed after registration: ${error instanceof Error ? error.message : error}`,
                )
            }
        }

        if (!apiKey && token) {
            try {
                authKeys = normalizeAuthKeys(await getAuthKeys({token}))
                validated = await tryCandidateKeys(
                    prioritizeReusableAuthKeys(authKeys, authKeyName).map((entry) => ({
                        ...entry,
                        source: 'auth-keys',
                        pluginName,
                    })),
                )
                if (validated) {
                    return {
                        apiKey: validated.apiKey,
                        account: normalizedAccount,
                        authKey: validated.authKey,
                        authKeys,
                        mode,
                        user: validated.user,
                    }
                }
            } catch (error) {
                logger?.warn?.(
                    `[${serviceName}] Managed Kavita auth key lookup failed after login: ${error instanceof Error ? error.message : error}`,
                )
            }
        }

        if (!apiKey && token) {
            try {
                authKey = await createAuthKey({
                    token,
                    name: authKeyName,
                    keyLength,
                })
                validated = await tryCandidateKeys([{
                    ...authKey,
                    source: 'created',
                    pluginName,
                }])
                if (validated) {
                    apiKey = validated.apiKey
                }
            } catch (error) {
                logger?.warn?.(
                    `[${serviceName}] Managed Kavita auth key creation failed; rechecking existing keys: ${error instanceof Error ? error.message : error}`,
                )

                try {
                    authKeys = normalizeAuthKeys(await getAuthKeys({token}))
                    validated = await tryCandidateKeys(
                        prioritizeReusableAuthKeys(authKeys, authKeyName).map((entry) => ({
                            ...entry,
                            source: 'auth-keys',
                            pluginName,
                        })),
                    )
                    if (validated) {
                        apiKey = validated.apiKey
                    }
                } catch (lookupError) {
                    logger?.warn?.(
                        `[${serviceName}] Managed Kavita auth key recheck failed: ${lookupError instanceof Error ? lookupError.message : lookupError}`,
                    )
                }

                if (!apiKey) {
                    throw error
                }
            }
        }

        if (!apiKey) {
            throw new Error('Kavita did not return an API key for the managed service account.')
        }

        return {
            apiKey,
            account: normalizedAccount,
            authKey,
            authKeys,
            mode,
            user,
        }
    }

    return {
        getBaseUrl: () => normalizedBaseUrl,
        registerFirstAdmin,
        login,
        validateApiKey,
        getAuthKeys,
        createAuthKey,
        ensureServiceApiKey,
    }
}

export default createManagedKavitaSetupClient
