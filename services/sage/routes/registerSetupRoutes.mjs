// services/sage/routes/registerSetupRoutes.mjs

import {normalizeServiceInstallPayload} from '../app/createSetupClient.mjs'
import {SetupValidationError} from '../lib/errors.mjs'
import {createDefaultWizardState, resolveWizardStateOperation} from '../wizard/wizardStateSchema.mjs'

const MANAGED_KAVITA_BASE_URL = 'http://noona-kavita:5000'
const MANAGED_KAVITA_SERVICE_ACCOUNT_KEY = 'setup.managedKavitaServiceAccount'
const MANAGED_KAVITA_TARGET_SERVICES = Object.freeze(['noona-portal', 'noona-raven', 'noona-komf'])
const MANAGED_KAVITA_READY_RETRIES = 20
const MANAGED_KAVITA_READY_DELAY_MS = 1500

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    return value.trim()
}

const normalizeManagedServiceList = (values) => {
    const out = []
    const seen = new Set()

    for (const value of Array.isArray(values) ? values : []) {
        const normalized = normalizeString(value)
        if (!normalized || !MANAGED_KAVITA_TARGET_SERVICES.includes(normalized) || seen.has(normalized)) {
            continue
        }

        seen.add(normalized)
        out.push(normalized)
    }

    return out
}

const wait = (delayMs) =>
    new Promise((resolve) => {
        setTimeout(resolve, delayMs)
    })

const normalizeEnvMap = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
    }

    const out = {}

    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = normalizeString(key)
        if (!normalizedKey) {
            continue
        }

        out[normalizedKey] = entry == null ? '' : String(entry)
    }

    return out
}

const resolveManagedKavitaEnvKey = (serviceName) => {
    switch (serviceName) {
        case 'noona-portal':
        case 'noona-raven':
            return 'KAVITA_API_KEY'
        case 'noona-komf':
            return 'KOMF_KAVITA_API_KEY'
        default:
            return null
    }
}

const resolveManagedKavitaBaseUrlKey = (serviceName) => {
    switch (serviceName) {
        case 'noona-portal':
        case 'noona-raven':
            return 'KAVITA_BASE_URL'
        case 'noona-komf':
            return 'KOMF_KAVITA_BASE_URI'
        default:
            return null
    }
}

const buildManagedKavitaEnvPatch = (serviceName, env, apiKey, baseUrl) => {
    switch (serviceName) {
        case 'noona-portal':
            return {
                ...env,
                KAVITA_BASE_URL: baseUrl,
                KAVITA_API_KEY: apiKey,
            }
        case 'noona-raven':
            return {
                ...env,
                KAVITA_BASE_URL: baseUrl,
                KAVITA_API_KEY: apiKey,
                KAVITA_LIBRARY_ROOT: normalizeString(env.KAVITA_LIBRARY_ROOT) || '/manga',
            }
        case 'noona-komf':
            return {
                ...env,
                KOMF_KAVITA_BASE_URI: baseUrl,
                KOMF_KAVITA_API_KEY: apiKey,
            }
        default:
            return env
    }
}

const readManagedKavitaSettings = (doc) => {
    const value = doc?.value && typeof doc.value === 'object' ? doc.value : doc
    const account = value?.account && typeof value.account === 'object'
        ? {
            username: normalizeString(value.account.username),
            email: normalizeString(value.account.email),
        }
        : null

    return {
        apiKey: normalizeString(value?.apiKey),
        account,
    }
}

const normalizeManagedKavitaAccount = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }

    const username = normalizeString(value.username)
    const email = normalizeString(value.email)
    const password = normalizeString(value.password)
    const hasAnyValue = Boolean(username || email || password)

    if (!hasAnyValue) {
        return null
    }

    if (!username || !email || !password) {
        throw new SetupValidationError('Managed Kavita account requires a username, email, and password.')
    }

    return {username, email, password}
}

const readManagedKavitaConfiguredAccount = (config) => {
    const env = normalizeEnvMap(config?.env)
    return normalizeManagedKavitaAccount({
        username: env.KAVITA_ADMIN_USERNAME,
        email: env.KAVITA_ADMIN_EMAIL,
        password: env.KAVITA_ADMIN_PASSWORD,
    })
}

