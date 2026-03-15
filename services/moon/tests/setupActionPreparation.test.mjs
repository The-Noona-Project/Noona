import assert from "node:assert/strict";
import test from "node:test";

import {
    executeSetupActionPreparation,
    SETUP_ACTION_INSTALL,
    SETUP_ACTION_SUMMARY,
} from "../src/components/noona/setupActionPreparation.mjs";

test("direct install saves the snapshot without running managed Kavita or Discord preflight", async () => {
    const calls = [];
    let persistedOverrides = null;

    const result = await executeSetupActionPreparation({
        action: SETUP_ACTION_INSTALL,
        currentKavita: {
            apiKey: "current-api-key",
            baseUrl: "http://noona-kavita:5000",
        },
        provisionManagedKavitaServiceKey: async () => {
            calls.push("kavita");
            return {apiKey: "managed-api-key", baseUrl: "http://managed.example"};
        },
        persistDiscordAuthConfig: async () => {
            calls.push("discord");
        },
        persistSetupConfigSnapshot: async (overrides) => {
            calls.push("snapshot");
            persistedOverrides = overrides;
            return {ok: true};
        },
    });

    assert.deepEqual(calls, ["snapshot"]);
    assert.equal(result.managedKavita, null);
    assert.deepEqual(persistedOverrides, {
        kavitaApiKey: "current-api-key",
        kavitaBaseUrl: "http://noona-kavita:5000",
    });
});

test("summary preparation provisions managed Kavita before saving the snapshot", async () => {
    const calls = [];
    let persistedOverrides = null;

    const result = await executeSetupActionPreparation({
        action: SETUP_ACTION_SUMMARY,
        currentKavita: {
            apiKey: "",
            baseUrl: "",
        },
        provisionManagedKavitaServiceKey: async () => {
            calls.push("kavita");
            return {
                apiKey: "managed-api-key",
                baseUrl: "http://noona-kavita:5000",
            };
        },
        persistDiscordAuthConfig: async () => {
            calls.push("discord");
        },
        persistSetupConfigSnapshot: async (overrides) => {
            calls.push("snapshot");
            persistedOverrides = overrides;
            return {ok: true};
        },
    });

    assert.deepEqual(calls, ["kavita", "discord", "snapshot"]);
    assert.deepEqual(result.managedKavita, {
        apiKey: "managed-api-key",
        baseUrl: "http://noona-kavita:5000",
    });
    assert.deepEqual(persistedOverrides, {
        kavitaApiKey: "managed-api-key",
        kavitaBaseUrl: "http://noona-kavita:5000",
    });
});

test("summary preparation still persists Discord auth config and falls back to current Kavita values when needed", async () => {
    const calls = [];
    let persistedOverrides = null;

    await executeSetupActionPreparation({
        action: SETUP_ACTION_SUMMARY,
        currentKavita: {
            apiKey: "existing-api-key",
            baseUrl: "http://existing-kavita:5000",
        },
        provisionManagedKavitaServiceKey: async () => {
            calls.push("kavita");
            return {
                apiKey: "",
                baseUrl: "",
            };
        },
        persistDiscordAuthConfig: async () => {
            calls.push("discord");
        },
        persistSetupConfigSnapshot: async (overrides) => {
            calls.push("snapshot");
            persistedOverrides = overrides;
            return {ok: true};
        },
    });

    assert.deepEqual(calls, ["kavita", "discord", "snapshot"]);
    assert.deepEqual(persistedOverrides, {
        kavitaApiKey: "existing-api-key",
        kavitaBaseUrl: "http://existing-kavita:5000",
    });
});

test("summary preparation persists the snapshot and returns warnings when post-install sync steps fail", async () => {
    const calls = [];
    let persistedOverrides = null;

    const result = await executeSetupActionPreparation({
        action: SETUP_ACTION_SUMMARY,
        currentKavita: {
            apiKey: "existing-api-key",
            baseUrl: "http://existing-kavita:5000",
        },
        provisionManagedKavitaServiceKey: async () => {
            calls.push("kavita");
            throw new Error("Unable to provision the managed Kavita API key.");
        },
        persistDiscordAuthConfig: async () => {
            calls.push("discord");
            throw new Error("Discord OAuth config is not reachable yet.");
        },
        persistSetupConfigSnapshot: async (overrides) => {
            calls.push("snapshot");
            persistedOverrides = overrides;
            return {ok: true};
        },
        allowNonFatalWarnings: true,
    });

    assert.deepEqual(calls, ["kavita", "discord", "snapshot"]);
    assert.deepEqual(persistedOverrides, {
        kavitaApiKey: "existing-api-key",
        kavitaBaseUrl: "http://existing-kavita:5000",
    });
    assert.deepEqual(result.warnings, [
        "Managed Kavita sync warning: Unable to provision the managed Kavita API key.",
        "Discord sync warning: Discord OAuth config is not reachable yet.",
    ]);
});

test("summary preparation still fails when snapshot persistence fails", async () => {
    await assert.rejects(
        async () => {
            await executeSetupActionPreparation({
                action: SETUP_ACTION_SUMMARY,
                currentKavita: {
                    apiKey: "existing-api-key",
                    baseUrl: "http://existing-kavita:5000",
                },
                provisionManagedKavitaServiceKey: async () => {
                    throw new Error("Unable to provision the managed Kavita API key.");
                },
                persistDiscordAuthConfig: async () => {
                    throw new Error("Discord OAuth config is not reachable yet.");
                },
                persistSetupConfigSnapshot: async () => {
                    throw new Error("Unable to persist setup config snapshot.");
                },
                allowNonFatalWarnings: true,
            });
        },
        /Unable to persist setup config snapshot\./,
    );
});
