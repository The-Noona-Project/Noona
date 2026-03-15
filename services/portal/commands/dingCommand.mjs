/**
 * @fileoverview Defines the `/ding` Discord health-check command.
 * Related files:
 * - commands/index.mjs
 * - discord/interactionRouter.mjs
 * - tests/discordCommands.test.mjs
 * Times this file has been edited: 3
 */

import {MessageFlags} from 'discord.js';

/**
 * Creates ding command.
 *
 * @returns {*} The function result.
 */
export const createDingCommand = () => ({
    definition: {
        name: 'ding',
        description: 'Check if the Noona Portal bot is awake.',
    },
    execute: async interaction => {
        await interaction.reply?.({
            content: 'Dong! Portal is online.',
            flags: MessageFlags.Ephemeral,
        });
    },
});

export default createDingCommand;
