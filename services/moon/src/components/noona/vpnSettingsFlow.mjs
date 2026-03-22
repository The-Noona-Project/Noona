const normalizeString = (value) => (typeof value === "string" ? value.trim() : "")

const VPN_BUSY_CONNECTION_STATES = new Set(["connecting", "rotating"])

export const DEFAULT_VPN_ROTATION_TIMEOUT_MS = 120_000
export const DEFAULT_VPN_ROTATION_POLL_MS = 1_500

/**
 * @typedef {{
 *   enabled?: boolean | null,
 *   onlyDownloadWhenVpnOn?: boolean | null,
 *   autoRotate?: boolean | null,
 *   rotateEveryMinutes?: number | string | null,
 *   region?: string | null,
 *   piaUsername?: string | null,
 *   piaPassword?: string | null,
 *   passwordConfigured?: boolean | null,
 * }} VpnDraftInput
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   onlyDownloadWhenVpnOn: boolean,
 *   autoRotate: boolean,
 *   rotateEveryMinutes: number | null,
 *   region: string,
 *   piaUsername: string,
 *   piaPassword: string,
 *   passwordConfigured: boolean,
 * }} VpnDraftSnapshot
 */

export const isVpnRuntimeBusy = (status = null) => {
    const connectionState = normalizeString(status?.connectionState).toLowerCase()
    return status?.rotating === true || VPN_BUSY_CONNECTION_STATES.has(connectionState)
}

/**
 * @param {{
 *   status?: { connectionState?: string | null, rotating?: boolean } | null,
 *   loading?: boolean,
 *   saving?: boolean,
 *   rotating?: boolean,
 *   testing?: boolean,
 * }} [options]
 */
export const shouldDisableVpnControls = ({
                                             status,
                                             loading = false,
                                             saving = false,
                                             rotating = false,
                                             testing = false,
                                         } = {}) => loading || saving || rotating || testing || isVpnRuntimeBusy(status)

export const resolveVpnMessageAfterRefresh = (currentMessage, preserveMessage = false) =>
    preserveMessage ? (currentMessage ?? null) : null

/**
 * @param {VpnDraftInput} [draft]
 * @returns {VpnDraftSnapshot}
 */
export const createVpnDraftSnapshot = ({
                                           enabled = false,
                                           onlyDownloadWhenVpnOn = false,
                                           autoRotate = true,
                                           rotateEveryMinutes = null,
                                           region = "",
                                           piaUsername = "",
                                           piaPassword = "",
                                           passwordConfigured = false,
                                       } = {}) => {
    const normalizedRotateEveryMinutes = Number(rotateEveryMinutes)
    return {
        enabled: enabled === true,
        onlyDownloadWhenVpnOn: onlyDownloadWhenVpnOn === true,
        autoRotate: autoRotate !== false,
        rotateEveryMinutes:
            Number.isFinite(normalizedRotateEveryMinutes) && normalizedRotateEveryMinutes > 0
                ? Math.floor(normalizedRotateEveryMinutes)
                : null,
        region: normalizeString(region),
        piaUsername: normalizeString(piaUsername),
        piaPassword: typeof piaPassword === "string" ? piaPassword : "",
        passwordConfigured: passwordConfigured === true,
    }
}

/**
 * @param {VpnDraftInput | null} [left]
 * @param {VpnDraftInput | null} [right]
 */
export const areVpnDraftsEqual = (left = null, right = null) => {
    const normalizedLeft = createVpnDraftSnapshot(left ?? {})
    const normalizedRight = createVpnDraftSnapshot(right ?? {})
    return normalizedLeft.enabled === normalizedRight.enabled
        && normalizedLeft.onlyDownloadWhenVpnOn === normalizedRight.onlyDownloadWhenVpnOn
        && normalizedLeft.autoRotate === normalizedRight.autoRotate
        && normalizedLeft.rotateEveryMinutes === normalizedRight.rotateEveryMinutes
        && normalizedLeft.region === normalizedRight.region
        && normalizedLeft.piaUsername === normalizedRight.piaUsername
        && normalizedLeft.piaPassword === normalizedRight.piaPassword
        && normalizedLeft.passwordConfigured === normalizedRight.passwordConfigured
}

/**
 * @param {{
 *   draft?: VpnDraftInput,
 *   applyNow?: boolean,
 *   triggeredBy?: string | null,
 * }} [options]
 */
