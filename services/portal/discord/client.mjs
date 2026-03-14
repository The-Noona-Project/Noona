/**
 * @fileoverview Creates the Discord client wrapper, DM queue logic, and lifecycle hooks.
 * Related files:
 * - discord/interactionRouter.mjs
 * - discord/commandSynchronizer.mjs
 * - tests/discordClient.test.mjs
 * - discord/roleManager.mjs
 * Times this file has been edited: 5
 */

import crypto from 'node:crypto';
import {Client, Events, GatewayIntentBits, Partials,} from 'discord.js';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import createRoleManager from './roleManager.mjs';
import {extractCommandDefinitions, normalizeCommandMap} from './commandCatalog.mjs';
import {syncGuildCommands} from './commandSynchronizer.mjs';
import {createInteractionHandler} from './interactionRouter.mjs';

const DEFAULT_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
];

const DEFAULT_PARTIALS = [
    Partials.GuildMember,
    Partials.User,
];
const DEFAULT_MESSAGE_QUEUE_NAMESPACE = 'portal:discord:dm';
const DEFAULT_MESSAGE_QUEUE_TTL_SECONDS = 600;

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const queueKeyForUser = (namespace, userId) => `${namespace}:${userId}`;
const normalizeQueuedDirectMessages = value =>
    Array.isArray(value)
        ? value.filter(entry =>
            entry
            && typeof entry === 'object'
            && normalizeString(entry.id)
            && normalizeString(entry.userId)
            && entry.payload
            && typeof entry.payload === 'object',
        )
        : [];
const normalizeQueuedDirectMessage = value => {
    const [first] = normalizeQueuedDirectMessages([value]);
    return first ?? null;
};
const isUnsupportedRedisListOperationError = error => {
    const bodyError = normalizeString(error?.body?.error);
    const message = normalizeString(error?.message);
    return /unsupported operation "(rpush|lpop)" for redis/i.test(bodyError || message);
};

