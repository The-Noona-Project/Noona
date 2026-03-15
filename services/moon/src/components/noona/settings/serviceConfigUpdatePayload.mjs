const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const normalizeKey = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    return value.trim()
}

const isEditableEnvField = (field) => {
    const key = normalizeKey(field?.key)
    if (!key) {
        return false
    }

    return field.readOnly !== true && field.serverManaged !== true
}

export const buildEditableServiceConfigEnvPayload = (envConfig, envDraft = {}) => {
    const fields = Array.isArray(envConfig) ? envConfig : []
    const draft = envDraft && typeof envDraft === 'object' && !Array.isArray(envDraft) ? envDraft : {}
    const env = {}
    const seen = new Set()

    for (const field of fields) {
        const key = normalizeKey(field?.key)
        if (!key || seen.has(key)) {
            continue
        }

        seen.add(key)
        if (!isEditableEnvField(field) || !hasOwn(draft, key)) {
            continue
        }

        env[key] = draft[key] == null ? '' : String(draft[key])
    }

    return env
}

export const buildServiceConfigUpdatePayload = ({
                                                    envConfig,
                                                    envDraft,
                                                    hostPort,
                                                    restart,
                                                } = {}) => ({
    env: buildEditableServiceConfigEnvPayload(envConfig, envDraft),
    hostPort,
    restart,
})
