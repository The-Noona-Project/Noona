import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {createWarden} from "../core/createWarden.mjs";

function createStubDocker(overrides = {}) {
    return {
        ping: async () => {
        },
        listContainers: async () => [],
        modem: {socketPath: "/var/run/docker.sock"},
        ...overrides,
    };
}

function createMemoryFs(initialFiles = {}) {
    const files = new Map(Object.entries(initialFiles).map(([filePath, content]) => [path.normalize(filePath), String(content)]));
    const directories = new Set();
    const removePathSync = (targetPath) => {
        const normalizedPath = path.normalize(targetPath);
        files.delete(normalizedPath);
        directories.delete(normalizedPath);

        for (const filePath of Array.from(files.keys())) {
            if (filePath.startsWith(`${normalizedPath}${path.sep}`)) {
                files.delete(filePath);
            }
        }

        for (const directoryPath of Array.from(directories.values())) {
            if (directoryPath.startsWith(`${normalizedPath}${path.sep}`)) {
                directories.delete(directoryPath);
            }
        }
    };

    return {
        mkdirSync(targetPath) {
            directories.add(path.normalize(targetPath));
        },
        readFileSync(targetPath) {
            const normalizedPath = path.normalize(targetPath);
            if (!files.has(normalizedPath)) {
                const error = new Error(`ENOENT: no such file or directory, open '${normalizedPath}'`);
                error.code = "ENOENT";
                throw error;
            }
            return files.get(normalizedPath);
        },
        writeFileSync(targetPath, content) {
            files.set(path.normalize(targetPath), String(content));
        },
        rmSync(targetPath) {
            removePathSync(targetPath);
        },
        promises: {
            rm: async (targetPath) => removePathSync(targetPath),
        },
        files,
        directories,
    };
}

function buildWarden(options = {}) {
    const {
        dockerInstance = createStubDocker(),
        hostDockerSockets = [],
        storageLayoutBootstrap = false,
        fs = createMemoryFs(),
        ...rest
    } = options;

    return createWarden({
        dockerInstance,
        hostDockerSockets,
        storageLayoutBootstrap,
        fs,
        ...rest,
    });
}

test("saveSetupConfig supports persist-only saves without running lifecycle work", async () => {
    const startCalls = [];
    const stopCalls = [];
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: "/srv/noona"},
        services: {
            addon: {},
            core: {
                "noona-sage": {name: "noona-sage", port: 3004, internalPort: 3004},
                "noona-moon": {name: "noona-moon", port: 3000, internalPort: 3000, envConfig: [{key: "WEBGUI_PORT"}]},
                "noona-portal": {
                    name: "noona-portal",
                    port: 3003,
                    internalPort: 3003,
                    envConfig: [
                        {key: "DISCORD_BOT_TOKEN"},
                        {key: "DISCORD_CLIENT_ID"},
                        {key: "DISCORD_CLIENT_SECRET"},
                        {key: "DISCORD_GUILD_ID"},
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                    ],
                },
                "noona-raven": {
                    name: "noona-raven",
                    port: 3006,
                    internalPort: 3006,
                    envConfig: [
                        {key: "NOONA_DATA_ROOT"},
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                        {key: "KAVITA_DATA_MOUNT"},
                        {key: "KAVITA_LIBRARY_ROOT"},
                    ],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        wizardState: {
            publisher: {
                reset: async () => {
                },
                trackServiceStatus: async () => {
                },
                complete: async () => {
                },
                fail: async () => {
                },
            },
        },
        hostDockerSockets: [],
    });

    warden.stopEcosystem = async (options = {}) => {
        stopCalls.push(options);
        return [];
    };
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: "full", setupCompleted: true};
    };

    const result = await warden.saveSetupConfig({
        version: 3,
        storageRoot: "/srv/noona",
        kavita: {
            mode: "external",
            baseUrl: "https://kavita.example",
            apiKey: "kavita-api",
            sharedLibraryPath: "/mnt/manga",
            account: {username: "", email: "", password: ""},
        },
        komf: {
            mode: "external",
            baseUrl: "",
            applicationYml: "",
        },
        discord: {
            botToken: "portal-token",
            clientId: "client-id",
            clientSecret: "client-secret",
            guildId: "guild-id",
        },
    }, {apply: false});

    assert.equal(result.restarted, false);
    assert.equal(result.persistOnly, true);
    assert.deepEqual(result.selected, ["noona-portal", "noona-raven"]);
    assert.equal(result.snapshot.discord.botToken, "portal-token");
    assert.deepEqual(stopCalls, []);
    assert.deepEqual(startCalls, []);
});

