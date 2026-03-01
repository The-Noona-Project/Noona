import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const ensureArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

export const syncGuildCommands = async ({
                                            commandManager,
                                            guildId,
                                            definitions = [],
                                            clearGlobalBeforeRegister = true,
                                            clearBeforeRegister = true,
                                        } = {}) => {
    if (!commandManager || typeof commandManager.set !== 'function') {
        throw new Error('Discord application command manager is unavailable.');
    }

    const commandDefinitions = ensureArray(definitions);

    try {
        if (clearGlobalBeforeRegister) {
            await commandManager.set([]);
            log('[Portal/Discord] Cleared global slash commands for current application.');
        }

        if (clearBeforeRegister) {
            await commandManager.set([], guildId);
            log(`[Portal/Discord] Cleared slash commands for guild ${guildId}.`);
        }

        if (commandDefinitions.length === 0) {
            log(`[Portal/Discord] No slash command definitions available for guild ${guildId}.`);
            return {
                clearedGlobal: clearGlobalBeforeRegister,
                cleared: clearBeforeRegister,
                registered: 0,
            };
        }

        await commandManager.set(commandDefinitions, guildId);
        log(`[Portal/Discord] Registered ${commandDefinitions.length} slash command(s) for guild ${guildId}.`);

        return {
            clearedGlobal: clearGlobalBeforeRegister,
            cleared: clearBeforeRegister,
            registered: commandDefinitions.length,
        };
    } catch (error) {
        errMSG(`[Portal/Discord] Failed to synchronize slash commands: ${error.message}`);
        throw error;
    }
};
