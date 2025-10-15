// services/sage/shared/wizardStateClient.mjs

import {
    DEFAULT_WIZARD_STATE_KEY,
    WIZARD_STEP_KEYS,
    applyWizardStateUpdates,
    createDefaultWizardState,
    normalizeWizardState,
    normalizeWizardStateUpdates,
    resolveWizardStateOperation,
} from './wizardStateSchema.mjs'

const normalizeUrl = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    if (!trimmed) {
        return null
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }

    return `http://${trimmed}`
}

const resolveDefaultVaultUrls = (env = process.env) => {
    const candidates = [
        env?.VAULT_BASE_URL,
        env?.VAULT_INTERNAL_BASE_URL,
        env?.VAULT_DOCKER_URL,
    ]

    const hostCandidates = [env?.VAULT_HOST, env?.VAULT_SERVICE_HOST]
    const port = env?.VAULT_PORT || '3005'

    for (const host of hostCandidates) {
        if (typeof host === 'string' && host.trim()) {
            candidates.push(`${host.trim()}:${port}`)
        }
    }

    candidates.push(
        'http://noona-vault:3005',
        'http://vault:3005',
        'http://host.docker.internal:3005',
        'http://127.0.0.1:3005',
        'http://localhost:3005',
    )

    return Array.from(
        new Set(
            candidates
                .map(normalizeUrl)
                .filter(Boolean),
        ),
    )
}

const parseJson = async (response) => {
    const text = await response.text().catch(() => '')
    if (!text) {
        return {}
    }

    try {
        return JSON.parse(text)
    } catch {
        return {}
    }
}

const stampState = (state) => {
    const normalized = normalizeWizardState(state)
    const now = new Date().toISOString()
    const stamped = {
        ...normalized,
        updatedAt: normalized.updatedAt || now,
    }

    for (const step of WIZARD_STEP_KEYS) {
        const current = { ...stamped[step] }
        if (!current.updatedAt) {
            current.updatedAt = stamped.updatedAt
        }
        stamped[step] = current
    }

    return stamped
}

export const createWizardStateClient = ({
    baseUrl,
    baseUrls = [],
    token,
    redisKey = DEFAULT_WIZARD_STATE_KEY,
    fetchImpl = fetch,
    env = process.env,
    logger = {},
    serviceName = env?.SERVICE_NAME || 'noona-sage',
    timeoutMs = 10000,
} = {}) => {
    if (!token || typeof token !== 'string' || !token.trim()) {
        throw new Error('Vault API token is required to manage wizard state.')
    }

    const defaults = resolveDefaultVaultUrls(env)
    const deduped = Array.from(
        new Set(
            [
                normalizeUrl(baseUrl),
                ...baseUrls.map(normalizeUrl),
                ...defaults,
            ].filter(Boolean),
        ),
    )

    if (deduped.length === 0) {
        throw new Error('Unable to resolve Vault base URL for wizard state client.')
    }

    let preferredBaseUrl = deduped[0]

    const request = async (packet) => {
        const errors = []
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const candidates = preferredBaseUrl
                ? [preferredBaseUrl, ...deduped.filter((url) => url !== preferredBaseUrl)]
                : deduped

            for (const candidate of candidates) {
                try {
                    const response = await fetchImpl(new URL('/v1/vault/handle', candidate).toString(), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify(packet),
                        signal: controller.signal,
                    })

                    const payload = await parseJson(response)
                    if (!response.ok) {
                        throw new Error(payload?.error || `Vault responded with status ${response.status}`)
                    }

                    if (payload?.error) {
                        throw new Error(payload.error)
                    }

                    preferredBaseUrl = candidate
                    return payload
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    errors.push(`${candidate} (${message})`)
                }
            }

            throw new Error(`All Vault endpoints failed: ${errors.join(' | ')}`)
        } finally {
            clearTimeout(timer)
        }
    }

    const loadState = async ({ fallbackToDefault = true } = {}) => {
        try {
            const result = await request({
                storageType: 'redis',
                operation: 'get',
                payload: { key: redisKey },
            })

            if (result?.data) {
                const state = normalizeWizardState(result.data)
                logger.debug?.(`[${serviceName}] 📥 Loaded wizard state from Vault (key=${redisKey}).`)
                return state
            }

            if (!fallbackToDefault) {
                return null
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (fallbackToDefault && /key not found in redis/i.test(message)) {
                logger.debug?.(`[${serviceName}] ℹ️ Wizard state not found in Vault, returning defaults.`)
            } else {
                throw error
            }
        }

        return createDefaultWizardState()
    }

    const writeState = async (state) => {
        const payload = stampState(state)
        await request({
            storageType: 'redis',
            operation: 'set',
            payload: { key: redisKey, value: payload },
        })
        logger.debug?.(`[${serviceName}] 💾 Persisted wizard state to Vault (key=${redisKey}).`)
        return payload
    }

    const applyUpdatesOnState = async (updates) => {
        const normalizedUpdates = normalizeWizardStateUpdates(updates)
        if (normalizedUpdates.length === 0) {
            const state = await loadState({ fallbackToDefault: true })
            return { state, changed: false }
        }

        const current = await loadState({ fallbackToDefault: true })
        const { state: next, changed } = applyWizardStateUpdates(current, normalizedUpdates)

        if (!changed) {
            return { state: next, changed }
        }

        const persisted = await writeState(next)
        return { state: persisted, changed }
    }

    const replaceState = async (state) => writeState(state)

    return {
        loadState,
        writeState: replaceState,
        applyUpdates: applyUpdatesOnState,
        resolveOperation: resolveWizardStateOperation,
        defaults: createDefaultWizardState,
        key: redisKey,
    }
}

