const MONITOR_DETAIL_MAX_LENGTH = 180

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')

const looksLikeHtml = (value) =>
    /<(?:!doctype|html|head|body|style|script)\b/i.test(value)
    || (/<[a-z][\s\S]*>/i.test(value) && /<\/[a-z]/i.test(value))

export const summarizeMonitorMessage = (
    value,
    {
        fallback = 'Waiting for the next health probe.',
        htmlFallback = 'Received an HTML page instead of a dedicated health response.',
        maxLength = MONITOR_DETAIL_MAX_LENGTH,
    } = {},
) => {
    const compact = normalizeString(value).replace(/\s+/g, ' ')
    if (!compact) {
        return fallback
    }

    if (looksLikeHtml(compact)) {
        return htmlFallback
    }

    return compact.length > maxLength
        ? `${compact.slice(0, maxLength - 3).trimEnd()}...`
        : compact
}

export const describeReturnTarget = (value) => {
    const normalized = normalizeString(value)
    if (!normalized || normalized === '/') {
        return 'Home'
    }

    if (normalized.startsWith('/downloads')) {
        return 'Downloads'
    }

    if (normalized.startsWith('/library')) {
        return 'Library'
    }

    if (normalized.startsWith('/settings/warden')) {
        return 'Admin -> System'
    }

    if (normalized.startsWith('/login')) {
        return 'Login'
    }

    return normalized
}
