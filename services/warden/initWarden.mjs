// services/warden/initWarden.mjs
import {createWarden} from './core/createWarden.mjs';
import {startWardenServer} from './api/startWardenServer.mjs';
import {errMSG} from '../../utilities/etc/logger.mjs';

export function bootstrapWarden({
    createWardenImpl = createWarden,
    startWardenServerImpl = startWardenServer,
    errWriter = errMSG,
    env = process.env,
    processImpl = process,
    setIntervalImpl = setInterval,
} = {}) {
    const warden = createWardenImpl();
    const apiPort = Number.parseInt(env.WARDEN_API_PORT ?? '4001', 10);
    const readinessState = {
        ready: false,
        startedAt: new Date().toISOString(),
        initializedAt: null,
        error: null,
    };
    const {server: apiServer} = startWardenServerImpl({warden, port: apiPort, readinessState});

    const closeApiServer = () => {
        if (apiServer?.listening) {
            apiServer.close();
        }
    };

    const shutdownAndExit = (code = 1) => {
        const exit = typeof processImpl?.exit === 'function' ? processImpl.exit : null;
        const shutdownAll = typeof warden?.shutdownAll === 'function'
            ? warden.shutdownAll({exit: false, trackedOnly: false})
            : null;

        if (shutdownAll?.then) {
            return shutdownAll.catch(() => null).finally(() => exit?.(code));
        }

        exit?.(code);
        return null;
    };

    const handleFatalError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        readinessState.ready = false;
        readinessState.error = message;
        errWriter?.(`[Warden Init] ❌ Fatal: ${message}`);
        closeApiServer();
        return shutdownAndExit(1);
    };

    if (typeof processImpl?.on === 'function') {
        processImpl.on('SIGINT', () => {
            closeApiServer();
            void warden.shutdownAll({trackedOnly: false});
        });

        processImpl.on('SIGTERM', () => {
            closeApiServer();
            void warden.shutdownAll({trackedOnly: false});
        });
    }

    const initPromise = Promise.resolve(warden.init())
        .then(() => {
            readinessState.ready = true;
            readinessState.initializedAt = new Date().toISOString();
            readinessState.error = null;
            setIntervalImpl?.(() => process.stdout.write('.'), 60000);
        })
        .catch(handleFatalError);

    return {
        apiServer,
        readinessState,
        warden,
        closeApiServer,
        handleFatalError,
        initPromise,
    };
}

const isDirectRun = (() => {
    try {
        const entry = process.argv?.[1];
        if (!entry) {
            return false;
        }

        return import.meta.url === new URL(`file://${entry}`).href;
    } catch {
        return false;
    }
})();

if (isDirectRun) {
    bootstrapWarden();
}
