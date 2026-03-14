/**
 * @fileoverview Covers Discord client lifecycle, routing, and DM queue behavior.
 * Related files:
 * - discord/client.mjs
 * - commands/index.mjs
 * Times this file has been edited: 11
 */

import EventEmitter from 'node:events';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Events, MessageFlags} from 'discord.js';

import {createDiscordClient} from '../discord/client.mjs';
import createPortalSlashCommands from '../commands/index.mjs';

class FakeClient extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.lastLoginToken = null;
        this.directMessages = [];
        this.application = {
            commands: {
                calls: [],
                set: async (definitions, guildId) => {
                    this.application.commands.calls.push({ definitions, guildId });
                    return definitions;
                },
            },
        };
        this.guilds = {
            fetch: async guildId => ({
                id: guildId,
                members: {
                    fetch: async memberId => {
                        const rolesCache = new Set();
                        return {
                            id: memberId,
                            user: { tag: `member-${memberId}` },
                            roles: {
                                cache: {
                                    has: roleId => rolesCache.has(roleId),
                                },
                                add: async roleId => {
                                    rolesCache.add(roleId);
                                },
                            },
                        };
                    },
                },
            }),
        };
        this.users = {
            fetch: async userId => ({
                id: userId,
                send: async payload => {
                    const message = {
                        id: `dm-${this.directMessages.length + 1}`,
                        payload,
                    };
                    this.directMessages.push({userId, payload, message});
                    return message;
                },
            }),
        };
    }

    async login(token) {
        this.lastLoginToken = token;
        return this;
    }

    destroy() {
        this.destroyed = true;
    }
}

const emitAndWait = (emitter, event, payload) => {
    emitter.emit(event, payload);
    return new Promise(resolve => setImmediate(resolve));
};

test('createDiscordClient clears global and guild commands before registering slash commands during login', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = { tag: 'TestBot#0001' };

    const commands = new Map([
        ['ding', { definition: { name: 'ding', description: 'Test ding' }, execute: async () => {} }],
    ]);

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands,
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    assert.equal(fakeClient.lastLoginToken, 'test-token');
    assert.equal(fakeClient.application.commands.calls.length, 3);

    const [clearGlobalCall, clearGuildCall, registerCall] = fakeClient.application.commands.calls;
    assert.equal(clearGlobalCall.guildId, undefined);
    assert.deepEqual(clearGlobalCall.definitions, []);

    assert.equal(clearGuildCall.guildId, 'guild-123');
    assert.deepEqual(clearGuildCall.definitions, []);

    assert.equal(registerCall.guildId, 'guild-123');
    assert.deepEqual(registerCall.definitions, [{name: 'ding', description: 'Test ding'}]);
});

test('createDiscordClient syncs the current Portal slash commands without the legacy join command', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const commands = createPortalSlashCommands();

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands,
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    assert.equal(fakeClient.application.commands.calls.length, 3);

    const registerCall = fakeClient.application.commands.calls[2];
    assert.equal(registerCall.guildId, 'guild-123');
    assert.deepEqual(
        registerCall.definitions.map(definition => definition.name),
        ['ding', 'scan', 'search', 'recommend', 'subscribe'],
    );
    assert.equal(registerCall.definitions.some(definition => definition.name === 'join'), false);
});

test('createDiscordClient clears global and guild commands on login when no handlers are defined', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands: new Map(),
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    assert.equal(fakeClient.application.commands.calls.length, 2);
    assert.deepEqual(fakeClient.application.commands.calls[0], {
        definitions: [],
        guildId: undefined,
    });
    assert.deepEqual(fakeClient.application.commands.calls[1], {
        definitions: [],
        guildId: 'guild-123',
    });
});

test('interaction handler executes matching slash command', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = { tag: 'TestBot#0001' };

    const commands = createPortalSlashCommands();

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands,
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const replies = [];
    const interaction = {
        isChatInputCommand: () => true,
        commandName: 'ding',
        reply: async payload => {
            replies.push(payload);
        },
    };

    await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.match(replies[0].content, /Dong/i);
});

test('interaction handler responds when slash command has no registered handler', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands: new Map(),
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const replies = [];
    const interaction = {
        isChatInputCommand: () => true,
        commandName: 'recommend',
        reply: async payload => {
            replies.push(payload);
        },
    };

    await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.match(replies[0].content, /not available right now/i);
});