export function registerSetupRoutes(context = {}) {
    const {
        app,
        buildVerificationCheckResult,
        collectVerificationHealth,
        createEmptyVerificationSummary,
        discordSetupClient,
        logger,
        managedKavitaSetupClient,
        normalizeHistoryLimit,
        readVerificationSummary,
        resolveWizardStepKey,
        serviceName,
        settingsCollection,
        setupClient,
        VERIFICATION_SERVICES,
        vaultClient,
        wizardMetadata,
        wizardStateClient,
    } = context

    app.get('/api/pages', (req, res) => {
        const pages = [
            {name: 'Setup', path: '/setup'},
            {name: 'Dashboard', path: '/dashboard'},
        ]

        logger.debug(`[${serviceName}] Serving ${pages.length} static page entries`)
        res.json(pages)
    })

    app.get('/api/setup/services', async (req, res) => {
        try {
            const services = await setupClient.listServices()
            res.json({services})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load installable services: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve installable services.'})
        }
    })

    app.post('/api/setup/install', async (req, res) => {
        try {
            const asyncRequested = ['1', 'true', 'yes', 'on'].includes(String(req.query?.async ?? '').trim().toLowerCase())
            const result = await setupClient.installServices(req.body?.services, {async: asyncRequested})
            res.status(result?.status ?? 200).json({
                results: result?.results ?? [],
                accepted: result?.accepted === true,
                started: result?.started === true,
                alreadyRunning: result?.alreadyRunning === true,
                progress: result?.progress ?? null,
            })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to install services: ${error.message}`)
            res.status(502).json({error: 'Failed to install services.'})
        }
    })

    app.post('/api/setup/services/validate', async (req, res) => {
        try {
            const services = normalizeServiceInstallPayload(req.body?.services ?? req.body)
            const payload = {services}

            if (req.headers?.accept?.includes('application/x-ndjson')) {
                res.setHeader('Content-Type', 'application/x-ndjson')
                res.write(`${JSON.stringify({type: 'validation', data: payload})}\n`)
                res.end()
                return
            }

            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ⚠️ Validation failed: ${error.message}`)
            res.status(502).json({error: 'Unable to validate selection.'})
        }
    })

    app.post('/api/setup/services/preview', async (req, res) => {
        try {
            const services = normalizeServiceInstallPayload(req.body?.services ?? req.body)
            const catalog = await setupClient.listServices({includeInstalled: true})
            const knownNames = new Set(catalog.map((entry) => entry?.name).filter(Boolean))

            const normalized = services.map((entry) => ({
                name: entry.name,
                env: entry.env ?? {},
                known: knownNames.has(entry.name),
            }))

            const payload = {
                services: normalized,
                summary: {
                    total: normalized.length,
                    known: normalized.filter((entry) => entry.known).length,
                    unknown: normalized.filter((entry) => !entry.known).length,
                },
            }

            if (req.headers?.accept?.includes('application/x-ndjson')) {
                res.setHeader('Content-Type', 'application/x-ndjson')
                res.write(`${JSON.stringify({type: 'preview', data: payload})}\n`)
                res.end()
                return
            }

            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ⚠️ Preview failed: ${error.message}`)
            res.status(502).json({error: 'Unable to preview selection.'})
        }
    })

    app.get('/api/setup/services/install/progress', async (req, res) => {
        try {
            const progress = await setupClient.getInstallProgress()
            res.json(progress ?? {items: [], status: 'idle', percent: null})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load install progress: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve installation progress.'})
        }
    })

    app.get('/api/setup/services/installation/logs', async (req, res) => {
        try {
            const history = await setupClient.getInstallationLogs({limit: req.query?.limit})
            res.json(history)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load installation logs: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve installation logs.'})
        }
    })

    app.get('/api/setup/services/:name/health', async (req, res) => {
        const name = req.params?.name

        try {
            const payload = await setupClient.getServiceHealth(name)
            res.json(payload)
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to retrieve service health.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to load health for ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.get('/api/setup/services/:name/logs', async (req, res) => {
        const name = req.params?.name

        try {
            const history = await setupClient.getServiceLogs(name, {limit: req.query?.limit})
            res.json(history)
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to retrieve service logs.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to load logs for ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.get('/api/setup/wizard/metadata', (_req, res) => {
        res.json(wizardMetadata)
    })

    app.get('/api/wizard/steps', (_req, res) => {
        res.json({
            steps: wizardMetadata.steps,
            featureFlags: wizardMetadata.featureFlags,
            defaults: createDefaultWizardState(),
        })
    })

    app.get('/api/setup/wizard/state', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        try {
            const state = await wizardStateClient.loadState({fallbackToDefault: true})
            res.json(state)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load wizard state: ${error.message}`)
            res.status(502).json({error: 'Unable to load setup wizard state.'})
        }
    })

    app.get('/api/wizard/progress', async (_req, res) => {
        const progressFallback = {items: [], status: 'idle', percent: null}

        try {
            const [wizard, progress] = await Promise.all([
                wizardStateClient
                    ? wizardStateClient.loadState({fallbackToDefault: true})
                    : Promise.resolve(createDefaultWizardState()),
                setupClient.getInstallProgress().catch(() => progressFallback),
            ])

            res.json({wizard, progress: progress ?? progressFallback})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load wizard progress: ${error.message}`)
            res.status(502).json({error: 'Unable to load wizard progress.'})
        }
    })

    app.get('/api/setup/wizard/steps/:step/history', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({error: 'Invalid wizard step.'})
            return
        }

        try {
            const state = await wizardStateClient.loadState({fallbackToDefault: true})
            const timeline = Array.isArray(state?.[step]?.timeline) ? state[step].timeline : []
            const limit = normalizeHistoryLimit(req.query?.limit)
            const events = limit ? timeline.slice(-limit) : [...timeline]
            res.json({step, events})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load ${step} history: ${error.message}`)
            res.status(502).json({error: 'Unable to load wizard activity history.'})
        }
    })

    app.put('/api/setup/wizard/state', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        try {
            const operation = resolveWizardStateOperation(req.body ?? {})

            if (operation.type === 'replace') {
                const state = await wizardStateClient.writeState(operation.state)
                res.json(state)
                return
            }

            const {state} = await wizardStateClient.applyUpdates(operation.updates)
            res.json(state)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to update wizard state: ${error.message}`)
            res.status(502).json({error: 'Unable to update setup wizard state.'})
        }
    })

    app.post('/api/setup/wizard/steps/:step/reset', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({error: 'Invalid wizard step.'})
            return
        }

        const body = req.body ?? {}
        const limit = normalizeHistoryLimit(body.limit)
        const timestamp = new Date().toISOString()

        try {
            const {state} = await wizardStateClient.applyUpdates([
                {
                    step,
                    status: 'pending',
                    detail: null,
                    error: null,
                    completedAt: null,
                    updatedAt: timestamp,
                    timeline: [],
                    retries: 0,
                    actor: null,
                },
            ])

            let wizard = state
            if (typeof wizardStateClient.appendHistory === 'function') {
                const actor = body.actor && typeof body.actor === 'object' ? body.actor : null
                const eventDetail =
                    typeof body.detail === 'string' && body.detail.trim()
                        ? body.detail.trim()
                        : 'Cleared progress for this step.'
                const eventMessage =
                    typeof body.message === 'string' && body.message.trim()
                        ? body.message.trim()
                        : 'Step reset'
                const context = body.context && typeof body.context === 'object' ? body.context : null

                const {state: updated} = await wizardStateClient.appendHistory({
                    step,
                    entries: [
                        {
                            timestamp,
                            status: 'info',
                            code: 'step-reset',
                            message: eventMessage,
                            detail: eventDetail,
                            actor,
                            context,
                        },
                    ],
                    limit: limit ?? undefined,
                })

                wizard = updated
            }

            res.json({wizard, step})
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to reset ${step}: ${error.message}`)
            res.status(502).json({error: 'Unable to reset wizard step.'})
        }
    })

    app.post('/api/setup/wizard/steps/:step/broadcast', async (req, res) => {
        if (!wizardStateClient || typeof wizardStateClient.appendHistory !== 'function') {
            res.status(503).json({error: 'Wizard history storage is not configured.'})
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({error: 'Invalid wizard step.'})
            return
        }

        const body = req.body ?? {}
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (!message) {
            res.status(400).json({error: 'Broadcast message is required.'})
            return
        }

        const limit = normalizeHistoryLimit(body.limit)
        const eventDetail = typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : null
        const eventStatus =
            typeof body.eventStatus === 'string' && body.eventStatus.trim() ? body.eventStatus.trim() : null
        const actor = body.actor && typeof body.actor === 'object' ? body.actor : null
        const context = body.context && typeof body.context === 'object' ? body.context : null

        try {
            const historyResult = await wizardStateClient.appendHistory({
                step,
                entries: [
                    {
                        message,
                        detail: eventDetail,
                        status: eventStatus,
                        code:
                            typeof body.code === 'string' && body.code.trim()
                                ? body.code.trim()
                                : null,
                        actor,
                        context,
                    },
                ],
                limit: limit ?? undefined,
            })

            let wizard = historyResult.state
            const patch = {step}
            let shouldUpdate = false

            if (typeof body.status === 'string' && body.status.trim()) {
                patch.status = body.status.trim()
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'detail')) {
                patch.detail = eventDetail
                shouldUpdate = true
            } else {
                patch.detail = message
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'error')) {
                patch.error = typeof body.error === 'string' ? body.error : null
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'retries')) {
                patch.retries = body.retries
                shouldUpdate = true
            }

            if (actor) {
                patch.actor = actor
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'completedAt')) {
                patch.completedAt = body.completedAt
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'updatedAt')) {
                patch.updatedAt = body.updatedAt
                shouldUpdate = true
            }

            if (shouldUpdate) {
                const {state} = await wizardStateClient.applyUpdates([patch])
                wizard = state
            }

            const events = Array.isArray(wizard?.[step]?.timeline) ? wizard[step].timeline : []
            const event = events[events.length - 1] || null

            res.json({wizard, event, step})
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to broadcast ${step} summary: ${error.message}`)
            res.status(502).json({error: 'Unable to broadcast wizard summary.'})
        }
    })

    app.get('/api/setup/verification/status', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        try {
            const [wizard, health] = await Promise.all([
                wizardStateClient.loadState({fallbackToDefault: true}),
                collectVerificationHealth(),
            ])

            res.json({wizard, summary: readVerificationSummary(wizard), health})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load verification status: ${error.message}`)
            res.status(502).json({error: 'Unable to load verification status.'})
        }
    })

    app.post('/api/setup/verification/checks', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        const timestamp = new Date().toISOString()

        try {
            await wizardStateClient
                .applyUpdates([
                    {
                        step: 'verification',
                        status: 'in-progress',
                        detail: 'Running verification checks…',
                        error: null,
                        updatedAt: timestamp,
                        completedAt: null,
                    },
                ])
                .catch(() => null)

            const checks = []

            for (const config of VERIFICATION_SERVICES) {
                try {
                    const response = await setupClient.testService(config.name)
                    checks.push(
                        buildVerificationCheckResult(
                            config,
                            response?.result ?? response,
                            new Date().toISOString(),
                        ),
                    )
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    checks.push(
                        buildVerificationCheckResult(
                            config,
                            {success: false, supported: true, error: message},
                            new Date().toISOString(),
                        ),
                    )
                }
            }

            const completedAt = new Date().toISOString()
            const summary = {
                lastRunAt: completedAt,
                checks,
            }

            const hasFailures = summary.checks.some((check) => check.supported !== false && !check.success)
            const stepUpdate = {
                step: 'verification',
                status: hasFailures ? 'error' : 'complete',
                detail: JSON.stringify(summary),
                error: hasFailures ? 'Verification checks reported failures.' : null,
                updatedAt: completedAt,
                completedAt: hasFailures ? null : completedAt,
            }

            const {state} = await wizardStateClient.applyUpdates([stepUpdate])
            const health = await collectVerificationHealth()

            res.json({wizard: state, summary, health})
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to execute verification checks: ${error.message}`)
            res.status(502).json({error: 'Unable to run verification checks.'})
        }
    })

    app.post('/api/setup/wizard/complete', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({error: 'Wizard state storage is not configured.'})
            return
        }

        try {
            const current = await wizardStateClient.loadState({fallbackToDefault: true})
            const summary = readVerificationSummary(current)

            const allChecksPassed =
                summary.checks.length > 0 &&
                summary.checks.every((check) => check.success || check.supported === false)

            if (!allChecksPassed || current?.verification?.status !== 'complete') {
                res.status(400).json({error: 'Verification checks must succeed before completing setup.'})
                return
            }

            if (current.completed) {
                const health = await collectVerificationHealth()
                res.json({wizard: current, summary, health})
                return
            }

            const now = new Date().toISOString()
            const nextState = {
                ...current,
                completed: true,
                updatedAt: now,
                verification: {
                    ...current.verification,
                    completedAt:
                        current?.verification?.completedAt && current.verification.completedAt.trim()
                            ? current.verification.completedAt
                            : now,
                    updatedAt: current?.verification?.updatedAt || now,
                },
            }

            const persisted = await wizardStateClient.writeState(nextState)
            const health = await collectVerificationHealth()

            res.json({wizard: persisted, summary, health})
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to complete setup: ${error.message}`)
            res.status(502).json({error: 'Unable to complete setup.'})
        }
    })

    app.post('/api/setup/services/:name/test', async (req, res) => {
        const name = req.params?.name

        try {
            const {status, result} = await setupClient.testService(name, req.body ?? {})
            res.status(status ?? 200).json(result ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Failed to execute service test.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ❌ Failed to test service ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.post('/api/setup/services/noona-portal/discord/validate', async (req, res) => {
        try {
            const {token, clientId, guildId} = req.body ?? {}
            const payload = await discordSetupClient.fetchResources({token, clientId, guildId})
            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Discord validation failed: ${error.message}`)
            res.status(502).json({error: 'Unable to verify Discord configuration.'})
        }
    })

    app.post('/api/setup/services/noona-portal/discord/roles', async (req, res) => {
        try {
            const {token, guildId, name} = req.body ?? {}
            const role = await discordSetupClient.createRole({token, guildId, name})
            res.status(201).json({role})
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to create Discord role: ${error.message}`)
            res.status(502).json({error: 'Unable to create Discord role.'})
        }
    })

    app.post('/api/setup/services/noona-portal/discord/channels', async (req, res) => {
        try {
            const {token, guildId, name, type} = req.body ?? {}
            const channel = await discordSetupClient.createChannel({token, guildId, name, type})
            res.status(201).json({channel})
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to create Discord channel: ${error.message}`)
            res.status(502).json({error: 'Unable to create Discord channel.'})
        }
    })

    app.post('/api/setup/services/noona-kavita/service-key', async (req, res) => {
        const targetServices = normalizeManagedServiceList(req.body?.services)
        if (targetServices.length === 0) {
            res.status(400).json({error: 'Select at least one managed service to receive the Kavita API key.'})
            return
        }

        try {
            const requestedAccount = normalizeManagedKavitaAccount(req.body?.account)
            const [managedKavitaConfig, targetConfigs] = await Promise.all([
                setupClient.getServiceConfig('noona-kavita'),
                Promise.all(
                    targetServices.map(async (name) => [name, await setupClient.getServiceConfig(name)]),
                ),
            ])
            const configuredAccount = readManagedKavitaConfiguredAccount(managedKavitaConfig)
            const configs = new Map(targetConfigs)

            const existingKeys = new Set()
            for (const targetServiceName of targetServices) {
                const env = normalizeEnvMap(configs.get(targetServiceName)?.env)
                const keyName = resolveManagedKavitaEnvKey(targetServiceName)
                const existingKey = keyName ? normalizeString(env[keyName]) : ''
                if (existingKey) {
                    existingKeys.add(existingKey)
                }
            }

            let storedSettings = null
            if (vaultClient?.mongo && settingsCollection) {
                storedSettings = await vaultClient.mongo.findOne(settingsCollection, {
                    key: MANAGED_KAVITA_SERVICE_ACCOUNT_KEY,
                })
            }

            const {apiKey: storedApiKey, account: storedAccount} = readManagedKavitaSettings(storedSettings)

            const effectiveAccount = requestedAccount || configuredAccount || null

            let apiKey = ''
            let account =
                storedAccount ||
                (effectiveAccount
                    ? {
                        username: normalizeString(effectiveAccount.username),
                        email: normalizeString(effectiveAccount.email),
                    }
                    : null)
            let mode = 'reused'

            if (storedApiKey) {
                apiKey = storedApiKey
                mode = 'stored'
            } else if (existingKeys.size === 1) {
                apiKey = Array.from(existingKeys)[0]
                mode = 'existing'
            } else if (existingKeys.size > 1) {
                res.status(409).json({error: 'Managed Kavita setup found conflicting API keys across selected services.'})
                return
            } else {
                let provisioning = null
                let lastError = null

                for (let attempt = 1; attempt <= MANAGED_KAVITA_READY_RETRIES; attempt += 1) {
                    try {
                        provisioning = await managedKavitaSetupClient.ensureServiceApiKey({
                            account: effectiveAccount,
                            allowRegister: true,
                        })
                        break
                    } catch (error) {
                        if (error instanceof SetupValidationError) {
                            throw error
                        }

                        lastError = error
                        logger.warn?.(
                            `[${serviceName}] Managed Kavita key provisioning attempt ${attempt}/${MANAGED_KAVITA_READY_RETRIES} failed: ${error instanceof Error ? error.message : error}`,
                        )

                        if (attempt < MANAGED_KAVITA_READY_RETRIES) {
                            await wait(MANAGED_KAVITA_READY_DELAY_MS)
                        }
                    }
                }

                if (!provisioning) {
                    throw lastError || new Error('Unable to provision a managed Kavita API key.')
                }

                apiKey = normalizeString(provisioning.apiKey)
                account = provisioning.account
                    ? {
                        username: normalizeString(provisioning.account.username),
                        email: normalizeString(provisioning.account.email),
                    }
                    : null
                mode = provisioning.mode
            }

            if (!apiKey) {
                throw new Error('Managed Kavita setup did not produce an API key.')
            }

            const updatedServices = []
            for (const targetServiceName of targetServices) {
                const currentConfig = configs.get(targetServiceName)
                const env = normalizeEnvMap(currentConfig?.env)
                const patch = buildManagedKavitaEnvPatch(targetServiceName, env, apiKey, MANAGED_KAVITA_BASE_URL)
                const response = await setupClient.updateServiceConfig(targetServiceName, {
                    env: patch,
                    restart: true,
                })

                updatedServices.push({
                    name: targetServiceName,
                    baseUrl: normalizeString(
                        patch[resolveManagedKavitaBaseUrlKey(targetServiceName) ?? ''],
                    ) || MANAGED_KAVITA_BASE_URL,
                    apiKeyField: resolveManagedKavitaEnvKey(targetServiceName),
                    restarted: Boolean(response?.restarted),
                })
            }

            if (vaultClient?.mongo && settingsCollection) {
                const now = new Date().toISOString()
                await vaultClient.mongo
                    .update(
                        settingsCollection,
                        {key: MANAGED_KAVITA_SERVICE_ACCOUNT_KEY},
                        {
                            $set: {
                                key: MANAGED_KAVITA_SERVICE_ACCOUNT_KEY,
                                value: {
                                    account: account
                                        ? {
                                            username: normalizeString(account.username),
                                            email: normalizeString(account.email),
                                        }
                                        : null,
                                    apiKey,
                                    updatedAt: now,
                                },
                                updatedAt: now,
                            },
                            $setOnInsert: {
                                createdAt: now,
                            },
                        },
                        {upsert: true},
                    )
                    .catch((error) => {
                        logger.warn?.(
                            `[${serviceName}] Unable to persist managed Kavita setup settings: ${error instanceof Error ? error.message : error}`,
                        )
                    })
            }

            res.json({
                apiKey,
                baseUrl: MANAGED_KAVITA_BASE_URL,
                mode,
                account: account
                    ? {
                        username: normalizeString(account.username),
                        email: normalizeString(account.email),
                    }
                    : null,
                services: targetServices,
                updatedServices,
            })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({error: error.message})
                return
            }

            logger.error(`[${serviceName}] âŒ Managed Kavita key provisioning failed: ${error.message}`)
            res.status(502).json({error: 'Unable to provision the managed Kavita API key.'})
        }
    })

    app.post('/api/setup/services/noona-raven/detect', async (_req, res) => {
        try {
            const {status, detection, error} = await setupClient.detectRavenMount()
            if (status && status >= 400) {
                res.status(status).json({error: error ?? 'Unable to detect Kavita data mount.'})
                return
            }

            res.json({detection})
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to detect Kavita mount: ${error.message}`)
            res.status(502).json({error: 'Unable to detect Kavita data mount.'})
        }
    })
}

export default registerSetupRoutes
