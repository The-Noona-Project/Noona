/**
 * @fileoverview Verifies Portal startup degrades cleanly when Discord authentication fails.
 * Related files:
 * - app/portalRuntime.mjs
 * - routes/registerPortalRoutes.mjs
 * - discord/client.mjs
 * Times this file has been edited: 1
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {startPortal, stopPortal} from '../app/portalRuntime.mjs';

const REQUIRED_ENV = {
    DISCORD_BOT_TOKEN: 'bad-token',
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_GUILD_ID: 'guild-id',
    KAVITA_API_KEY: 'kavita-api-key',
    PORTAL_PORT: '0',
    VAULT_ACCESS_TOKEN: 'vault-token',
    VAULT_BASE_URL: 'https://vault.example',
};

const collectLogMessage = (target) => (...args) => {
    target.push(args.map(value => String(value)).join(' '));
};

test(
    'bad Discord auth keeps Portal healthy in API-only mode and skips Discord workers',
    {concurrency: false},
    async () => {
        const logs = [];
        const errors = [];
        let destroyCalls = 0;
        let presenceFactoryCalls = 0;
        let recommendationFactoryCalls = 0;
        let subscriptionFactoryCalls = 0;

        const runtime = await startPortal({
            env: REQUIRED_ENV,
            logger: {
                log: collectLogMessage(logs),
                error: collectLogMessage(errors),
            },
            dependencies: {
                createOnboardingStore: () => ({
                    consumeToken: async () => null,
                    getToken: async () => null,
                    setToken: async () => null,
                }),
                createPortalSlashCommands: () => [],
                createDirectMessageHandler: () => async () => {
                },
                createDiscordClient: () => ({
                    login: async () => {
                        throw new Error('Discord rejected the token');
                    },
                    destroy: () => {
                        destroyCalls += 1;
                    },
                }),
                createDiscordPresenceUpdater: () => {
                    presenceFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
                createRecommendationNotifier: () => {
                    recommendationFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
                createSubscriptionNotifier: () => {
                    subscriptionFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
            },
        });

        try {
            assert.equal(runtime.server?.listening, true);
            assert.equal(runtime.discord, null);
            assert.equal(runtime.discordStatus, 'degraded');
            assert.equal(runtime.presenceUpdater, null);
            assert.equal(runtime.recommendationNotifier, null);
            assert.equal(runtime.subscriptionNotifier, null);
            assert.equal(destroyCalls, 1);
            assert.equal(presenceFactoryCalls, 0);
            assert.equal(recommendationFactoryCalls, 0);
            assert.equal(subscriptionFactoryCalls, 0);

            const address = runtime.server.address();
            assert.equal(typeof address?.port, 'number');

            const response = await fetch(`http://127.0.0.1:${address.port}/health`);
            const payload = await response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.status, 'ok');
            assert.equal(payload.discord, 'degraded');
            assert.equal(payload.guildId, 'guild-id');
            assert.match(errors.join('\n'), /Discord integration disabled due to auth failure/i);
            assert.match(logs.join('\n'), /Service started successfully/i);
        } finally {
            await stopPortal();
        }
    },
);

test(
    'startPortal passes Vault-backed onboarding and explicit DM queue namespaces into runtime dependencies',
    {concurrency: false},
    async () => {
        const onboardingFactoryCalls = [];
        const discordFactoryCalls = [];
        let presenceFactoryCalls = 0;
        let recommendationFactoryCalls = 0;
        let subscriptionFactoryCalls = 0;
        const vaultClient = {
            redisSet: async () => ({status: 'ok'}),
            redisGet: async () => null,
            redisDel: async () => ({status: 'ok', deleted: 0}),
        };

        const runtime = await startPortal({
            env: {
                ...REQUIRED_ENV,
                DISCORD_BOT_TOKEN: 'good-token',
                DISCORD_CLIENT_ID: 'client-id',
                DISCORD_GUILD_ID: 'guild-id',
                PORTAL_REDIS_NAMESPACE: 'portal:custom:onboarding',
                PORTAL_DM_QUEUE_NAMESPACE: 'portal:custom:dm',
            },
            dependencies: {
                createVaultClient: () => vaultClient,
                createOnboardingStore: (options) => {
                    onboardingFactoryCalls.push(options);
                    return {
                        consumeToken: async () => null,
                        getToken: async () => null,
                        setToken: async () => null,
                    };
                },
                createDiscordClient: (options) => {
                    discordFactoryCalls.push(options);
                    return {
                        login: async () => {
                        },
                        client: {},
                        destroy: () => {
                        },
                    };
                },
                createPortalSlashCommands: () => [],
                createDirectMessageHandler: () => async () => {
                },
                createDiscordPresenceUpdater: () => {
                    presenceFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
                createRecommendationNotifier: () => {
                    recommendationFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
                createSubscriptionNotifier: () => {
                    subscriptionFactoryCalls += 1;
                    return {
                        start: () => {
                        },
                        stop: () => {
                        },
                    };
                },
            },
        });

        try {
            assert.equal(runtime.discordStatus, 'ok');
            assert.deepEqual(onboardingFactoryCalls, [{
                namespace: 'portal:custom:onboarding',
                ttlSeconds: 900,
                vaultClient,
            }]);
            assert.equal(discordFactoryCalls.length, 1);
            assert.equal(discordFactoryCalls[0].messageQueueNamespace, 'portal:custom:dm');
            assert.equal(discordFactoryCalls[0].messageQueueTtlSeconds, 900);
            assert.equal(discordFactoryCalls[0].vaultClient, vaultClient);
            assert.equal(presenceFactoryCalls, 1);
            assert.equal(recommendationFactoryCalls, 1);
            assert.equal(subscriptionFactoryCalls, 1);
        } finally {
            await stopPortal();
        }
    },
);
