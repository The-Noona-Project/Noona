import assert from 'node:assert/strict';
import test from 'node:test';
import {Routes} from 'discord.js';

import {
    formatCommandInventory,
    listApplicationCommands,
    resolveDiscordCommandConfig,
    summarizeCommandInventory,
} from '../shared/discord/commandInspector.mjs';

test('resolveDiscordCommandConfig only requires Discord credentials', () => {
    const config = resolveDiscordCommandConfig({
        env: {
            DISCORD_BOT_TOKEN: 'bot-token',
            DISCORD_CLIENT_ID: 'client-id',
        },
    });

    assert.equal(config.token, 'bot-token');
    assert.equal(config.clientId, 'client-id');
    assert.equal(config.guildId, null);
});

test('listApplicationCommands fetches global and guild commands and sorts them', async () => {
    const calls = [];
    const restFactory = () => ({
        get: async route => {
            calls.push(route);

            if (route === Routes.applicationCommands('client-123')) {
                return [
                    {id: '2', name: 'scan', description: 'Scan libraries', type: 1},
                    {id: '1', name: 'ding', description: 'Health check', type: 1},
                ];
            }

            if (route === Routes.applicationGuildCommands('client-123', 'guild-456')) {
                return [
                    {id: '3', name: 'join', description: 'Onboard', type: 1},
                    {id: '4', name: 'ding', description: 'Guild health', type: 1},
                ];
            }

            throw new Error(`Unexpected route: ${route}`);
        },
    });

    const inventory = await listApplicationCommands({
        token: 'bot-token',
        clientId: 'client-123',
        guildId: 'guild-456',
        restFactory,
    });

    assert.deepEqual(calls, [
        Routes.applicationCommands('client-123'),
        Routes.applicationGuildCommands('client-123', 'guild-456'),
    ]);

    assert.deepEqual(inventory.globalCommands.map(command => command.name), ['ding', 'scan']);
    assert.deepEqual(inventory.guildCommands.map(command => command.name), ['ding', 'join']);
});

test('summarizeCommandInventory reports duplicate names across scopes', () => {
    const summary = summarizeCommandInventory({
        clientId: 'client-123',
        guildId: 'guild-456',
        globalCommands: [
            {id: '1', name: 'ding', description: 'Health check'},
        ],
        guildCommands: [
            {id: '2', name: 'ding', description: 'Guild health'},
            {id: '3', name: 'join', description: 'Onboard'},
        ],
    });

    assert.deepEqual(summary.duplicateNames, ['ding']);
    assert.equal(summary.globalCount, 1);
    assert.equal(summary.guildCount, 2);
});

test('formatCommandInventory prints a readable report', () => {
    const report = formatCommandInventory({
        clientId: 'client-123',
        guildId: 'guild-456',
        globalCommands: [
            {id: '1', name: 'ding', description: 'Health check'},
        ],
        guildCommands: [
            {id: '2', name: 'join', description: 'Onboard member'},
        ],
    });

    assert.match(report, /Application client id: client-123/);
    assert.match(report, /Configured guild id: guild-456/);
    assert.match(report, /Global commands: 1/);
    assert.match(report, /Guild commands: 1/);
    assert.match(report, /\/ding :: Health check/);
    assert.match(report, /\/join :: Onboard member/);
});

