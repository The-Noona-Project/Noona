const RETRYABLE_BACKEND_READ_STATUSES = new Set([502, 503, 504]);

export const DEFAULT_BACKEND_READ_RETRY_ATTEMPTS = 3;
export const DEFAULT_BACKEND_READ_RETRY_DELAY_MS = 500;

const waitForRetryDelay = (delayMs) =>
    new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });

const normalizeAttempts = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_BACKEND_READ_RETRY_ATTEMPTS;
    }
    return Math.max(1, Math.floor(parsed));
};

const normalizeDelayMs = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_BACKEND_READ_RETRY_DELAY_MS;
    }
    return Math.max(0, Math.floor(parsed));
};

export const isRetryableBackendReadStatus = (status) => RETRYABLE_BACKEND_READ_STATUSES.has(Number(status));

export const retryBackendRead = async (
    read,
    {
        attempts = DEFAULT_BACKEND_READ_RETRY_ATTEMPTS,
        delayMs = DEFAULT_BACKEND_READ_RETRY_DELAY_MS,
        shouldRetryStatus = isRetryableBackendReadStatus,
        shouldRetryError = () => true,
    } = {},
) => {
    if (typeof read !== "function") {
        throw new TypeError("A read function is required for backend retry.");
    }

    const totalAttempts = normalizeAttempts(attempts);
    const retryDelayMs = normalizeDelayMs(delayMs);
    let lastResult = null;
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            const result = await read({attempt, totalAttempts});
            if (!result || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, "status")) {
                return result;
            }

            if (!shouldRetryStatus(result.status) || attempt >= totalAttempts) {
                return result;
            }

            lastResult = result;
        } catch (error) {
            if (!shouldRetryError(error) || attempt >= totalAttempts) {
                throw error;
            }

            lastError = error;
        }

        if (attempt < totalAttempts) {
            await waitForRetryDelay(retryDelayMs);
        }
    }

    if (lastResult) {
        return lastResult;
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error("Backend read retry completed without a result.");
};

export default retryBackendRead;
