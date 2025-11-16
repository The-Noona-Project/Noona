// services/sage/shared/wizardStateSchema.mjs

import { SetupValidationError } from './errors.mjs'

export const WIZARD_STATE_VERSION = 2
export const WIZARD_STEP_KEYS = Object.freeze(['foundation', 'portal', 'raven', 'verification'])
export const WIZARD_STATUS_VALUES = Object.freeze(['pending', 'in-progress', 'complete', 'error', 'skipped'])
export const DEFAULT_WIZARD_STATE_KEY = 'noona:wizard:state'
export const DEFAULT_WIZARD_STEP_METADATA = Object.freeze([
    {
        id: 'foundation',
        title: 'Foundation services',
        description: 'Configure core data services and bootstrap the stack.',
        optional: false,
        icon: 'foundation',
        capabilities: Object.freeze(['foundation', 'environment', 'installation']),
    },
    {
        id: 'portal',
        title: 'Portal configuration',
        description: 'Provide Portal environment configuration and validate Discord access.',
        optional: false,
        icon: 'portal',
        capabilities: Object.freeze(['portal', 'configuration', 'discord']),
    },
    {
        id: 'raven',
        title: 'Raven deployment',
        description: 'Launch Raven and monitor installer progress.',
        optional: false,
        icon: 'raven',
        capabilities: Object.freeze(['raven', 'deployment', 'monitoring']),
    },
    {
        id: 'verification',
        title: 'Verification checks',
        description: 'Run health checks and confirm service readiness.',
        optional: false,
        icon: 'verification',
        capabilities: Object.freeze(['verification', 'health', 'checks']),
    },
])

const STATUS_SET = new Set(WIZARD_STATUS_VALUES)
const STEP_SET = new Set(WIZARD_STEP_KEYS)
const DEFAULT_STEP_METADATA_MAP = new Map(DEFAULT_WIZARD_STEP_METADATA.map((entry) => [entry.id, entry]))

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    return value.trim()
}

const normalizeOptionalString = (value) => {
    if (value == null) {
        return null
    }

    const normalized = normalizeString(value)
    return normalized || null
}

const normalizeIsoString = (value) => {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    return trimmed
}

const normalizeBoolean = (value, fallback = false) => {
    if (value === true) {
        return true
    }

    if (value === false) {
        return false
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'yes', 'completed', 'done'].includes(normalized)) {
            return true
        }
        if (['false', '0', 'no', 'pending'].includes(normalized)) {
            return false
        }
    }

    return fallback
}

const normalizeWizardStepCapabilities = (value, fallback = []) => {
    if (!Array.isArray(value)) {
        return Array.isArray(fallback) ? [...fallback] : []
    }

    const normalized = []
    const seen = new Set()
    for (const entry of value) {
        if (typeof entry !== 'string') {
            continue
        }
        const trimmed = entry.trim()
        if (!trimmed || seen.has(trimmed)) {
            continue
        }
        normalized.push(trimmed)
        seen.add(trimmed)
    }

    if (normalized.length === 0 && Array.isArray(fallback)) {
        return [...fallback]
    }

    return normalized
}

const cloneStepMetadata = (step) => ({
    ...step,
    capabilities: Array.isArray(step?.capabilities) ? [...step.capabilities] : [],
})

export const normalizeWizardStepMetadataEntry = (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
        return null
    }

    const rawId = normalizeString(candidate.id)
    if (!STEP_SET.has(rawId)) {
        return null
    }

    const defaults = DEFAULT_STEP_METADATA_MAP.get(rawId) || {
        id: rawId,
        title: rawId,
        description: rawId,
        optional: false,
        icon: null,
        capabilities: [],
    }

    return {
        id: rawId,
        title: normalizeString(candidate.title) || defaults.title,
        description: normalizeString(candidate.description) || defaults.description,
        optional: normalizeBoolean(candidate.optional, defaults.optional ?? false),
        icon: normalizeOptionalString(candidate.icon) ?? defaults.icon ?? null,
        capabilities: normalizeWizardStepCapabilities(candidate.capabilities, defaults.capabilities ?? []),
    }
}

