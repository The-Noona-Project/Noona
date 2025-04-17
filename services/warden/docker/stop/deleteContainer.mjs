// docker/stop/deleteContainer.mjs
import Docker from 'dockerode';
import { printAction, printResult, printError, printNote, printDivider } from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Deletes (removes) a Docker container by name.
 * Force-removes the container if necessary.
 *
 * @param {string} containerName - The name of the container to delete.
 */
export async function deleteContainer(containerName) {
    try {
        const containers = await docker.listContainers({ all: true });
        const target = containers.find(c => c.Names.includes(`/${containerName}`));

        if (!target) {
            printNote(`Container "${containerName}" not found. Nothing to delete.`);
            return;
        }

        const container = docker.getContainer(target.Id);
        printAction(`Deleting container: ${containerName}`);
        await container.remove({ force: true });
        printResult(`✔ Deleted container: ${containerName}`);
        printDivider();
    } catch (err) {
        printError(`❌ Error deleting container "${containerName}": ${err.message}`);
        throw err;
    }
}

/**
 * Deletes (removes) a Docker image by name.
 *
 * @param {string} imageName - The name (or tag) of the image to delete.
 */
export async function deleteImage(imageName) {
    try {
        const image = docker.getImage(imageName);
        printAction(`Deleting image: ${imageName}`);
        await image.remove({ force: true });
        printResult(`✔ Deleted image: ${imageName}`);
        printDivider();
    } catch (err) {
        printError(`❌ Error deleting image "${imageName}": ${err.message}`);
        throw err;
    }
}
