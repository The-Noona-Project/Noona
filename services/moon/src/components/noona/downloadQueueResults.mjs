const ACCEPTED_HTTP_STATUSES = new Set([202])
const ACCEPTED_QUEUE_STATUSES = new Set(['queued', 'partial'])

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * @typedef {{
 *   status?: string | null,
 *   message?: string | null,
 *   error?: string | null,
 * }} RavenQueuePayload
 */

/**
 * @typedef {{
 *   httpStatus?: number,
 *   payload?: RavenQueuePayload | null,
 *   fallbackMessage?: string,
 * }} RavenQueueResponseInput
 */

/**
 * @typedef {{
 *   accepted: boolean,
 *   queueStatus: string,
 *   message: string,
 * }} RavenQueueInterpretation
 */

/**
 * @param {RavenQueueResponseInput} input
 * @returns {RavenQueueInterpretation}
 */
export const interpretRavenQueueResponse = ({
                                                httpStatus,
                                                payload,
                                                fallbackMessage = 'Queue failed.',
                                            } = {}) => {
    const queueStatus = normalizeString(payload?.status)
    const payloadMessage =
        normalizeString(payload?.message) ||
        normalizeString(payload?.error)

    return {
        accepted: ACCEPTED_HTTP_STATUSES.has(Number(httpStatus)) && ACCEPTED_QUEUE_STATUSES.has(queueStatus),
        queueStatus,
        message: payloadMessage || fallbackMessage,
    }
}
