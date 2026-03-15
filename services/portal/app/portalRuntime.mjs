/**
 * @fileoverview Coordinates Portal startup, dependency wiring, optional Discord boot, and shutdown.
 * Related files:
 * - app/createPortalApp.mjs
 * - config/portalConfig.mjs
 * - discord/client.mjs
 * - clients/kavitaClient.mjs
 * Times this file has been edited: 20
 */

import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import {startPortalServer} from './createPortalApp.mjs';
import createKavitaClient from '../clients/kavitaClient.mjs';
import createKomfClient from '../clients/komfClient.mjs';
import createPortalRavenClient from '../clients/ravenClient.mjs';
import createVaultClient from '../clients/vaultClient.mjs';
import createPortalWardenClient from '../clients/wardenClient.mjs';
import {safeLoadPortalConfig} from '../config/portalConfig.mjs';
import {createDiscordClient} from '../discord/client.mjs';
import {createDirectMessageHandler} from '../discord/directMessageRouter.mjs';
import {createDiscordPresenceUpdater} from '../discord/presenceUpdater.mjs';
import {createRecommendationNotifier} from '../discord/recommendationNotifier.mjs';
import {createSubscriptionNotifier} from '../discord/subscriptionNotifier.mjs';
import {createPortalSlashCommands} from '../commands/index.mjs';

const runtime = {
    closeServer: null,
    config: null,
    discord: null,
    discordStatus: null,
    kavita: null,
    komf: null,
    onboardingStore: null,
    presenceUpdater: null,
    recommendationNotifier: null,
    subscriptionNotifier: null,
    raven: null,
    server: null,
    vault: null,
    warden: null,
};

/**
 * Resolves the onboarding-store factory without importing Redis-backed code during tests unless needed.
 *
 * @param {Function|null|undefined} override - Optional onboarding-store factory override.
 * @returns {Promise<Function>} The onboarding-store factory.
 */
const resolveOnboardingStoreFactory = async (override) => {
    if (typeof override === 'function') {
        return override;
    }

    const module = await import('../storage/onboardingStore.mjs');
    return module.createOnboardingStore ?? module.default;
};

/**
 * Normalizes the logger hooks used during Portal startup.
 *
 * @param {object} overrides - Optional logger overrides.
 * @returns {{error: Function, log: Function}} The logger interface.
 */
const resolveRuntimeLogger = (overrides = {}) => ({
    log: typeof overrides.log === 'function' ? overrides.log : log,
    error: typeof overrides.error === 'function' ? overrides.error : errMSG,
});

/**
 * Starts Portal with optional env, dependency, and logger overrides.
 *
 * @param {object} overrides - Optional startup overrides.
 * @returns {Promise<object>} The shared Portal runtime state.
 */
