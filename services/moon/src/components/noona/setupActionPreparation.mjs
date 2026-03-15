const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * @typedef {object} SetupActionPreparationPlan
 * @property {boolean} persistSnapshot
 * @property {boolean} provisionManagedKavita
 * @property {boolean} persistDiscordAuth
 */

/**
 * @typedef {object} SetupSnapshotOverrides
 * @property {string} kavitaApiKey
 * @property {string} kavitaBaseUrl
 */

/**
 * @typedef {object} SetupKavitaState
 * @property {string} [apiKey]
 * @property {string} [baseUrl]
 */

/**
 * @typedef {object} ExecuteSetupActionPreparationOptions
 * @property {string} [action]
 * @property {SetupKavitaState} [currentKavita]
 * @property {(() => Promise<SetupKavitaState | null>) | undefined} [provisionManagedKavitaServiceKey]
 * @property {(() => Promise<void>) | undefined} [persistDiscordAuthConfig]
 * @property {((overrides: SetupSnapshotOverrides) => Promise<unknown>) | undefined} [persistSetupConfigSnapshot]
 * @property {boolean} [allowNonFatalWarnings]
 */

export const SETUP_ACTION_INSTALL = "install";
export const SETUP_ACTION_SUMMARY = "summary";

const normalizeErrorMessage = (error) => {
    if (error instanceof Error) {
        return error.message.trim();
    }

    return normalizeString(error);
};

const buildPreparationWarning = (label, error) => {
    const detail = normalizeErrorMessage(error) || "Unknown error.";
    return `${label} warning: ${detail}`;
};

/**
 * @param {string} action
 * @returns {SetupActionPreparationPlan}
 */
export const resolveSetupActionPreparation = (action) => {
    const normalizedAction = normalizeString(action).toLowerCase();

    return {
        persistSnapshot: true,
        provisionManagedKavita: normalizedAction === SETUP_ACTION_SUMMARY,
        persistDiscordAuth: normalizedAction === SETUP_ACTION_SUMMARY,
    };
};

/**
 * @param {{currentKavita?: SetupKavitaState, managedKavita?: SetupKavitaState | null}} [options]
 * @returns {SetupSnapshotOverrides}
 */
export const resolveSetupSnapshotOverrides = ({
                                                  currentKavita = {},
                                                  managedKavita = null,
                                              } = {}) => ({
    kavitaApiKey: normalizeString(managedKavita?.apiKey) || normalizeString(currentKavita?.apiKey),
    kavitaBaseUrl: normalizeString(managedKavita?.baseUrl) || normalizeString(currentKavita?.baseUrl),
});

/**
 * @param {ExecuteSetupActionPreparationOptions} [options]
 */
export const executeSetupActionPreparation = async ({
                                                        action,
                                                        currentKavita = {},
                                                        provisionManagedKavitaServiceKey,
                                                        persistDiscordAuthConfig,
                                                        persistSetupConfigSnapshot,
                                                        allowNonFatalWarnings = false,
                                                    } = {}) => {
    if (typeof persistSetupConfigSnapshot !== "function") {
        throw new TypeError("persistSetupConfigSnapshot is required.");
    }

    const plan = resolveSetupActionPreparation(action);
    let managedKavita = null;
    const warnings = [];

    if (plan.provisionManagedKavita) {
        if (typeof provisionManagedKavitaServiceKey !== "function") {
            throw new TypeError("provisionManagedKavitaServiceKey is required for this setup action.");
        }

        try {
            managedKavita = await provisionManagedKavitaServiceKey();
        } catch (error) {
            if (!allowNonFatalWarnings) {
                throw error;
            }

            warnings.push(buildPreparationWarning("Managed Kavita sync", error));
        }
    }

    if (plan.persistDiscordAuth) {
        if (typeof persistDiscordAuthConfig !== "function") {
            throw new TypeError("persistDiscordAuthConfig is required for this setup action.");
        }

        try {
            await persistDiscordAuthConfig();
        } catch (error) {
            if (!allowNonFatalWarnings) {
                throw error;
            }

            warnings.push(buildPreparationWarning("Discord sync", error));
        }
    }

    const overrides = resolveSetupSnapshotOverrides({currentKavita, managedKavita});
    const snapshotResult = await persistSetupConfigSnapshot(overrides);

    return {
        managedKavita,
        overrides,
        plan,
        snapshotResult,
        warnings,
    };
};
