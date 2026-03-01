// services/portal/initPortal.mjs

import {errMSG} from '../../utilities/etc/logger.mjs';
import {createSignalHandler, startPortal, stopPortal} from './app/portalRuntime.mjs';

const isDirectRun = (() => {
    if (!process.argv[1]) {
        return false;
    }

    try {
        const entryUrl = new URL(process.argv[1], 'file:');
        return entryUrl.href === import.meta.url;
    } catch (error) {
        return false;
    }
})();

if (isDirectRun) {
    startPortal().catch((error) => {
        errMSG(`[Portal] Failed to start: ${error.message}`);
        process.exit(1);
    });

    process.on('SIGINT', () => createSignalHandler('SIGINT'));
    process.on('SIGTERM', () => createSignalHandler('SIGTERM'));

    setInterval(() => process.stdout.write('.'), 60000);
}

export {startPortal, stopPortal};
export default startPortal;
