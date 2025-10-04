// services/portal/initPortal.mjs

import { errMSG, log } from '../../utilities/etc/logger.mjs';
import { safeLoadPortalConfig } from './shared/config.mjs';
import createDiscordClient from './shared/discordClient.mjs';
import createKavitaClient from './shared/kavitaClient.mjs';
import createVaultClient from './shared/vaultClient.mjs';
import createOnboardingStore from './shared/onboardingStore.mjs';
import { startPortalServer } from './shared/portalApp.mjs';

const runtime = {
    config: null,
    discord: null,
    kavita: null,
    vault: null,
    onboardingStore: null,
    server: null,
    closeServer: null,
};

export const startPortal = async (overrides = {}) => {
    const config = safeLoadPortalConfig(overrides.env ?? {});
    runtime.config = config;

    const discord = createDiscordClient({
        token: config.discord.token,
        guildId: config.discord.guildId,
        defaultRoleId: config.discord.defaultRoleId,
    });
    runtime.discord = discord;

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

    await discord.login();

    const { server, close } = await startPortalServer({
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

const handleSignal = signal => {
    log(`[Portal] Received ${signal}, shutting down.`);
    stopPortal()
        .then(() => process.exit(0))
        .catch(error => {
            errMSG(`[Portal] Shutdown error: ${error.message}`);
            process.exit(1);
        });
};

const isDirectRun = (() => {
    if (!process.argv[1]) {
        return false;
    }

    try {
        const entryUrl = new URL(process.argv[1], 'file:');
        return entryUrl.href === import.meta.url;
    } catch (error) {
        return false;
    }
})();

if (isDirectRun) {
    startPortal().catch(error => {
        errMSG(`[Portal] Failed to start: ${error.message}`);
        process.exit(1);
    });

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    setInterval(() => process.stdout.write('.'), 60000);
}

export default startPortal;
