const normalizeString = (value) => (typeof value === 'string' ? value : '')

export const normalizeServiceNameList = (values) => {
    if (!Array.isArray(values)) {
        return []
    }

    const out = []
    const seen = new Set()
    for (const value of values) {
        const normalized = normalizeString(value).trim()
        if (!normalized || seen.has(normalized)) {
            continue
        }

        seen.add(normalized)
        out.push(normalized)
    }

    return out
}

export const normalizeSetupSelectionMode = (value) => {
    const normalized = normalizeString(value).trim().toLowerCase()
    return normalized === 'minimal' || normalized === 'selected' || normalized === 'unspecified'
        ? normalized
        : 'unspecified'
}

export const normalizeSetupStatus = (value) => {
    const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    return {
        completed: payload.completed === true,
        configured: payload.configured === true,
        installing: payload.installing === true,
        debugEnabled: payload.debugEnabled === true,
        selectionMode: normalizeSetupSelectionMode(payload.selectionMode),
        selectedServices: normalizeServiceNameList(payload.selectedServices),
        lifecycleServices: normalizeServiceNameList(payload.lifecycleServices),
        manualBootRequired: payload.manualBootRequired === true,
        error: normalizeString(payload.error).trim(),
    }
}

export const normalizeBootScreenReturnTo = (value, fallback = '/') => {
    const candidate = normalizeString(value).trim()
    return candidate.startsWith('/') ? candidate : fallback
}

export const buildBootScreenHref = (returnTo = '/') => {
    const normalizedReturnTo = normalizeBootScreenReturnTo(returnTo, '/')
    const params = new URLSearchParams({returnTo: normalizedReturnTo})
    return `/bootScreen?${params.toString()}`
}

export const hasManualBootPending = (value) => normalizeSetupStatus(value).manualBootRequired === true
