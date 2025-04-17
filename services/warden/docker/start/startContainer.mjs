// docker/start/startContainer.mjs
import Docker from 'dockerode';
import { printAction, printResult, printNote, printError, printDivider } from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Starts an existing container by name if it's not running.
 *
 * @param {string} containerName
 */
export async function startContainer(containerName) {
    try {
        const containers = await docker.listContainers({ all: true });
        const existing = containers.find(c => c.Names.includes(`/${containerName}`));
        if (!existing) {
            printError(`❌ Container "${containerName}" not found.`);
            return;
        }
        const container = docker.getContainer(existing.Id);
        const info = await container.inspect();
        if (!info.State.Running) {
            printAction(`› Starting container: ${containerName}`);
            await container.start();
            printResult(`✔ Started container: ${containerName}`);
        } else {
            printNote(`✔ Container "${containerName}" is already running.`);
        }
        printDivider();
    } catch (err) {
        printError(`❌ Error starting container "${containerName}": ${err.message}`);
        throw err;
    }
}
