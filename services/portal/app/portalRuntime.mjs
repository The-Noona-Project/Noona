// services/portal/app/portalRuntime.mjs

import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import {startPortalServer} from './createPortalApp.mjs';
import createKavitaClient from '../clients/kavitaClient.mjs';
import createKomfClient from '../clients/komfClient.mjs';
import createPortalRavenClient from '../clients/ravenClient.mjs';
import createVaultClient from '../clients/vaultClient.mjs';
import createPortalWardenClient from '../clients/wardenClient.mjs';
import createOnboardingStore from '../storage/onboardingStore.mjs';
import {safeLoadPortalConfig} from '../config/portalConfig.mjs';
import {createDiscordClient} from '../discord/client.mjs';
import {createDiscordPresenceUpdater} from '../discord/presenceUpdater.mjs';
import {createRecommendationNotifier} from '../discord/recommendationNotifier.mjs';
import {createPortalSlashCommands} from '../commands/index.mjs';

const runtime = {
    closeServer: null,
    config: null,
    discord: null,
    kavita: null,
    komf: null,
    onboardingStore: null,
    presenceUpdater: null,
    recommendationNotifier: null,
    raven: null,
    server: null,
    vault: null,
    warden: null,
};

export const startPortal = async (overrides = {}) => {
    const config = safeLoadPortalConfig(overrides.env ?? {});
    runtime.config = config;

    const kavita = createKavitaClient({
        baseUrl: config.kavita.baseUrl,
        apiKey: config.kavita.apiKey,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.kavita = kavita;

    const komf = createKomfClient({
        baseUrl: config.komf.baseUrl,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.komf = komf;

    const vault = createVaultClient({
        baseUrl: config.vault.baseUrl,
        token: config.vault.token,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.vault = vault;

    const onboardingStore = createOnboardingStore({
        namespace: config.redis.namespace,
        ttlSeconds: config.redis.ttlSeconds,
    });
    runtime.onboardingStore = onboardingStore;

    const raven = createPortalRavenClient({
        baseUrl: config.raven.baseUrl,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.raven = raven;

    const warden = createPortalWardenClient({
        baseUrl: config.warden.baseUrl,
        timeoutMs: config.http.timeoutMs,
    });
    runtime.warden = warden;

    let discord = null;
    if (config.discord.enabled) {
        const slashCommands = createPortalSlashCommands({
            getDiscord: () => discord,
            kavita,
            raven,
            warden,
            vault,
            moonBaseUrl: config.moon?.baseUrl,
            kavitaExternalUrl: config.kavita?.externalUrl,
            onboardingStore,
            joinDefaults: config.join,
        });

        discord = createDiscordClient({
            token: config.discord.token,
            guildId: config.discord.guildId,
            clientId: config.discord.clientId,
            defaultRoleId: config.discord.defaultRoleId,
            commands: slashCommands,
            vaultClient: vault,
            messageQueueNamespace: `${config.redis.namespace}:discord-dm`,
            messageQueueTtlSeconds: config.redis.ttlSeconds,
        });
        runtime.discord = discord;

        await discord.login();

        const presenceUpdater = createDiscordPresenceUpdater({
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

        const recommendationNotifier = createRecommendationNotifier({
            discordClient: discord,
            vaultClient: vault,
            ravenClient: raven,
            kavitaClient: kavita,
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
    } else {
        runtime.discord = null;
        log('[Portal] Discord integration is disabled; starting HTTP API routes only.');
    }

    const {server, close} = await startPortalServer({
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

    log('[Portal] Service started successfully.');

    return runtime;
};

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

    if (runtime.discord) {
        runtime.discord.destroy();
    }

    runtime.server = null;
    runtime.closeServer = null;
    runtime.discord = null;
    runtime.kavita = null;
    runtime.komf = null;
    runtime.vault = null;
    runtime.onboardingStore = null;
    runtime.presenceUpdater = null;
    runtime.recommendationNotifier = null;
    runtime.raven = null;
    runtime.config = null;
    runtime.warden = null;

    log('[Portal] Shutdown complete.');
};

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
