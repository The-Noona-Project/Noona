// services/portal/app/portalRuntime.mjs

import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import {startPortalServer} from './createPortalApp.mjs';
import createKavitaClient from '../clients/kavitaClient.mjs';
import createVaultClient from '../clients/vaultClient.mjs';
import createOnboardingStore from '../storage/onboardingStore.mjs';
import {safeLoadPortalConfig} from '../config/portalConfig.mjs';
import {createDiscordClient} from '../discord/client.mjs';
import {createPortalSlashCommands} from '../commands/index.mjs';

const runtime = {
    closeServer: null,
    config: null,
    discord: null,
    kavita: null,
    onboardingStore: null,
    server: null,
    vault: null,
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

    let discord;
    const slashCommands = createPortalSlashCommands({
        getDiscord: () => discord,
        kavita,
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

    const {server, close} = await startPortalServer({
        config,
        discord,
        kavita,
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

    if (runtime.discord) {
        runtime.discord.destroy();
    }

    runtime.server = null;
    runtime.closeServer = null;
    runtime.discord = null;
    runtime.kavita = null;
    runtime.vault = null;
    runtime.onboardingStore = null;
    runtime.config = null;

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
