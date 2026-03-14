// services/vault/initVault.mjs

/**
 * @fileoverview
 * Vault microservice for handling secure MongoDB and Redis operations from other Noona services.
 */

import dotenv from 'dotenv';
import {debugMSG, isDebugEnabled, log, setDebug, warn} from '../../utilities/etc/logger.mjs';
import {createVaultApp} from './app/createVaultApp.mjs';
import {createVaultServer} from './app/createVaultServer.mjs';

dotenv.config();

const {app, port} = createVaultApp({
    logger: {log, warn, debug: debugMSG},
    isDebugEnabled,
    setDebug,
});

const {server, protocol} = createVaultServer({
    app,
    env: process.env,
});

server.listen(port, () => log(`Vault listening on ${protocol.toUpperCase()} port ${port}`));
