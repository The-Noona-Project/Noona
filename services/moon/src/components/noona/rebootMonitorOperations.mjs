const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')

const normalizeServiceList = (values) => {
    if (!Array.isArray(values)) {
        return []
    }

    const out = []
    const seen = new Set()
    for (const value of values) {
        const normalized = normalizeString(value)
        if (!normalized || seen.has(normalized)) {
            continue
        }

        seen.add(normalized)
        out.push(normalized)
    }

    return out
}

export const REBOOT_MONITOR_OPERATION_UPDATE_SERVICES = 'update-services'
export const REBOOT_MONITOR_OPERATION_BOOT_START = 'boot-start'
export const REBOOT_MONITOR_OPERATION_ECOSYSTEM_START = 'ecosystem-start'
export const REBOOT_MONITOR_OPERATION_ECOSYSTEM_RESTART = 'ecosystem-restart'

const VALID_REBOOT_MONITOR_OPERATIONS = new Set([
    REBOOT_MONITOR_OPERATION_UPDATE_SERVICES,
    REBOOT_MONITOR_OPERATION_BOOT_START,
    REBOOT_MONITOR_OPERATION_ECOSYSTEM_START,
    REBOOT_MONITOR_OPERATION_ECOSYSTEM_RESTART,
])

const ALWAYS_REQUIRED_SERVICES = Object.freeze(['noona-warden', 'noona-sage', 'noona-moon'])
const DATA_LIFECYCLE_SERVICES = Object.freeze(['noona-mongo', 'noona-redis', 'noona-vault'])

export const normalizeRebootMonitorOperation = (value) => {
    const normalized = normalizeString(value)
    return VALID_REBOOT_MONITOR_OPERATIONS.has(normalized)
        ? normalized
        : REBOOT_MONITOR_OPERATION_UPDATE_SERVICES
}

export const resolveRebootMonitorRequiredServices = (targetServices = []) => {
    const targetSet = new Set(normalizeServiceList(targetServices))
    return [
        ...ALWAYS_REQUIRED_SERVICES,
        ...DATA_LIFECYCLE_SERVICES.filter((service) => targetSet.has(service)),
    ]
}

export const resolveRebootMonitorMonitoredServices = (targetServices = []) =>
    Array.from(
        new Set([
            ...resolveRebootMonitorRequiredServices(targetServices),
            ...normalizeServiceList(targetServices),
        ]),
    )

const normalizeRequestBody = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

export const resolveRebootMonitorRequest = (operation, requestMetadata = {}) => {
    switch (normalizeRebootMonitorOperation(operation)) {
        case REBOOT_MONITOR_OPERATION_BOOT_START:
            return {
                path: '/api/noona/boot/start',
                method: 'POST',
                body: normalizeRequestBody(requestMetadata?.body),
            }
        case REBOOT_MONITOR_OPERATION_ECOSYSTEM_START:
            return {
                path: '/api/noona/settings/ecosystem/start',
                method: 'POST',
                body: normalizeRequestBody(requestMetadata?.body),
            }
        case REBOOT_MONITOR_OPERATION_ECOSYSTEM_RESTART:
            return {
                path: '/api/noona/settings/ecosystem/restart',
                method: 'POST',
                body: normalizeRequestBody(requestMetadata?.body),
            }
        default:
            return null
    }
}
