// docker/builld/buildNetwork.mjs

import Docker from 'dockerode';
import {
    printResult,
    printError,
    printDebug
} from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Ensures a Docker network exists.
 * - Skips creation if network is "bridge"
 * - Uses bridge driver for custom networks
 *
 * @param {string} networkName - Name of the Docker network to ensure
 */
export const ensureNetworkExists = async (networkName) => {
    try {
        if (networkName === 'bridge') {
            printDebug(`Skipping creation for default network: ${networkName}`);
            return; // Do not try to create the default bridge network
        }

        printDebug(`Listing Docker networks to check if "${networkName}" exists...`);
        const networks = await docker.listNetworks();
        printDebug(`Found ${networks.length} networks`);
        const exists = networks.some(net => net.Name === networkName);

        if (!exists) {
            printDebug(`Network "${networkName}" not found. Attempting to create it...`);
            await docker.createNetwork({
                Name: networkName,
                Driver: 'bridge'
            });
            printResult(`Created Docker network: ${networkName}`);
        } else {
            printResult(`Docker network "${networkName}" already exists`);
        }
    } catch (err) {
        printError(`❌ Failed to ensure Docker network "${networkName}": ${err.message}`);
        throw err;
    }
};