const normalizeWizardStepMetadataList = (input) => {
    const overrides = new Map()
    if (Array.isArray(input)) {
        for (const entry of input) {
            const normalized = normalizeWizardStepMetadataEntry(entry)
            if (normalized) {
                overrides.set(normalized.id, normalized)
            }
        }
    }

    return WIZARD_STEP_KEYS.map((key) => {
        const defaults = DEFAULT_STEP_METADATA_MAP.get(key)
        const override = overrides.get(key)
        if (!defaults && !override) {
            return null
        }

        if (!override) {
            return cloneStepMetadata(defaults)
        }

        const merged = {
            ...cloneStepMetadata(defaults || override),
            ...override,
        }

        if (!override.capabilities || override.capabilities.length === 0) {
            merged.capabilities = cloneStepMetadata(defaults || { capabilities: [] }).capabilities
        }

        if (override.icon == null && defaults) {
            merged.icon = defaults.icon ?? null
        }

        return merged
    }).filter(Boolean)
}

const splitFeatureFlagEntries = (value) => {
    if (typeof value !== 'string') {
        return []
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return []
    }

    return trimmed
        .split(',')
        .map((segment) => segment.trim())
        .filter(Boolean)
}

export const normalizeWizardFeatureFlags = (input) => {
    if (input == null) {
        return {}
    }

    if (typeof input === 'string') {
        const trimmed = input.trim()
        if (!trimmed) {
            return {}
        }

        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed)
                return normalizeWizardFeatureFlags(parsed)
            } catch {
                return {}
            }
        }

        const entries = splitFeatureFlagEntries(trimmed)
        if (entries.length === 0) {
            return {}
        }

        const flags = {}
        for (const entry of entries) {
            const [rawKey, rawValue] = entry.split(/[:=]/, 2)
            const key = typeof rawKey === 'string' ? rawKey.trim() : ''
            if (!key) {
                continue
            }
            flags[key] = normalizeBoolean(rawValue ?? true, true)
        }
        return flags
    }

    if (typeof input === 'object') {
        const flags = {}
        for (const [rawKey, rawValue] of Object.entries(input)) {
            if (typeof rawKey !== 'string') {
                continue
            }
            const key = rawKey.trim()
            if (!key) {
                continue
            }
            flags[key] = normalizeBoolean(rawValue, true)
        }
        return flags
    }

    return {}
}

export const normalizeWizardMetadata = (input = {}) => {
    const steps = normalizeWizardStepMetadataList(input?.steps ?? input?.definitions)
    const featureSource =
        input?.featureFlags ?? input?.features ?? input?.flags ?? input?.featureFlag ?? null
    const features = normalizeWizardFeatureFlags(featureSource)

    if (steps.length === 0) {
        return {
            steps: DEFAULT_WIZARD_STEP_METADATA.map(cloneStepMetadata),
            features,
        }
    }

    return { steps, features }
}

export const createDefaultWizardMetadata = () => ({
    steps: DEFAULT_WIZARD_STEP_METADATA.map(cloneStepMetadata),
    features: {},
})

export const normalizeWizardStatus = (status) => {
    if (typeof status !== 'string') {
        return 'pending'
    }

    const normalized = status.trim().toLowerCase()
    return STATUS_SET.has(normalized) ? normalized : 'pending'
}

export const normalizeWizardStepState = (candidate = {}) => {
    const status = normalizeWizardStatus(candidate?.status)

    return {
        status,
        detail: normalizeOptionalString(candidate?.detail),
        error: normalizeOptionalString(candidate?.error),
        updatedAt: normalizeIsoString(candidate?.updatedAt),
        completedAt: normalizeIsoString(candidate?.completedAt),
    }
}

export const createDefaultWizardStepState = () => ({
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
})

export const normalizeWizardState = (candidate = {}) => {
    const state = {
        version: Number.isFinite(candidate?.version) ? candidate.version : WIZARD_STATE_VERSION,
        updatedAt: normalizeIsoString(candidate?.updatedAt),
        completed: normalizeBoolean(candidate?.completed, false),
    }

    for (const step of WIZARD_STEP_KEYS) {
        const stepState = candidate && typeof candidate === 'object' ? candidate[step] : null
        state[step] = stepState ? normalizeWizardStepState(stepState) : createDefaultWizardStepState()
    }

    return state
}

export const createDefaultWizardState = () => {
    const now = new Date().toISOString()
    const state = normalizeWizardState({})

    state.updatedAt = now
    state.completed = false
    for (const step of WIZARD_STEP_KEYS) {
        state[step].status = 'pending'
        state[step].updatedAt = now
        state[step].detail = null
        state[step].error = null
        state[step].completedAt = null
    }

    return state
}