test("installServices uses the persisted setup profile when no explicit services are supplied", async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: "/srv/noona"},
        services: {
            addon: {},
            core: {
                "noona-portal": {
                    name: "noona-portal",
                    image: "portal",
                    port: 3003,
                    envConfig: [
                        {key: "DISCORD_BOT_TOKEN"},
                        {key: "DISCORD_CLIENT_ID"},
                        {key: "DISCORD_CLIENT_SECRET"},
                        {key: "DISCORD_GUILD_ID"},
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                    ],
                },
                "noona-raven": {
                    name: "noona-raven",
                    image: "raven",
                    port: 3006,
                    envConfig: [
                        {key: "NOONA_DATA_ROOT"},
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                        {key: "KAVITA_DATA_MOUNT"},
                        {key: "KAVITA_LIBRARY_ROOT"},
                    ],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        wizardState: {
            publisher: {
                reset: async () => {
                },
                trackServiceStatus: async () => {
                },
                complete: async () => {
                },
                fail: async () => {
                },
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    await warden.saveSetupConfig({
        version: 3,
        storageRoot: "/srv/noona",
        kavita: {
            mode: "external",
            baseUrl: "https://kavita.example",
            apiKey: "kavita-api",
            sharedLibraryPath: "/mnt/manga",
            account: {username: "", email: "", password: ""},
        },
        komf: {
            mode: "external",
            baseUrl: "",
            applicationYml: "",
        },
        discord: {
            botToken: "portal-token",
            clientId: "client-id",
            clientSecret: "client-secret",
            guildId: "guild-id",
        },
    }, {apply: false});

    const results = await warden.installServices([]);

    assert.deepEqual(results.map((entry) => entry.name), [
        "noona-raven",
        "noona-portal",
        "noona-mongo",
        "noona-redis",
        "noona-vault",
    ]);
    assert.deepEqual(started, [
        "noona-raven",
        "noona-portal",
    ]);
});

test("saveSetupConfig no longer rejects legacy moon and sage selections from older setup files", async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: "/srv/noona"},
        services: {
            addon: {},
            core: {
                "noona-moon": {name: "noona-moon", envConfig: [{key: "WEBGUI_PORT"}]},
                "noona-sage": {name: "noona-sage", envConfig: []},
                "noona-portal": {
                    name: "noona-portal",
                    envConfig: [
                        {key: "DISCORD_BOT_TOKEN"},
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                    ],
                },
                "noona-raven": {
                    name: "noona-raven",
                    envConfig: [
                        {key: "KAVITA_BASE_URL"},
                        {key: "KAVITA_API_KEY"},
                        {key: "KAVITA_DATA_MOUNT"},
                        {key: "KAVITA_LIBRARY_ROOT"},
                    ],
                },
            },
        },
        hostDockerSockets: [],
    });

    const result = await warden.saveSetupConfig({
        version: 2,
        selected: ["noona-moon", "noona-sage", "noona-portal"],
        values: {
            "noona-portal": {
                DISCORD_BOT_TOKEN: "portal-token",
            },
        },
    }, {apply: false});

    assert.deepEqual(result.selected, ["noona-portal", "noona-raven"]);
    assert.equal(result.snapshot.discord.botToken, "portal-token");
});