const DEFAULT_STEP_SERVICE_MAP = {
    foundation: [
        'noona-warden',
        'noona-redis',
        'noona-mongo',
        'noona-vault',
        'noona-sage',
        'noona-moon',
    ],
    portal: ['noona-portal'],
    raven: ['noona-raven'],
}

const mapInstallationStatusToWizard = (status) => {
    switch (status) {
        case 'installed':
            return 'complete'
        case 'installing':
            return 'in-progress'
        case 'error':
            return 'error'
        default:
            return 'pending'
    }
}

const normalizeStringValue = (candidate) => {
    if (typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    return trimmed ? trimmed : null
}

const createDefaultRavenDetail = () => ({
    overrides: {},
    detection: null,
    launch: null,
    health: null,
    message: null,
})

const parseRavenDetailFromState = (detail) => {
    if (!detail || typeof detail !== 'string') {
        return createDefaultRavenDetail()
    }

    try {
        const parsed = JSON.parse(detail)
        if (!parsed || typeof parsed !== 'object') {
            return createDefaultRavenDetail()
        }

        const overrides =
            parsed.overrides && typeof parsed.overrides === 'object'
                ? parsed.overrides
                : {}

        const detectionSource = parsed.detection && typeof parsed.detection === 'object' ? parsed.detection : null
        const detection = detectionSource
            ? {
                  status: normalizeStringValue(detectionSource.status),
                  message: normalizeStringValue(detectionSource.message),
                  mountPath: normalizeStringValue(detectionSource.mountPath),
                  updatedAt: normalizeStringValue(detectionSource.updatedAt),
              }
            : null

        const launchSource = parsed.launch && typeof parsed.launch === 'object' ? parsed.launch : null
        const launch = launchSource
            ? {
                  status: normalizeStringValue(launchSource.status),
                  startedAt: normalizeStringValue(launchSource.startedAt),
                  completedAt: normalizeStringValue(launchSource.completedAt),
                  error: normalizeStringValue(launchSource.error),
              }
            : null

        const healthSource = parsed.health && typeof parsed.health === 'object' ? parsed.health : null
        const health = healthSource
            ? {
                  status: normalizeStringValue(healthSource.status),
                  message: normalizeStringValue(healthSource.message),
                  checkedAt: normalizeStringValue(healthSource.checkedAt),
              }
            : null

        return {
            overrides,
            detection,
            launch,
            health,
            message: normalizeStringValue(parsed.message),
        }
    } catch {
        return createDefaultRavenDetail()
    }
}

const sanitizeRavenDetection = (value) => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value
    return {
        status: normalizeStringValue(record.status) || 'idle',
        message: normalizeStringValue(record.message),
        mountPath: normalizeStringValue(record.mountPath),
        updatedAt: normalizeStringValue(record.updatedAt) || new Date().toISOString(),
    }
}