export const normalizeWizardStepUpdate = (input) => {
    if (!input || typeof input !== 'object') {
        throw new SetupValidationError('Wizard state updates must be provided as objects.')
    }

    const rawStep = normalizeString(input.step)
    if (!STEP_SET.has(rawStep)) {
        throw new SetupValidationError('Wizard state updates must include a valid "step".')
    }

    const update = { step: rawStep }

    if (input.status !== undefined) {
        const status = normalizeString(input.status)
        if (!STATUS_SET.has(status)) {
            throw new SetupValidationError(`Unsupported wizard status: ${input.status}`)
        }
        update.status = status
    }

    if (Object.prototype.hasOwnProperty.call(input, 'detail')) {
        update.detail = normalizeOptionalString(input.detail)
    }

    if (Object.prototype.hasOwnProperty.call(input, 'error')) {
        update.error = normalizeOptionalString(input.error)
    }

    if (Object.prototype.hasOwnProperty.call(input, 'completedAt')) {
        const completedAt = input.completedAt == null ? null : normalizeIsoString(input.completedAt)
        if (input.completedAt != null && !completedAt) {
            throw new SetupValidationError('completedAt must be an ISO date string or null.')
        }
        update.completedAt = completedAt
    }

    if (Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
        const updatedAt = input.updatedAt == null ? null : normalizeIsoString(input.updatedAt)
        if (input.updatedAt != null && !updatedAt) {
            throw new SetupValidationError('updatedAt must be an ISO date string or null.')
        }
        update.updatedAt = updatedAt
    }

    return update
}

export const normalizeWizardStateUpdates = (input) => {
    if (input == null) {
        return []
    }

    const candidates = Array.isArray(input) ? input : [input]

    return candidates.map((entry) => normalizeWizardStepUpdate(entry))
}

export const applyWizardStateUpdates = (state, updatesInput) => {
    const base = normalizeWizardState(state)
    const updates = normalizeWizardStateUpdates(updatesInput)

    if (updates.length === 0) {
        return { state: base, changed: false }
    }

    const next = {
        version: base.version,
        updatedAt: base.updatedAt,
        completed: base.completed,
    }

    for (const step of WIZARD_STEP_KEYS) {
        next[step] = { ...base[step] }
    }

    let changed = false
    const now = new Date().toISOString()

    for (const update of updates) {
        const current = next[update.step]
        let stepChanged = false

        if (update.status && update.status !== current.status) {
            current.status = update.status
            stepChanged = true

            if (update.status === 'complete' && update.completedAt === undefined) {
                current.completedAt = now
            }

            if (update.status !== 'complete' && update.completedAt === undefined) {
                current.completedAt = null
            }
        }

        if (update.detail !== undefined && update.detail !== current.detail) {
            current.detail = update.detail
            stepChanged = true
        }

        if (update.error !== undefined && update.error !== current.error) {
            current.error = update.error
            stepChanged = true
        }

        if (update.completedAt !== undefined) {
            current.completedAt = update.completedAt
            stepChanged = true
        }

        if (update.updatedAt !== undefined) {
            current.updatedAt = update.updatedAt
            stepChanged = true
        } else if (stepChanged) {
            current.updatedAt = now
        }

        if (stepChanged) {
            changed = true
        }
    }

    if (changed) {
        next.updatedAt = now
    }

    return { state: changed ? next : base, changed }
}

export const resolveWizardStateOperation = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new SetupValidationError('Request body must be a JSON object.')
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'state')) {
        const state = normalizeWizardState(payload.state)
        return { type: 'replace', state }
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'updates')) {
        throw new SetupValidationError('Request body must include either "state" or "updates".')
    }

    const updates = normalizeWizardStateUpdates(payload.updates)

    if (updates.length === 0) {
        throw new SetupValidationError('updates must be a non-empty array of wizard state changes.')
    }

    return { type: 'update', updates }
}

export default {
    WIZARD_STATE_VERSION,
    WIZARD_STEP_KEYS,
    WIZARD_STATUS_VALUES,
    DEFAULT_WIZARD_STATE_KEY,
    DEFAULT_WIZARD_STEP_METADATA,
    createDefaultWizardState,
    createDefaultWizardStepState,
    createDefaultWizardMetadata,
    normalizeWizardState,
    normalizeWizardStatus,
    normalizeWizardStepState,
    normalizeWizardStepUpdate,
    normalizeWizardStateUpdates,
    normalizeWizardFeatureFlags,
    normalizeWizardMetadata,
    normalizeWizardStepMetadataEntry,
    applyWizardStateUpdates,
    resolveWizardStateOperation,
}
