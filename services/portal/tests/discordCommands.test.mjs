// services/portal/tests/discordCommands.test.mjs

import assert from 'node:assert/strict';
import {test} from 'node:test';

import createPortalSlashCommands from '../shared/discordCommands.mjs';

test('search command returns friendly response when Kavita user is missing', async () => {
    const kavita = {
        fetchUser: async () => {
            const error = new Error('Not found');
            error.status = 404;
            throw error;
        },
    };

    const vault = {
        readSecret: async () => null,
    };

    const commands = createPortalSlashCommands({kavita, vault});
    const command = commands.get('search');
    assert.ok(command, 'Expected search command to be registered.');

    const edits = [];
    const interaction = {
        deferred: false,
        replied: false,
        options: {
            getString: (name) => {
                if (name === 'username') return 'missing-user';
                if (name === 'discord_id') return null;
                return null;
            },
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async (payload) => {
            interaction.replied = true;
            edits.push(payload);
        },
    };

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, true);
    assert.match(edits[0].content, /No Kavita user found/i);
});