const sanitizeRavenLaunch = (value) => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value
    return {
        status: normalizeStringValue(record.status) || 'idle',
        startedAt: normalizeStringValue(record.startedAt) || new Date().toISOString(),
        completedAt: normalizeStringValue(record.completedAt),
        error: normalizeStringValue(record.error),
    }
}

const sanitizeRavenHealth = (value) => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value
    return {
        status: normalizeStringValue(record.status),
        message: normalizeStringValue(record.message),
        checkedAt: normalizeStringValue(record.checkedAt) || new Date().toISOString(),
    }
}

const mergeRavenDetail = (current = createDefaultRavenDetail(), patch = {}) => {
    const next = {
        overrides: { ...(current.overrides || {}) },
        detection: current.detection ? { ...current.detection } : null,
        launch: current.launch ? { ...current.launch } : null,
        health: current.health ? { ...current.health } : null,
        message: current.message ?? null,
    }

    if (patch && typeof patch.overrides === 'object') {
        next.overrides = { ...next.overrides, ...patch.overrides }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'detection')) {
        next.detection = sanitizeRavenDetection(patch.detection)
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'launch')) {
        next.launch = sanitizeRavenLaunch(patch.launch)
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'health')) {
        next.health = sanitizeRavenHealth(patch.health)
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'message')) {
        next.message = normalizeStringValue(patch.message)
    }

    return next
}