test('interaction handler executes matching autocomplete handler', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const responses = [];
    const commands = new Map([
        ['scan', {
            definition: {name: 'scan', description: 'Scan library'},
            autocomplete: async interaction => {
                await interaction.respond([{name: 'Manga', value: '1'}]);
            },
        }],
    ]);

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands,
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const interaction = {
        isChatInputCommand: () => false,
        isAutocomplete: () => true,
        commandName: 'scan',
        respond: async payload => {
            responses.push(payload);
        },
        member: {roles: {cache: new Map()}},
        guildId: 'guild-123',
        user: {tag: 'Member#0001', id: 'member-001'},
    };

    await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

    assert.deepEqual(responses, [[{name: 'Manga', value: '1'}]]);
});

test('createDiscordClient sends direct messages through the Discord user client', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};
    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands: new Map(),
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const message = await discord.sendDirectMessage('discord-user-1', {content: 'Hello from Portal'});
    assert.equal(message.id, 'dm-1');
    assert.deepEqual(fakeClient.directMessages, [
        {
            userId: 'discord-user-1',
            payload: {content: 'Hello from Portal'},
            message: {
                id: 'dm-1',
                payload: {content: 'Hello from Portal'},
            },
        },
    ]);
});

test('createDiscordClient serializes queued direct messages per user when Vault Redis is available', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const redisStore = new Map();
    const vaultClient = {
        redisSet: async (key, value) => {
            redisStore.set(key, structuredClone(value));
            return {status: 'ok'};
        },
        redisGet: async key => structuredClone(redisStore.get(key)),
        redisDel: async key => {
            const existed = redisStore.delete(key);
            return {status: 'ok', deleted: existed ? 1 : 0};
        },
    };

    let sendCount = 0;
    fakeClient.users = {
        fetch: async userId => ({
            id: userId,
            send: async payload => {
                sendCount += 1;
                const index = sendCount;
                if (index === 1) {
                    await new Promise(resolve => setTimeout(resolve, 15));
                }
                return {
                    id: `dm-${index}`,
                    payload,
                };
            },
        }),
    };

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands: new Map(),
        clientFactory: () => fakeClient,
        vaultClient,
        messageQueueNamespace: 'portal:test:dm',
        messageQueueTtlSeconds: 60,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const [firstMessage, secondMessage] = await Promise.all([
        discord.sendDirectMessage('discord-user-1', {content: 'first'}),
        discord.sendDirectMessage('discord-user-1', {content: 'second'}),
    ]);

    assert.equal(firstMessage.id, 'dm-1');
    assert.equal(secondMessage.id, 'dm-2');
});

test('createDiscordClient uses Vault Redis list packets for queued direct messages when available', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const redisLists = new Map();
    const vaultClient = {
        redisRPush: async (key, value) => {
            const queue = redisLists.get(key) ?? [];
            queue.push(structuredClone(value));
            redisLists.set(key, queue);
            return {status: 'ok', length: queue.length};
        },
        redisLPop: async key => {
            const queue = redisLists.get(key) ?? [];
            if (!queue.length) {
                return null;
            }

            const [next, ...remaining] = queue;
            if (remaining.length) {
                redisLists.set(key, remaining);
            } else {
                redisLists.delete(key);
            }
            return structuredClone(next);
        },
    };

    let sendCount = 0;
    fakeClient.users = {
        fetch: async userId => ({
            id: userId,
            send: async payload => {
                sendCount += 1;
                const index = sendCount;
                if (index === 1) {
                    await new Promise(resolve => setTimeout(resolve, 15));
                }
                return {
                    id: `dm-${index}`,
                    payload,
                };
            },
        }),
    };

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands: new Map(),
        clientFactory: () => fakeClient,
        vaultClient,
        messageQueueNamespace: 'portal:test:list:dm',
        messageQueueTtlSeconds: 60,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const [firstMessage, secondMessage] = await Promise.all([
        discord.sendDirectMessage('discord-user-1', {content: 'first'}),
        discord.sendDirectMessage('discord-user-1', {content: 'second'}),
    ]);

    assert.equal(firstMessage.id, 'dm-1');
    assert.equal(secondMessage.id, 'dm-2');
});

