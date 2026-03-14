import test from "node:test";
import assert from "node:assert/strict";

import {
    normalizeSetupProfileSnapshot,
    SETUP_PROFILE_SECRET_PLACEHOLDER,
    toPublicSetupSnapshot,
} from "../core/setupProfile.mjs";

test("normalizeSetupProfileSnapshot derives the v3 service contract from the public profile", () => {
    const normalized = normalizeSetupProfileSnapshot({
        version: 3,
        storageRoot: "/srv/noona",
        kavita: {
            mode: "external",
            baseUrl: "https://kavita.example",
            apiKey: "kavita-key",
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
        },
    });

    assert.equal(normalized.version, 3);
    assert.deepEqual(normalized.selected, ["noona-komf", "noona-portal", "noona-raven"]);
    assert.equal(normalized.values["noona-raven"].KAVITA_BASE_URL, "https://kavita.example");
    assert.equal(normalized.values["noona-raven"].KAVITA_DATA_MOUNT, "/mnt/manga");
    assert.equal(Object.prototype.hasOwnProperty.call(normalized.values["noona-raven"], "NOONA_DATA_ROOT"), false);
    assert.equal(normalized.values["noona-vault"], undefined);
    assert.equal(normalized.values["noona-komf"].KOMF_APPLICATION_YML, "server:\n  port: 8085");
    assert.equal(normalized.values["noona-portal"].DISCORD_BOT_TOKEN, "bot-token");
});

test("normalizeSetupProfileSnapshot imports legacy snapshots into the v3 profile model", () => {
    const normalized = normalizeSetupProfileSnapshot({
        version: 2,
        selected: ["noona-moon", "noona-sage", "noona-portal", "noona-kavita"],
        values: {
            "noona-portal": {
                DISCORD_BOT_TOKEN: "bot-token",
                DISCORD_CLIENT_ID: "client-id",
                DISCORD_CLIENT_SECRET: "client-secret",
                DISCORD_GUILD_ID: "guild-id",
                KAVITA_BASE_URL: "http://noona-kavita:5000",
                KAVITA_API_KEY: "kavita-key",
            },
            "noona-vault": {
                NOONA_DATA_ROOT: "/srv/noona",
            },
            "noona-kavita": {
                KAVITA_ADMIN_USERNAME: "admin",
                KAVITA_ADMIN_EMAIL: "admin@example.com",
                KAVITA_ADMIN_PASSWORD: "admin-pass",
            },
        },
    });

    assert.equal(normalized.version, 3);
    assert.equal(normalized.storageRoot, "/srv/noona");
    assert.equal(normalized.kavita.mode, "managed");
    assert.equal(normalized.kavita.apiKey, "kavita-key");
    assert.equal(normalized.kavita.account.username, "admin");
    assert.equal(normalized.discord.clientId, "client-id");
    assert.deepEqual(normalized.selected, ["noona-kavita", "noona-portal", "noona-raven"]);
    assert.equal(normalized.values["noona-vault"], undefined);
});

test("toPublicSetupSnapshot masks secrets and masked imports restore from the current snapshot", () => {
    const current = normalizeSetupProfileSnapshot({
        version: 3,
        storageRoot: "/srv/noona",
        kavita: {
            mode: "managed",
            baseUrl: "http://noona-kavita:5000",
            apiKey: "kavita-key",
            sharedLibraryPath: "",
            account: {
                username: "admin",
                email: "admin@example.com",
                password: "admin-pass",
            },
        },
        komf: {
            mode: "managed",
            baseUrl: "",
            applicationYml: "",
        },
        discord: {
            botToken: "bot-token",
            clientId: "client-id",
            clientSecret: "client-secret",
            guildId: "guild-id",
        },
    });

    const masked = toPublicSetupSnapshot(current, {maskSecrets: true});
    assert.equal(masked.kavita.apiKey, SETUP_PROFILE_SECRET_PLACEHOLDER);
    assert.equal(masked.kavita.account.password, SETUP_PROFILE_SECRET_PLACEHOLDER);
    assert.equal(masked.discord.botToken, SETUP_PROFILE_SECRET_PLACEHOLDER);
    assert.equal(masked.discord.clientSecret, SETUP_PROFILE_SECRET_PLACEHOLDER);

    const restored = normalizeSetupProfileSnapshot(masked, {currentSnapshot: current});
    assert.equal(restored.kavita.apiKey, "kavita-key");
    assert.equal(restored.kavita.account.password, "admin-pass");
    assert.equal(restored.discord.botToken, "bot-token");
    assert.equal(restored.discord.clientSecret, "client-secret");
});
