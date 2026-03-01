import crypto from 'node:crypto'

import {SetupValidationError} from '../lib/errors.mjs'

export const DEFAULT_MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000'
export const DEFAULT_MANAGED_KAVITA_AUTH_KEY_NAME = 'Noona Managed Services'
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
                                           keyLength = 32,
                                       } = {}) => {
        let normalizedAccount = normalizeManagedAccount(account)
        if (!normalizedAccount && allowRegister) {
            normalizedAccount = createManagedKavitaServiceAccount({randomBytes})
        }

        if (!normalizedAccount) {
            throw new SetupValidationError('Managed Kavita setup needs account credentials or registration enabled.')
        }

        let user = null
        let mode = 'login'

        if (allowRegister && !account) {
            mode = 'register'
            user = await registerFirstAdmin(normalizedAccount)
        } else {
            user = await login(normalizedAccount)
        }

        let apiKey = normalizeString(user?.apiKey) || null
        let authKey = null
        let token = normalizeString(user?.token) || null

        if (!apiKey && mode === 'register') {
            try {
                user = await login(normalizedAccount)
                apiKey = normalizeString(user?.apiKey) || null
                token = normalizeString(user?.token) || token
                mode = 'login'
            } catch (error) {
                logger?.warn?.(
                    `[${serviceName}] Managed Kavita follow-up login failed after registration: ${error instanceof Error ? error.message : error}`,
                )
            }
        }

        if (!apiKey && token) {
            authKey = await createAuthKey({
                token,
                name: authKeyName,
                keyLength,
            })
            apiKey = normalizeString(authKey?.key) || null
        }

        if (!apiKey) {
            throw new Error('Kavita did not return an API key for the managed service account.')
        }

        return {
            apiKey,
            account: normalizedAccount,
            authKey,
            mode,
            user,
        }
    }

    return {
        getBaseUrl: () => normalizedBaseUrl,
        registerFirstAdmin,
        login,
        createAuthKey,
        ensureServiceApiKey,
    }
}

export default createManagedKavitaSetupClient
