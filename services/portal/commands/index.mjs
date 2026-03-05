import {log} from '../../../utilities/etc/logger.mjs';
import createDingCommand from './dingCommand.mjs';
import createJoinCommand from './joinCommand.mjs';
import createRecommendCommand from './recommendCommand.mjs';
import createScanCommand from './scanCommand.mjs';
import createSearchCommand from './searchCommand.mjs';

export const createPortalSlashCommands = ({
                                              discord,
                                              getDiscord,
                                              kavita,
                                              raven,
                                              vault,
                                              onboardingStore,
                                              joinDefaults,
                                          } = {}) => {
    const commands = new Map();

    commands.set('ding', createDingCommand());
    commands.set('join', createJoinCommand({
        discord,
        getDiscord,
        kavita,
        vault,
        onboardingStore,
        joinDefaults,
    }));
    commands.set('recommend', createRecommendCommand({
        raven,
        kavita,
        vault,
    }));
    commands.set('scan', createScanCommand({kavita}));
    commands.set('search', createSearchCommand({kavita, vault}));

    log(`[Portal/Discord] Prepared ${commands.size} slash command handler(s).`);

    return commands;
};

export default createPortalSlashCommands;
