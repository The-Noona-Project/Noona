// docker/healthChecker.mjs

import Docker from 'dockerode';
import {
    printResult,
    printSection,
    printError,
    printNote
} from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Waits for a Docker container to report "healthy" within the specified timeout.
 * Logs progress every 30 seconds and handles containers with missing health checks.
 *
 * @param {string} containerName - The Docker container name
 * @param {number} timeoutMs - Max wait time (default: 180000ms)
 */
export const waitForContainerHealth = async (containerName, timeoutMs = 180000) => {
    printSection(`🩺 Waiting for container to become healthy: ${containerName}`);

    const container = docker.getContainer(containerName);
    const start = Date.now();
    const logInterval = 30000;
    let lastLog = 0;

    while (Date.now() - start < timeoutMs) {
        try {
            const data = await container.inspect();

            if (!data?.State) {
                printError(`❌ ${containerName} has no state info available`);
                throw new Error(`Missing State object for ${containerName}`);
            }

            const health = data.State.Health?.Status;

            if (health === 'healthy') {
                printResult(`✔ ${containerName} is healthy`);
                return;
            }

            // If no health checks are defined at all
            if (!data.State.Health) {
                printNote(`⚠️ ${containerName} has no health check defined – skipping health wait`);
                return;
            }

            // Log interim wait status every 30s
            const now = Date.now();
            if (now - lastLog >= logInterval) {
                printNote(`⌛ Still waiting for ${containerName}... Status: ${health || 'unknown'}`);
                lastLog = now;
            }

        } catch (err) {
            printError(`❌ Failed to inspect ${containerName}: ${err.message}`);
        }

        await new Promise(res => setTimeout(res, 5000));
    }

    printError(`⏱️ Timeout: ${containerName} did not become healthy in time.`);
    throw new Error(`Timeout waiting for healthy container: ${containerName}`);
};
