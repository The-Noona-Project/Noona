const SETUP_SUMMARY_SESSION_STORAGE_KEY = "noona:setup-summary";

/**
 * @typedef {{
 *     warnings: string[]
 * }} SetupSummarySession
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");
const isBrowser = () => typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const normalizeWarnings = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();
    /** @type {string[]} */
    const warnings = [];
    for (const candidate of value) {
        const warning = normalizeString(candidate);
        if (!warning || seen.has(warning)) {
            continue;
        }

        seen.add(warning);
        warnings.push(warning);
    }

    return warnings;
};

/**
 * @returns {SetupSummarySession | null}
 */
export const readSetupSummarySession = () => {
    if (!isBrowser()) {
        return null;
    }

    try {
        const raw = window.sessionStorage.getItem(SETUP_SUMMARY_SESSION_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        const warnings = normalizeWarnings(parsed?.warnings);
        if (warnings.length === 0) {
            return null;
        }

        return {warnings};
    } catch {
        return null;
    }
};

/**
 * @param {{warnings?: readonly unknown[]} | undefined} [session]
 * @returns {void}
 */
export const writeSetupSummarySession = (session = {}) => {
    if (!isBrowser()) {
        return;
    }

    const {warnings = []} = session;
    const normalizedWarnings = normalizeWarnings(warnings);
    if (normalizedWarnings.length === 0) {
        clearSetupSummarySession();
        return;
    }

    try {
        window.sessionStorage.setItem(
            SETUP_SUMMARY_SESSION_STORAGE_KEY,
            JSON.stringify({warnings: normalizedWarnings}),
        );
    } catch {
        // Ignore storage failures so summary navigation can continue.
    }
};

/**
 * @returns {void}
 */
export const clearSetupSummarySession = () => {
    if (!isBrowser()) {
        return;
    }

    try {
        window.sessionStorage.removeItem(SETUP_SUMMARY_SESSION_STORAGE_KEY);
    } catch {
        // Ignore cleanup failures so the summary page can still render.
    }
};

/**
 * @returns {SetupSummarySession | null}
 */
export const consumeSetupSummarySession = () => {
    const session = readSetupSummarySession();
    clearSetupSummarySession();
    return session;
};
