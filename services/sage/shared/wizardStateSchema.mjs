// services/sage/shared/wizardStateSchema.mjs

import { SetupValidationError } from './errors.mjs'

export const WIZARD_STATE_VERSION = 1
export const WIZARD_STEP_KEYS = Object.freeze(['foundation', 'portal', 'raven', 'verification'])
export const WIZARD_STATUS_VALUES = Object.freeze(['pending', 'in-progress', 'complete', 'error', 'skipped'])
export const DEFAULT_WIZARD_STATE_KEY = 'noona:wizard:state'

const STATUS_SET = new Set(WIZARD_STATUS_VALUES)
const STEP_SET = new Set(WIZARD_STEP_KEYS)

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
    createDefaultWizardState,
    createDefaultWizardStepState,
    normalizeWizardState,
    normalizeWizardStatus,
    normalizeWizardStepState,
    normalizeWizardStepUpdate,
    normalizeWizardStateUpdates,
    applyWizardStateUpdates,
    resolveWizardStateOperation,
}
