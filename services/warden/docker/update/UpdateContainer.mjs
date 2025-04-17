// docker/update/UpdateContainer.mjs
import { deleteContainer } from '../stop/deleteContainer.mjs';
import { createContainer } from '../start/createContainer.mjs';
import { printAction, printResult, printError, printDivider } from '../../noona/logger/logUtils.mjs';

/**
 * Updates a container by deleting the existing instance (if any)
 * and then creating a fresh container using the preset configuration.
 *
 * @param {string} containerName - The name of the container to update.
 */
export default async function updateContainer(containerName) {
    try {
        printAction(`Updating container: ${containerName}`);
        // Delete the existing container (force removal if necessary)
        await deleteContainer(containerName);
        // Create a fresh instance of the container (pulling image if needed)
        await createContainer(containerName);
        printResult(`✔ Updated container: ${containerName}`);
        printDivider();
    } catch (err) {
        printError(`❌ Failed to update container "${containerName}": ${err.message}`);
        throw err;
    }
}
