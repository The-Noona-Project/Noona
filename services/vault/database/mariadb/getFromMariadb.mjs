/**
 * @fileoverview
 * Executes a SELECT query against MariaDB using a connection instance.
 * Also provides a helper to access the global MariaDB connection.
 *
 * @module getFromMariadb
 */

import { printDebug, printError } from '../../noona/logger/logUtils.mjs';

/**
 * Executes a SELECT query against MariaDB.
 *
 * @async
 * @function
 * @param {import('mysql2/promise').Connection} connection - MariaDB connection instance
 * @param {string} query - SQL query string
 * @param {Array<any>} [values=[]] - Optional parameters for the query
 * @returns {Promise<Array|null>} Query result rows or null if failed
 */
export async function getFromMariadb(connection, query, values = []) {
    if (!connection) {
        printError('[MariaDB] Connection not available');
        return null;
    }
    try {
        const [rows] = await connection.execute(query, values);
        printDebug(`[MariaDB] Fetched ${rows.length} rows`);
        return rows;
    } catch (err) {
        printError(`[MariaDB] Query failed: ${err.message}`);
        return null;
    }
}

/**
 * Returns the globally stored MariaDB connection instance.
 *
 * @function
 * @returns {import('mysql2/promise').Connection | undefined} Global MariaDB connection
 */
export function getMariaDBConnection() {
    return global.noonaMariaConnection;
}
