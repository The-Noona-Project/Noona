// services/vault/initVault.mjs

/**
 * @fileoverview
 * Vault microservice for handling secure MongoDB and Redis operations from other Noona services.
 */

import dotenv from 'dotenv';
import {debugMSG, isDebugEnabled, log, setDebug, warn} from '../../utilities/etc/logger.mjs';
import {createVaultApp} from './shared/vaultApp.mjs';

dotenv.config();

const {app, port} = createVaultApp({
    logger: {log, warn, debug: debugMSG},
    isDebugEnabled,
    setDebug,
});

app.listen(port, () => log(`Vault listening on port ${port}`));
