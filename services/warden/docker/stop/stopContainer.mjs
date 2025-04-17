// docker/stop/stopContainer.mjs
import Docker from 'dockerode';
import { printAction, printResult, printError, printNote, printDivider } from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Stops a Docker container by name if it is running.
 *
 * @param {string} containerName - The name of the container to stop.
 */
export async function stopContainer(containerName) {
    try {
        // List all containers (including stopped ones)
        const containers = await docker.listContainers({ all: true });
        const target = containers.find(c => c.Names.includes(`/${containerName}`));

        if (!target) {
            printError(`❌ Container "${containerName}" not found.`);
            return;
        }

        const container = docker.getContainer(target.Id);
        const info = await container.inspect();

        if (info.State.Running) {
            printAction(`Stopping container: ${containerName}`);
            await container.stop();
            printResult(`✔ Stopped container: ${containerName}`);
        } else {
            printNote(`Container "${containerName}" is not running.`);
        }
        printDivider();
    } catch (err) {
        printError(`❌ Error stopping container "${containerName}": ${err.message}`);
        throw err;
    }
}
