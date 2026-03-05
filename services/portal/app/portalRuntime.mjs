// services/portal/app/portalRuntime.mjs

import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import {startPortalServer} from './createPortalApp.mjs';
import createKavitaClient from '../clients/kavitaClient.mjs';
import createPortalRavenClient from '../clients/ravenClient.mjs';
import createVaultClient from '../clients/vaultClient.mjs';
import createPortalWardenClient from '../clients/wardenClient.mjs';
import createOnboardingStore from '../storage/onboardingStore.mjs';
import {safeLoadPortalConfig} from '../config/portalConfig.mjs';
import {createDiscordClient} from '../discord/client.mjs';
import {createDiscordPresenceUpdater} from '../discord/presenceUpdater.mjs';
import {createPortalSlashCommands} from '../commands/index.mjs';

const runtime = {
    closeServer: null,
    config: null,
    discord: null,
    kavita: null,
    onboardingStore: null,
    presenceUpdater: null,
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

    let discord;
    const slashCommands = createPortalSlashCommands({
        getDiscord: () => discord,
        kavita,
        raven,
        vault,
        onboardingStore,
        joinDefaults: config.join,
    });

    discord = createDiscordClient({
        token: config.discord.token,
        guildId: config.discord.guildId,
        clientId: config.discord.clientId,
        defaultRoleId: config.discord.defaultRoleId,
        commands: slashCommands,
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

    const {server, close} = await startPortalServer({
        config,
        discord,
        kavita,
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

    if (runtime.discord) {
        runtime.discord.destroy();
    }

    runtime.server = null;
    runtime.closeServer = null;
    runtime.discord = null;
    runtime.kavita = null;
    runtime.vault = null;
    runtime.onboardingStore = null;
    runtime.presenceUpdater = null;
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
