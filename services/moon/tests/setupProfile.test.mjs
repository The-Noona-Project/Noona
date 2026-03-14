import test from "node:test";
import assert from "node:assert/strict";

import {
    SETUP_PROFILE_VERSION,
    buildSetupProfileSnapshot,
    deriveSetupProfileSelection,
    hydrateSetupProfileState,
    shouldShowSetupDebugDetails,
} from "../src/components/noona/setupProfile.mjs";

test("deriveSetupProfileSelection maps managed modes to the implied services", () => {
    assert.deepEqual(
        deriveSetupProfileSelection({kavitaMode: "managed", komfMode: "managed"}),
        ["noona-kavita", "noona-komf", "noona-portal", "noona-raven"],
    );
    assert.deepEqual(
        deriveSetupProfileSelection({kavitaMode: "external", komfMode: "external"}),
        ["noona-portal", "noona-raven"],
    );
});

test("buildSetupProfileSnapshot emits the minimal v3 browser contract", () => {
    const snapshot = buildSetupProfileSnapshot({
        storageRoot: " /srv/noona ",
        kavitaMode: "external",
        kavitaBaseUrl: " https://kavita.example ",
        kavitaApiKey: "secret-key",
        kavitaSharedLibraryPath: " /mnt/manga ",
        komfMode: "managed",
        values: {
            "noona-portal": {
                DISCORD_BOT_TOKEN: "bot-token",
                DISCORD_CLIENT_ID: "client-id",
                DISCORD_CLIENT_SECRET: "client-secret",
                DISCORD_GUILD_ID: "guild-id",
            },
            "noona-komf": {
                KOMF_APPLICATION_YML: "komf:\n  enabled: true\n",
            },
        },
    });

    assert.equal(snapshot.version, SETUP_PROFILE_VERSION);
    assert.deepEqual(Object.keys(snapshot).sort(), ["discord", "kavita", "komf", "storageRoot", "version"]);
    assert.equal(snapshot.storageRoot, "/srv/noona");
    assert.equal(snapshot.kavita.mode, "external");
    assert.equal(snapshot.kavita.baseUrl, "https://kavita.example");
    assert.equal(snapshot.kavita.sharedLibraryPath, "/mnt/manga");
    assert.equal(snapshot.komf.applicationYml, "komf:\n  enabled: true");
    assert.equal(snapshot.discord.botToken, "bot-token");
});

test("hydrateSetupProfileState restores wizard fields from a persisted snapshot", () => {
    const hydrated = hydrateSetupProfileState({
        snapshot: {
            version: 3,
            storageRoot: "/srv/noona",
            kavita: {
                mode: "external",
                baseUrl: "https://kavita.example",
                apiKey: "restored-key",
                sharedLibraryPath: "/mnt/manga",
                account: {
                    username: "",
                    email: "",
                    password: "",
                },
            },
            komf: {
                mode: "managed",
                baseUrl: "",
                applicationYml: "server:\n  port: 8085\n",
            },
            discord: {
                botToken: "bot-token",
                clientId: "client-id",
                clientSecret: "client-secret",
                guildId: "guild-id",
                joinDefaultRoles: "Members",
                joinDefaultLibraries: "Manga",
            },
        },
        values: {
            "noona-portal": {},
            "noona-komf": {},
        },
        defaultStorageRoot: "/default/root",
        defaultSharedLibraryPath: "/default/manga",
    });

    assert.equal(hydrated.storageRoot, "/srv/noona");
    assert.equal(hydrated.kavitaMode, "external");
    assert.equal(hydrated.kavitaBaseUrl, "https://kavita.example");
    assert.equal(hydrated.kavitaApiKey, "restored-key");
    assert.equal(hydrated.kavitaSharedLibraryPath, "/mnt/manga");
    assert.equal(hydrated.komfMode, "managed");
    assert.equal(hydrated.values["noona-portal"].DISCORD_BOT_TOKEN, "bot-token");
    assert.equal(hydrated.values["noona-portal"].PORTAL_JOIN_DEFAULT_LIBRARIES, "Manga");
    assert.equal(hydrated.values["noona-komf"].KOMF_APPLICATION_YML, "server:\n  port: 8085\n");
});

test("shouldShowSetupDebugDetails only enables raw controls in debug mode", () => {
    assert.equal(shouldShowSetupDebugDetails(true), true);
    assert.equal(shouldShowSetupDebugDetails(false), false);
    assert.equal(shouldShowSetupDebugDetails(undefined), false);
});
