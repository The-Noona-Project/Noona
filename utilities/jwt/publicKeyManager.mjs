/**
 * @fileoverview
 * High-level wrapper functions for managing JWT public keys in Redis.
 * These abstract calls to underlying route-layer logic and are used
 * internally by Vault and other Noona components.
 *
 * @module publicKeyManager
 */

import { handleCreateKey } from '../restAPI/v2/redis/publicKey/create/createKey.mjs';
import { handleReadKey } from '../restAPI/v2/redis/publicKey/read/readKey.mjs';
import { handleUpdateKey } from '../restAPI/v2/redis/publicKey/update/updateKey.mjs';
import { handleDeleteKey } from '../restAPI/v2/redis/publicKey/delete/deleteKey.mjs';

/**
 * Creates and stores a public key in Redis for a Noona service.
 *
 * @param {string} service - Name of the target service (e.g., "noona-portal")
 * @param {string} publicKey - PEM-formatted RSA public key
 * @returns {Promise<boolean>} Whether the key was successfully stored
 */
export async function createPublicKey(service, publicKey) {
    return await handleCreateKey(service, publicKey);
}

/**
 * Retrieves a service's stored public key from Redis.
 *
 * @param {string} service - Name of the service
 * @returns {Promise<string|null>} The PEM public key string, or null if not found
 */
export async function readPublicKey(service) {
    return await handleReadKey(service);
}

/**
 * Updates (replaces) a service’s stored public key in Redis.
 *
 * @param {string} service - Name of the service
 * @param {string} publicKey - New PEM-formatted RSA public key
 * @returns {Promise<boolean>} Whether the update was successful
 */
export async function updatePublicKey(service, publicKey) {
    return await handleUpdateKey(service, publicKey);
}

/**
 * Deletes a stored public key from Redis for a service.
 *
 * @param {string} service - Name of the service
 * @returns {Promise<boolean>} Whether the key was successfully deleted
 */
export async function deletePublicKey(service) {
    return await handleDeleteKey(service);
}
