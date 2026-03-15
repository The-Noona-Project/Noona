/**
 * @fileoverview Builds the slash-command map Portal registers with Discord.
 * Related files:
 * - commands/dingCommand.mjs
 * - commands/recommendCommand.mjs
 * - commands/scanCommand.mjs
 * - commands/searchCommand.mjs
 * Times this file has been edited: 8
 */

import {log} from '../../../utilities/etc/logger.mjs';
import createDingCommand from './dingCommand.mjs';
import createRecommendCommand from './recommendCommand.mjs';
import createScanCommand from './scanCommand.mjs';
import createSearchCommand from './searchCommand.mjs';
import createSubscribeCommand from './subscribeCommand.mjs';

/**
 * Creates the full set of Portal slash command handlers.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createPortalSlashCommands = ({
                                              getDiscord,
                                              kavita,
                                              raven,
                                              warden,
                                              vault,
                                              moonBaseUrl,
                                              kavitaExternalUrl,
                                          } = {}) => {
    const commands = new Map();

    commands.set('ding', createDingCommand());
    commands.set('scan', createScanCommand({kavita}));
    commands.set('search', createSearchCommand({kavita, vault}));
    commands.set('recommend', createRecommendCommand({
        getDiscord,
        raven,
        kavita,
        vault,
        warden,
        moonBaseUrl,
        kavitaBaseUrl: kavitaExternalUrl,
    }));
    commands.set('subscribe', createSubscribeCommand({
        raven,
        vault,
    }));

    log(`[Portal/Discord] Prepared ${commands.size} slash command handler(s).`);

    return commands;
};

export default createPortalSlashCommands;
