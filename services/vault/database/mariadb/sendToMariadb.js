/**
 * @fileoverview
 * Executes INSERT, UPDATE, or DELETE queries against MariaDB using a connection instance.
 * Logs query results or errors during execution.
 *
 * @module sendToMariadb
 */

import { printResult, printError, printDebug } from '../../noona/logger/logUtils.mjs';

/**
 * Executes a parameterized write query (INSERT, UPDATE, DELETE).
 *
 * @async
 * @function
 * @param {import('mysql2/promise').Connection} connection - MariaDB connection
 * @param {string} query - SQL statement to execute
 * @param {Array<any>} [values=[]] - Parameterized values for the query
 * @returns {Promise<object|false>} Query result object or false if failed
 */
export async function sendToMariadb(connection, query, values = []) {
    if (!connection) {
        printError('[MariaDB] Connection not available');
        return false;
    }

    try {
        const [result] = await connection.execute(query, values);
        printResult(`[MariaDB] Query executed successfully`);
        return result;
    } catch (err) {
        printError(`[MariaDB] Query execution failed: ${err.message}`);
        printDebug(err);
        return false;
    }
}