test('interaction handler executes matching button component handlers', async () => {
    const fakeClient = new FakeClient();
    fakeClient.user = {tag: 'TestBot#0001'};

    const componentCalls = [];
    const commands = new Map([
        ['recommend', {
            definition: {name: 'recommend', description: 'Recommend title'},
            handleComponent: async interaction => {
                if (interaction.customId !== 'recommend:select:abc123:0') {
                    return false;
                }

                componentCalls.push(interaction.customId);
                await interaction.reply({
                    content: 'Handled recommendation button.',
                    ephemeral: true,
                });
                return true;
            },
        }],
    ]);

    const discord = createDiscordClient({
        token: 'test-token',
        guildId: 'guild-123',
        clientId: 'client-abc',
        commands,
        clientFactory: () => fakeClient,
    });

    const loginPromise = discord.login();
    await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
    await loginPromise;

    const replies = [];
    const interaction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => false,
        isButton: () => true,
        customId: 'recommend:select:abc123:0',
        reply: async payload => {
            replies.push(payload);
        },
    };

    await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

    assert.deepEqual(componentCalls, ['recommend:select:abc123:0']);
    assert.deepEqual(replies, [{
        content: 'Handled recommendation button.',
        ephemeral: true,
    }]);
});

test('interaction handler blocks command execution when guild does not match REQUIRED_GUILD_ID', async () => {
    const previousGuild = process.env.REQUIRED_GUILD_ID;
    process.env.REQUIRED_GUILD_ID = 'expected-guild';

    try {
        const fakeClient = new FakeClient();
        fakeClient.user = { tag: 'TestBot#0001' };

        let executed = false;
        const commands = new Map([
            ['ding', { definition: { name: 'ding', description: 'Test ding' }, execute: async () => { executed = true; } }],
        ]);

        const discord = createDiscordClient({
            token: 'test-token',
            guildId: 'guild-123',
            clientId: 'client-abc',
            commands,
            clientFactory: () => fakeClient,
        });

        const loginPromise = discord.login();
        await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
        await loginPromise;

        const replies = [];
        const interaction = {
            isChatInputCommand: () => true,
            commandName: 'ding',
            guildId: 'another-guild',
            reply: async payload => { replies.push(payload); },
            member: { roles: { cache: new Map() } },
            user: { tag: 'Member#0001', id: 'member-001' },
        };

        await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

        assert.equal(executed, false);
        assert.equal(replies.length, 1);
        assert.equal(replies[0].flags, MessageFlags.Ephemeral);
        assert.match(replies[0].content, /server/i);
    } finally {
        if (previousGuild == null) {
            delete process.env.REQUIRED_GUILD_ID;
        } else {
            process.env.REQUIRED_GUILD_ID = previousGuild;
        }
    }
});

test('interaction handler blocks command execution when REQUIRED_ROLE_* is not satisfied', async () => {
    const previousRole = process.env.REQUIRED_ROLE_DING;
    process.env.REQUIRED_ROLE_DING = 'role-123';

    try {
        const fakeClient = new FakeClient();
        fakeClient.user = { tag: 'TestBot#0001' };

        let executed = false;
        const commands = new Map([
            ['ding', { definition: { name: 'ding', description: 'Test ding' }, execute: async () => { executed = true; } }],
        ]);

        const discord = createDiscordClient({
            token: 'test-token',
            guildId: 'guild-123',
            clientId: 'client-abc',
            commands,
            clientFactory: () => fakeClient,
        });

        const loginPromise = discord.login();
        await emitAndWait(fakeClient, Events.ClientReady, fakeClient);
        await loginPromise;

        const replies = [];
        const interaction = {
            isChatInputCommand: () => true,
            commandName: 'ding',
            reply: async payload => { replies.push(payload); },
            member: { roles: { cache: new Map() } },
            guildId: 'guild-123',
            user: { tag: 'Member#0001', id: 'member-001' },
        };

        await emitAndWait(fakeClient, Events.InteractionCreate, interaction);

        assert.equal(executed, false);
        assert.equal(replies.length, 1);
        assert.equal(replies[0].flags, MessageFlags.Ephemeral);
        assert.match(replies[0].content, /permission/i);
    } finally {
        if (previousRole == null) {
            delete process.env.REQUIRED_ROLE_DING;
        } else {
            process.env.REQUIRED_ROLE_DING = previousRole;
        }
    }
});