export const startPortal = async (overrides = {}) => {
    const dependencies = overrides.dependencies ?? {};
    const logger = resolveRuntimeLogger(overrides.logger);
    const config = safeLoadPortalConfig(overrides.env ?? {});
    const createOnboardingStore = await resolveOnboardingStoreFactory(dependencies.createOnboardingStore);
    runtime.config = config;
    runtime.closeServer = null;
    runtime.discord = null;
    runtime.discordStatus = config.discord.enabled ? 'ok' : 'disabled';
    runtime.presenceUpdater = null;
    runtime.recommendationNotifier = null;
    runtime.subscriptionNotifier = null;
    runtime.server = null;

    const kavita = (dependencies.createKavitaClient ?? createKavitaClient)({
        baseUrl: config.kavita.baseUrl,
        apiKey: config.kavita.apiKey,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.kavita = kavita;

    const komf = (dependencies.createKomfClient ?? createKomfClient)({
        baseUrl: config.komf.baseUrl,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.komf = komf;

    const vault = (dependencies.createVaultClient ?? createVaultClient)({
        baseUrl: config.vault.baseUrl,
        token: config.vault.token,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.vault = vault;

    const onboardingStore = createOnboardingStore({
        namespace: config.redis.onboardingNamespace,
        ttlSeconds: config.redis.ttlSeconds,
        vaultClient: vault,
    });
    runtime.onboardingStore = onboardingStore;

    const raven = (dependencies.createPortalRavenClient ?? createPortalRavenClient)({
        baseUrl: config.raven.baseUrl,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.raven = raven;

    const warden = (dependencies.createPortalWardenClient ?? createPortalWardenClient)({
        baseUrl: config.warden.baseUrl,
        token: config.warden.token,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.warden = warden;

    let discord = null;
    if (config.discord.enabled) {
        const slashCommands = (dependencies.createPortalSlashCommands ?? createPortalSlashCommands)({
            getDiscord: () => discord,
            kavita,
            raven,
            warden,
            vault,
            moonBaseUrl: config.moon?.baseUrl,
            kavitaExternalUrl: config.kavita?.externalUrl,
        });
        const directMessageHandler = (dependencies.createDirectMessageHandler ?? createDirectMessageHandler)({
            superuserId: config.discord.superuserId,
            raven,
        });

        discord = (dependencies.createDiscordClient ?? createDiscordClient)({
            token: config.discord.token,
            guildId: config.discord.guildId,
            clientId: config.discord.clientId,
            defaultRoleId: config.discord.defaultRoleId,
            commands: slashCommands,
            vaultClient: vault,
            messageQueueNamespace: config.redis.directMessageNamespace,
            messageQueueTtlSeconds: config.redis.ttlSeconds,
            directMessageHandler,
        });
        runtime.discord = discord;

        try {
            await discord.login();
        } catch (error) {
            const normalizedMessage = error?.message ?? String(error);
            logger.error(`[Portal] Discord integration disabled due to auth failure; continuing in API-only mode: ${normalizedMessage}`);

            try {
                discord.destroy?.();
            } catch (destroyError) {
                logger.error(
                    `[Portal] Failed to clean up Discord client after auth failure: ${destroyError?.message ?? destroyError}`,
                );
            }

            discord = null;
            runtime.discord = null;
            runtime.discordStatus = 'degraded';
        }

        if (discord) {
            const presenceUpdater = (dependencies.createDiscordPresenceUpdater ?? createDiscordPresenceUpdater)({
                client: discord.client,
                ravenClient: raven,
                wardenClient: warden,
                pollMs: config.activity.pollMs,
                logger: {
                    warn: errMSG,
                },
            });
            presenceUpdater.start();
            runtime.presenceUpdater = presenceUpdater;

            const recommendationNotifier = (dependencies.createRecommendationNotifier ?? createRecommendationNotifier)({
                discordClient: discord,
                vaultClient: vault,
                ravenClient: raven,
                kavitaClient: kavita,
                komfClient: komf,
                wardenClient: warden,
                moonBaseUrl: config.moon?.baseUrl,
                kavitaBaseUrl: config.kavita?.externalUrl,
                pollMs: config.recommendations?.pollMs,
                logger: {
                    warn: errMSG,
                },
            });
            recommendationNotifier.start();
            runtime.recommendationNotifier = recommendationNotifier;

            const subscriptionNotifier = (dependencies.createSubscriptionNotifier ?? createSubscriptionNotifier)({
                discordClient: discord,
                vaultClient: vault,
                ravenClient: raven,
                pollMs: config.recommendations?.pollMs,
                logger: {
                    warn: errMSG,
                },
            });
            subscriptionNotifier.start();
            runtime.subscriptionNotifier = subscriptionNotifier;
        }
    } else {
        runtime.discord = null;
        runtime.discordStatus = 'disabled';
        logger.log('[Portal] Discord integration is disabled; starting HTTP API routes only.');
    }

    const {server, close} = await (dependencies.startPortalServer ?? startPortalServer)({
        config,
        discord,
        kavita,
        komf,
        raven,
        vault,
        onboardingStore,
    });

    runtime.server = server;
    runtime.closeServer = close;

    logger.log('[Portal] Service started successfully.');

    return runtime;
};

/**
 * Stops portal.
 *
 * @returns {Promise<*>} The asynchronous result.
 */
export const stopPortal = async () => {
    if (runtime.closeServer) {
        await runtime.closeServer();
    }

    if (runtime.presenceUpdater) {
        runtime.presenceUpdater.stop();
    }

    if (runtime.recommendationNotifier) {
        runtime.recommendationNotifier.stop();
    }
    if (runtime.subscriptionNotifier) {
        runtime.subscriptionNotifier.stop();
    }

    if (runtime.discord) {
        runtime.discord.destroy();
    }

    runtime.server = null;
    runtime.closeServer = null;
    runtime.discord = null;
    runtime.discordStatus = null;
    runtime.kavita = null;
    runtime.komf = null;
    runtime.vault = null;
    runtime.onboardingStore = null;
    runtime.presenceUpdater = null;
    runtime.recommendationNotifier = null;
    runtime.subscriptionNotifier = null;
    runtime.raven = null;
    runtime.config = null;
    runtime.warden = null;

    log('[Portal] Shutdown complete.');
};

/**
 * Creates a process-signal handler that stops Portal gracefully.
 *
 * @param {*} signal - Input passed to the function.
 * @returns {*} The function result.
 */
export const createSignalHandler = (signal) => {
    log(`[Portal] Received ${signal}, shutting down.`);
    stopPortal()
        .then(() => process.exit(0))
        .catch((error) => {
            errMSG(`[Portal] Shutdown error: ${error.message}`);
            process.exit(1);
        });
};

export default startPortal;
