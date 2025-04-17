/**
 * @fileoverview
 * Initializes and returns a MariaDB connection wrapper for Noona-Vault.
 *
 * @module initMariadb
 */

import connectMariadb from './connectMariadb.mjs';
import { printError } from '../../noona/logger/logUtils.mjs';

/**
 * Initializes the MariaDB client and wraps it for global use.
 *
 * @async
 * @function
 * @returns {Promise<{connection: import('mysql2/promise').Connection} | false>} Wrapped connection or false
 */
export default async function initMariaDB() {
    const connection = await connectMariadb();
    if (!connection) {
        printError('❌ Failed to initialize MariaDB connection.');
        return false;
    }
    return { connection };
}
