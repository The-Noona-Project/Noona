// services/portal/tests/discordClient.test.mjs

import EventEmitter from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Events } from 'discord.js';

import { createDiscordClient } from '../shared/discordClient.mjs';
import createPortalSlashCommands from '../shared/discordCommands.mjs';

class FakeClient extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.lastLoginToken = null;
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

test('createDiscordClient registers slash commands during login', async () => {
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
    assert.equal(fakeClient.application.commands.calls.length, 1);
    const [{ definitions, guildId }] = fakeClient.application.commands.calls;
    assert.equal(guildId, 'guild-123');
    assert.deepEqual(definitions, [{ name: 'ding', description: 'Test ding' }]);
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
    assert.equal(replies[0].ephemeral, true);
    assert.match(replies[0].content, /Dong/i);
});
