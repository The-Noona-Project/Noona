import {log} from '../../../utilities/etc/logger.mjs';
import createDingCommand from './dingCommand.mjs';
import createJoinCommand from './joinCommand.mjs';
import createRecommendCommand from './recommendCommand.mjs';
import createScanCommand from './scanCommand.mjs';
import createSearchCommand from './searchCommand.mjs';
import createSubscribeCommand from './subscribeCommand.mjs';

export const createPortalSlashCommands = ({
                                              discord,
                                              getDiscord,
                                              kavita,
                                              raven,
                                              warden,
                                              vault,
                                              moonBaseUrl,
                                              kavitaExternalUrl,
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
        discord,
        getDiscord,
        raven,
        kavita,
        vault,
        warden,
        moonBaseUrl,
        kavitaBaseUrl: kavitaExternalUrl,
    }));
    commands.set('scan', createScanCommand({kavita}));
    commands.set('search', createSearchCommand({kavita, vault}));
    commands.set('subscribe', createSubscribeCommand({
        raven,
        vault,
    }));

    log(`[Portal/Discord] Prepared ${commands.size} slash command handler(s).`);

    return commands;
};

export default createPortalSlashCommands;