export const buildVpnSaveRequestBody = ({
                                            draft = {},
                                            applyNow = false,
                                            triggeredBy = "",
                                        } = {}) => {
    const normalizedDraft = createVpnDraftSnapshot(draft)
    return {
        enabled: normalizedDraft.enabled,
        onlyDownloadWhenVpnOn: normalizedDraft.onlyDownloadWhenVpnOn,
        autoRotate: normalizedDraft.autoRotate,
        rotateEveryMinutes: normalizedDraft.rotateEveryMinutes,
        region: normalizedDraft.region,
        piaUsername: normalizedDraft.piaUsername,
        piaPassword: normalizedDraft.piaPassword,
        applyNow: applyNow === true,
        triggeredBy: normalizeString(triggeredBy) || "manual",
    }
}

/**
 * @param {{
 *   draft?: VpnDraftInput,
 *   triggeredBy?: string | null,
 * }} [options]
 */
export const buildVpnRotateRequestBody = ({
                                              draft = {},
                                              triggeredBy = "",
                                          } = {}) => {
    const normalizedDraft = createVpnDraftSnapshot(draft)
    return {
        enabled: normalizedDraft.enabled,
        onlyDownloadWhenVpnOn: normalizedDraft.onlyDownloadWhenVpnOn,
        autoRotate: normalizedDraft.autoRotate,
        rotateEveryMinutes: normalizedDraft.rotateEveryMinutes,
        region: normalizedDraft.region,
        piaUsername: normalizedDraft.piaUsername,
        piaPassword: normalizedDraft.piaPassword,
        triggeredBy: normalizeString(triggeredBy) || "manual",
    }
}

/**
 * @param {unknown} [value]
 * @returns {boolean}
 */
export const hasVpnSettingsSnapshot = (value = null) =>
    value != null
    && typeof value === "object"
    && (
        value.key === "downloads.vpn"
        || typeof value.enabled === "boolean"
        || typeof value.onlyDownloadWhenVpnOn === "boolean"
        || typeof value.autoRotate === "boolean"
        || value.rotateEveryMinutes != null
        || typeof value.region === "string"
        || typeof value.piaUsername === "string"
        || typeof value.updatedAt === "string"
        || value.passwordConfigured === true
    )

export const formatVpnRotationOutcomeMessage = (status = null, fallback = "VPN rotation complete.") => {
    const safeFallback = normalizeString(fallback) || "VPN rotation complete."
    const error = normalizeString(status?.lastError)
    if (error) {
        return `VPN rotation failed: ${error}`
    }

    const details = []
    const region = normalizeString(status?.region)
    const publicIp = normalizeString(status?.publicIp)

    if (region) {
        details.push(`region ${region}`)
    }
    if (publicIp) {
        details.push(`public IP ${publicIp}`)
    }

    if (details.length === 0) {
        return safeFallback
    }

    return `${safeFallback} (${details.join(", ")})`
}

/**
 * @param {{
 *   ok?: boolean,
 *   message?: string | null,
 *   error?: string | null,
 *   region?: string | null,
 *   endpoint?: string | null,
 *   reportedIp?: string | null,
 * } | null} [result]
 * @param {string} [fallbackRegion]
 */
export const formatVpnLoginOutcomeMessage = (result = null, fallbackRegion = "") => {
    if (result?.ok === false) {
        return normalizeString(result?.error) || normalizeString(result?.message) || "VPN login test failed."
    }

    const message = normalizeString(result?.message) || "PIA login succeeded."
    const region = normalizeString(result?.region)
    const endpoint = normalizeString(result?.endpoint)
    const locationDetail = endpoint ? `${region || fallbackRegion} (${endpoint})` : (region || fallbackRegion)

    if (!locationDetail) {
        return message
    }

    return `${message} ${locationDetail}`
}

/**
 * @param {{
 *   refresh: () => Promise<any>,
 *   isBusy?: (status?: any) => boolean,
 *   timeoutMs?: number,
 *   pollMs?: number,
 * }} [options]
 */
export const waitForVpnRuntimeToSettle = async ({
                                                    refresh,
                                                    isBusy = isVpnRuntimeBusy,
                                                    timeoutMs = DEFAULT_VPN_ROTATION_TIMEOUT_MS,
                                                    pollMs = DEFAULT_VPN_ROTATION_POLL_MS,
                                                } = {}) => {
    if (typeof refresh !== "function") {
        throw new Error("A VPN refresh function is required.")
    }

    const deadline = Date.now() + Math.max(1, Math.floor(timeoutMs))
    let snapshot = await refresh()

    while (snapshot && isBusy(snapshot?.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(pollMs))))
        snapshot = await refresh()
    }

    if (!snapshot) {
        throw new Error("Failed to refresh VPN settings while waiting for rotation to finish.")
    }

    if (isBusy(snapshot?.status)) {
        throw new Error("Timed out while waiting for Raven VPN rotation to finish.")
    }

    return snapshot
}