/**
 * Creates discord client.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createDiscordClient = ({
                                        token,
                                        guildId,
                                        clientId,
                                        defaultRoleId = null,
                                        intents = DEFAULT_INTENTS,
                                        partials = DEFAULT_PARTIALS,
                                        commands,
                                        clientFactory,
                                        clearGlobalCommandsOnBoot = true,
                                        clearCommandsOnBoot = true,
                                        vaultClient = null,
                                        messageQueueNamespace = DEFAULT_MESSAGE_QUEUE_NAMESPACE,
                                        messageQueueTtlSeconds = DEFAULT_MESSAGE_QUEUE_TTL_SECONDS,
                                    } = {}) => {
    if (!token) {
        throw new Error('Discord token is required to initialise the Portal Discord client.');
    }

    if (!guildId) {
        throw new Error('Discord guild id is required to initialise the Portal Discord client.');
    }

    const commandMap = normalizeCommandMap(commands);
    const client = typeof clientFactory === 'function'
        ? clientFactory({intents, partials})
        : new Client({intents, partials});

    const roleManager = createRoleManager();
    const directMessageQueueNamespace = normalizeString(messageQueueNamespace) || DEFAULT_MESSAGE_QUEUE_NAMESPACE;
    const directMessageQueueTtlSeconds = normalizePositiveInteger(
        messageQueueTtlSeconds,
        DEFAULT_MESSAGE_QUEUE_TTL_SECONDS,
    );
    const directMessageListQueueEnabled =
        typeof vaultClient?.redisRPush === 'function'
        && typeof vaultClient?.redisLPop === 'function';
    const directMessageLegacyQueueEnabled =
        typeof vaultClient?.redisSet === 'function'
        && typeof vaultClient?.redisGet === 'function'
        && typeof vaultClient?.redisDel === 'function';
    const directMessageQueueEnabled = directMessageListQueueEnabled || directMessageLegacyQueueEnabled;
    let preferListQueue = directMessageListQueueEnabled;
    const queueMutationsByUser = new Map();
    const queueProcessorsByUser = new Map();
    const pendingQueueResolvers = new Map();
    const inMemoryFallbackByUser = new Map();

    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    client.once(Events.ClientReady, bot => {
        log(`[Portal/Discord] Logged in as ${bot?.user?.tag ?? 'unknown user'}`);
        readyResolve(bot ?? client);
    });

    client.on('error', error => {
        errMSG(`[Portal/Discord] Client error: ${error.message}`);
    });

    client.on('shardError', error => {
        errMSG(`[Portal/Discord] Shard error: ${error.message}`);
    });

    const interactionHandler = createInteractionHandler({
        commandMap,
        roleManager,
    });

    client.on(Events.InteractionCreate, interactionHandler);

    const registerCommands = async () => {
        if (!clientId) {
            errMSG('[Portal/Discord] Client id missing, skipping slash command registration.');
            return;
        }

        const definitions = extractCommandDefinitions(commandMap);

        await syncGuildCommands({
            commandManager: client.application?.commands,
            guildId,
            definitions,
            clearGlobalBeforeRegister: clearGlobalCommandsOnBoot,
            clearBeforeRegister: clearCommandsOnBoot,
        });
    };

    const login = async () => {
        try {
            await client.login(token);
            await ready;
            await registerCommands();
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to login: ${error.message}`);
            readyReject?.(error);
            throw error;
        }

        return client;
    };

    const fetchGuild = async () => {
        await ready;
        return client.guilds.fetch(guildId);
    };

    const fetchMember = async memberId => {
        const guild = await fetchGuild();
        return guild.members.fetch(memberId);
    };

    const assignDefaultRole = async memberId => {
        if (!defaultRoleId) {
            return null;
        }

        try {
            const member = await fetchMember(memberId);
            if (member.roles.cache.has(defaultRoleId)) {
                return member;
            }

            await member.roles.add(defaultRoleId);
            log(`[Portal/Discord] Added default role ${defaultRoleId} to member ${member.user.tag}`);
            return member;
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to assign default role to ${memberId}: ${error.message}`);
            throw error;
        }
    };

    const sendDirectMessageNow = async (userId, payload) => {
        const normalizedUserId = normalizeString(userId);
        if (!normalizedUserId) {
            throw new Error('Discord user id is required to send a direct message.');
        }

        const contentPayload = typeof payload === 'string' ? {content: payload} : payload;
        if (!contentPayload || typeof contentPayload !== 'object') {
            throw new Error('Direct message payload must be a string or object.');
        }

        if (typeof client.users?.fetch !== 'function') {
            throw new Error('Discord user client is not available.');
        }

        try {
            const user = await client.users.fetch(normalizedUserId);
            if (!user || typeof user.send !== 'function') {
                throw new Error('Discord user could not receive direct messages.');
            }

            return await user.send(contentPayload);
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to send direct message to ${normalizedUserId}: ${error.message}`);
            throw error;
        }
    };

    const withQueueMutation = async (userId, task) => {
        const previous = queueMutationsByUser.get(userId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(task);

        queueMutationsByUser.set(
            userId,
            next.finally(() => {
                if (queueMutationsByUser.get(userId) === next) {
                    queueMutationsByUser.delete(userId);
                }
            }),
        );

        return next;
    };

    const readQueuedDirectMessages = async userId => {
        const key = queueKeyForUser(directMessageQueueNamespace, userId);
        const rawQueue = await vaultClient.redisGet(key);
        return normalizeQueuedDirectMessages(rawQueue);
    };

    const writeQueuedDirectMessages = async (userId, queue) => {
        const key = queueKeyForUser(directMessageQueueNamespace, userId);
        const normalizedQueue = normalizeQueuedDirectMessages(queue);
        if (!normalizedQueue.length) {
            await vaultClient.redisDel(key);
            return;
        }

        await vaultClient.redisSet(key, normalizedQueue, {ttl: directMessageQueueTtlSeconds});
    };

    const enqueueDirectMessage = async ({userId, payload}) => {
            const queueItem = {
                id: crypto.randomUUID(),
                userId,
                payload,
                queuedAt: new Date().toISOString(),
            };
        const key = queueKeyForUser(directMessageQueueNamespace, userId);

        if (preferListQueue) {
            try {
                await vaultClient.redisRPush(key, queueItem, {ttl: directMessageQueueTtlSeconds});
                return queueItem;
            } catch (error) {
                if (directMessageLegacyQueueEnabled && isUnsupportedRedisListOperationError(error)) {
                    preferListQueue = false;
                    log('[Portal/Discord] Falling back to legacy Redis DM queue packets (set/get/del).');
                } else {
                    throw error;
                }
            }
        }

        if (!directMessageLegacyQueueEnabled) {
            throw new Error('Vault Redis queue is not configured for direct messages.');
        }

        return withQueueMutation(userId, async () => {
            const queue = await readQueuedDirectMessages(userId);
            queue.push(queueItem);
            await writeQueuedDirectMessages(userId, queue);
            return queueItem;
        });
    };

    const dequeueDirectMessage = async userId => {
        const key = queueKeyForUser(directMessageQueueNamespace, userId);

        if (preferListQueue) {
            try {
                for (; ;) {
                    const nextItem = await vaultClient.redisLPop(key);
                    if (nextItem == null) {
                        return null;
                    }

                    const normalizedItem = normalizeQueuedDirectMessage(nextItem);
                    if (normalizedItem) {
                        return normalizedItem;
                    }
                }
            } catch (error) {
                if (directMessageLegacyQueueEnabled && isUnsupportedRedisListOperationError(error)) {
                    preferListQueue = false;
                    log('[Portal/Discord] Falling back to legacy Redis DM queue packets (set/get/del).');
                } else {
                    throw error;
                }
            }
        }

        if (!directMessageLegacyQueueEnabled) {
            return null;
        }

        return withQueueMutation(userId, async () => {
            const queue = await readQueuedDirectMessages(userId);
            if (!queue.length) {
                await writeQueuedDirectMessages(userId, []);
                return null;
            }

            const [next, ...remaining] = queue;
            await writeQueuedDirectMessages(userId, remaining);
            return next;
        });
    };

    const sendDirectMessageInMemoryFallback = (userId, payload) => {
        const previous = inMemoryFallbackByUser.get(userId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => sendDirectMessageNow(userId, payload));

        inMemoryFallbackByUser.set(
            userId,
            next.finally(() => {
                if (inMemoryFallbackByUser.get(userId) === next) {
                    inMemoryFallbackByUser.delete(userId);
                }
            }),
        );

        return next;
    };

    const processDirectMessageQueue = userId => {
        const existingProcessor = queueProcessorsByUser.get(userId);
        if (existingProcessor) {
            return existingProcessor;
        }

        const processor = (async () => {
            for (; ;) {
                const queuedMessage = await dequeueDirectMessage(userId);
                if (!queuedMessage) {
                    return;
                }

                const pending = pendingQueueResolvers.get(queuedMessage.id);
                try {
                    const sentMessage = await sendDirectMessageNow(queuedMessage.userId, queuedMessage.payload);
                    pending?.resolve(sentMessage);
                } catch (error) {
                    pending?.reject(error);
                } finally {
                    pendingQueueResolvers.delete(queuedMessage.id);
                }
            }
        })();

        queueProcessorsByUser.set(userId, processor);
        processor.finally(() => {
            if (queueProcessorsByUser.get(userId) === processor) {
                queueProcessorsByUser.delete(userId);
            }
        });

        return processor;
    };

    const sendDirectMessage = async (userId, payload) => {
        const normalizedUserId = normalizeString(userId);
        const contentPayload = typeof payload === 'string' ? {content: payload} : payload;
        if (!normalizedUserId) {
            throw new Error('Discord user id is required to send a direct message.');
        }
        if (!contentPayload || typeof contentPayload !== 'object') {
            throw new Error('Direct message payload must be a string or object.');
        }

        if (!directMessageQueueEnabled) {
            return sendDirectMessageNow(normalizedUserId, contentPayload);
        }

        let queuedMessage;
        try {
            queuedMessage = await enqueueDirectMessage({
                userId: normalizedUserId,
                payload: contentPayload,
            });
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to queue direct message for ${normalizedUserId}: ${error.message}`);
            return sendDirectMessageInMemoryFallback(normalizedUserId, contentPayload);
        }

        const sentMessagePromise = new Promise((resolve, reject) => {
            pendingQueueResolvers.set(queuedMessage.id, {resolve, reject});
        });

        void processDirectMessageQueue(normalizedUserId);
        return sentMessagePromise;
    };

    const destroy = () => {
        for (const pending of pendingQueueResolvers.values()) {
            pending?.reject?.(new Error('Discord client is shutting down before queued direct message delivery.'));
        }
        pendingQueueResolvers.clear();
        queueMutationsByUser.clear();
        queueProcessorsByUser.clear();
        inMemoryFallbackByUser.clear();
        client.destroy();
    };

    return {
        client,
        login,
        destroy,
        fetchGuild,
        fetchMember,
        assignDefaultRole,
        sendDirectMessage,
        waitUntilReady: () => ready,
    };
};

export default createDiscordClient;