export const createWizardStatePublisher = ({
    client,
    logger = {},
    stepServices = {},
} = {}) => {
    if (!client) {
        throw new Error('Wizard state client is required to create publisher.')
    }

    const debug = typeof logger.debug === 'function' ? logger.debug.bind(logger) : () => {}
    const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : () => {}

    const mapping = {}
    for (const step of WIZARD_STEP_KEYS) {
        const override = stepServices?.[step]
        if (Array.isArray(override) && override.length > 0) {
            mapping[step] = override
        } else if (DEFAULT_STEP_SERVICE_MAP[step]) {
            mapping[step] = DEFAULT_STEP_SERVICE_MAP[step]
        } else {
            mapping[step] = []
        }
    }

    const serviceToStep = new Map()
    for (const [step, services] of Object.entries(mapping)) {
        for (const service of services) {
            if (typeof service === 'string' && service.trim()) {
                const normalized = service.trim()
                if (!serviceToStep.has(normalized)) {
                    serviceToStep.set(normalized, step)
                }
            }
        }
    }

    let activeSteps = []
    const selectedServices = new Set()
    const serviceStatuses = new Map()
    const stepStatuses = new Map()
    const stepDetails = new Map()
    const stepErrors = new Map()
    let cachedRavenDetail = null

    const computeActiveSteps = () => {
        const steps = []
        for (const step of WIZARD_STEP_KEYS) {
            if (step === 'verification') {
                continue
            }
            const services = mapping[step] || []
            const hasMatch = services.some((service) => selectedServices.size === 0 || selectedServices.has(service))
            if (hasMatch) {
                steps.push(step)
            }
        }
        return steps
    }

    const reset = async (names = []) => {
        selectedServices.clear()
        for (const name of names) {
            if (typeof name === 'string' && name.trim()) {
                selectedServices.add(name.trim())
            }
        }

        serviceStatuses.clear()
        const state = createDefaultWizardState()
        const now = state.updatedAt ?? new Date().toISOString()
        activeSteps = computeActiveSteps()
        cachedRavenDetail = null

        for (const step of WIZARD_STEP_KEYS) {
            const stepState = state[step]
            if (step === 'verification') {
                if (activeSteps.length === 0) {
                    stepState.status = 'skipped'
                    stepState.detail = 'No services selected for installation.'
                    stepStatuses.set(step, 'skipped')
                    stepDetails.set(step, stepState.detail)
                    stepErrors.set(step, null)
                } else {
                    stepState.status = 'pending'
                    stepState.detail = null
                    stepStatuses.set(step, 'pending')
                    stepDetails.set(step, null)
                    stepErrors.set(step, null)
                }
                stepState.error = null
                stepState.completedAt = null
                stepState.updatedAt = now
                continue
            }

            if (activeSteps.includes(step)) {
                const isFirst = activeSteps[0] === step
                stepState.status = isFirst ? 'in-progress' : 'pending'
                stepState.detail = null
                stepState.error = null
                stepState.completedAt = null
                stepState.updatedAt = now
                stepStatuses.set(step, stepState.status)
                stepDetails.set(step, null)
                stepErrors.set(step, null)
            } else {
                stepState.status = 'skipped'
                stepState.detail = 'Not scheduled for installation.'
                stepState.error = null
                stepState.completedAt = null
                stepState.updatedAt = now
                stepStatuses.set(step, 'skipped')
                stepDetails.set(step, stepState.detail)
                stepErrors.set(step, null)
            }
        }

        debug(`[Wizard] Reset state for ${names.length} services (active steps: ${activeSteps.join(', ') || 'none'}).`)
        return client.writeState(state)
    }

    const trackServiceStatus = async (serviceName, status, entry = {}) => {
        const normalizedService = typeof serviceName === 'string' ? serviceName.trim() : ''
        if (!normalizedService) {
            return null
        }

        const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''
        if (!normalizedStatus) {
            return null
        }

        if (selectedServices.size > 0 && !selectedServices.has(normalizedService)) {
            return null
        }

        const step = serviceToStep.get(normalizedService)
        if (!step || step === 'verification') {
            return null
        }

        serviceStatuses.set(normalizedService, normalizedStatus)
        const servicesForStep = (mapping[step] || []).filter(
            (service) => selectedServices.size === 0 || selectedServices.has(service),
        )

        if (servicesForStep.length === 0) {
            return null
        }

        let aggregated = 'pending'
        if (servicesForStep.some((service) => serviceStatuses.get(service) === 'error')) {
            aggregated = 'error'
        } else if (servicesForStep.every((service) => serviceStatuses.get(service) === 'installed')) {
            aggregated = 'complete'
        } else if (servicesForStep.some((service) => serviceStatuses.get(service) === 'installing')) {
            aggregated = 'in-progress'
        }

        const updates = []
        const previousStatus = stepStatuses.get(step)
        const previousDetail = stepDetails.get(step) ?? null
        const previousError = stepErrors.get(step) ?? null

        const update = {
            step,
            status: aggregated,
            detail: previousDetail,
            error: previousError,
        }

        const message = entry?.detail || entry?.message || null

        switch (aggregated) {
            case 'error':
                update.error = message || 'Installation failed.'
                update.detail = message || previousDetail
                break
            case 'in-progress':
                update.error = null
                update.detail = message || `Installing ${normalizedService}`
                break
            case 'complete':
                update.error = null
                update.detail = message || 'Installation complete.'
                break
            default:
                update.error = null
                update.detail = null
                break
        }

        const detailChanged = update.detail !== previousDetail
        const errorChanged = update.error !== previousError

        if (aggregated !== previousStatus || detailChanged || errorChanged) {
            stepStatuses.set(step, aggregated)
            stepDetails.set(step, update.detail ?? null)
            stepErrors.set(step, update.error ?? null)
            updates.push(update)
        }

        if (aggregated === 'complete') {
            const nextStep = activeSteps.find((candidate) => stepStatuses.get(candidate) === 'pending')
            if (nextStep) {
                stepStatuses.set(nextStep, 'in-progress')
                stepDetails.set(nextStep, null)
                stepErrors.set(nextStep, null)
                updates.push({ step: nextStep, status: 'in-progress', detail: null, error: null })
            }
        }

        if (updates.length === 0) {
            return null
        }

        const result = await client.applyUpdates(updates)
        debug(`[Wizard] Updated ${step} via ${normalizedService} (${updates.map((u) => u.status).join(', ')}).`)
        return result.state
    }

    const ensureRavenDetail = async () => {
        if (cachedRavenDetail) {
            return cachedRavenDetail
        }

        try {
            const state = await client.loadState({ fallbackToDefault: true })
            cachedRavenDetail = parseRavenDetailFromState(state?.raven?.detail ?? null)
        } catch {
            cachedRavenDetail = createDefaultRavenDetail()
        }

        return cachedRavenDetail
    }

    const recordRavenDetail = async (patch = {}, options = {}) => {
        const current = await ensureRavenDetail()
        const merged = mergeRavenDetail(current, patch)
        cachedRavenDetail = merged

        if (typeof merged.message === 'string' && merged.message.trim()) {
            stepDetails.set('raven', merged.message.trim())
        }

        const update = {
            step: 'raven',
            detail: JSON.stringify({
                overrides: merged.overrides || {},
                detection: merged.detection,
                launch: merged.launch,
                health: merged.health,
                message: merged.message ?? null,
            }),
        }

        if (options.status) {
            update.status = options.status
            stepStatuses.set('raven', options.status)
            update.updatedAt = new Date().toISOString()
            update.completedAt = options.status === 'complete' ? update.updatedAt : null
        }

        if (Object.prototype.hasOwnProperty.call(options, 'error')) {
            update.error = options.error ?? null
            stepErrors.set('raven', update.error)
        }

        if (Object.prototype.hasOwnProperty.call(options, 'completedAt')) {
            update.completedAt = options.completedAt
        }

        if (options.message && typeof options.message === 'string' && options.message.trim()) {
            stepDetails.set('raven', options.message.trim())
        }

        const result = await client.applyUpdates([update])
        debug(`[Wizard] Raven detail updated (${options.status || 'detail'}).`)
        return result.state
    }

    const completeInstall = async ({ hasErrors = false } = {}) => {
        const currentStatus = stepStatuses.get('verification')
        if (currentStatus === 'skipped') {
            return null
        }

        const status = hasErrors ? 'error' : 'complete'
        const detail = hasErrors
            ? 'Installation finished with errors.'
            : 'Installation finished successfully.'
        const error = hasErrors ? detail : null

        stepStatuses.set('verification', status)
        stepDetails.set('verification', detail)
        stepErrors.set('verification', error)

        const result = await client.applyUpdates([
            { step: 'verification', status, detail, error },
        ])

        if (hasErrors) {
            warn('[Wizard] Installation finished with errors; verification marked as failed.')
        } else {
            debug('[Wizard] Installation finished successfully; verification marked complete.')
        }

        return result.state
    }

    return {
        reset,
        trackServiceStatus,
        completeInstall,
        recordRavenDetail,
    }
}

export {
    DEFAULT_WIZARD_STATE_KEY,
    resolveDefaultVaultUrls,
    resolveWizardStateOperation,
    mapInstallationStatusToWizard,
}

export default {
    createWizardStateClient,
    createWizardStatePublisher,
    DEFAULT_WIZARD_STATE_KEY,
    resolveDefaultVaultUrls,
    resolveWizardStateOperation,
    mapInstallationStatusToWizard,
}
