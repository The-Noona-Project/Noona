// docker/update/checkForUpdate.mjs
import Docker from 'dockerode';
import { printDebug, printNote, printError } from '../../noona/logger/logUtils.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Parses an image string into its components.
 * Example: "captainpax/noona-vault:latest" -> { namespace: "captainpax", repository: "noona-vault", tag: "latest" }
 *
 * @param {string} imageStr - Full image string.
 * @returns {{ namespace: string, repository: string, tag: string }}
 */
function parseImageName(imageStr) {
    const [repoPart, tagPart] = imageStr.split(':');
    const parts = repoPart.split('/');
    return {
        namespace: parts[0],
        repository: parts[1],
        tag: tagPart || 'latest'
    };
}

/**
 * Checks Docker Hub for update info on a single image.
 *
 * @param {string} imageStr - Full image name (e.g., "captainpax/noona-vault:latest").
 * @returns {Promise<{ updateAvailable: boolean, remoteLastUpdated?: string, localCreated?: string }>}
 */
async function checkImageUpdate(imageStr) {
    try {
        const { namespace, repository, tag } = parseImageName(imageStr);
        const url = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${tag}/`;
        printDebug(`Fetching update metadata from: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            printError(`Failed to fetch metadata for ${imageStr}: ${response.statusText}`);
            return { updateAvailable: false };
        }

        const data = await response.json();
        const remoteLastUpdated = new Date(data.last_updated);

        // Get local image info.
        let localCreated;
        try {
            const localInfo = await docker.getImage(imageStr).inspect();
            localCreated = new Date(localInfo.Created);
        } catch (err) {
            // If image is not found locally, consider update available.
            printNote(`Image ${imageStr} not found locally.`);
            return { updateAvailable: true, remoteLastUpdated: data.last_updated, localCreated: null };
        }

        const updateAvailable = remoteLastUpdated > localCreated;
        return {
            updateAvailable,
            remoteLastUpdated: data.last_updated,
            localCreated: localCreated.toISOString()
        };
    } catch (err) {
        printError(`Error checking update for image ${imageStr}: ${err.message}`);
        return { updateAvailable: false };
    }
}

/**
 * Checks Docker Hub for updates for all Noona images.
 * Returns an array of update objects if updates are available.
 *
 * @returns {Promise<Array<{ container: string, currentImage: string, newImage: string }>>}
 */
export default async function checkForUpdate() {
    // Define the Noona images you wish to check.
    const imagesToCheck = [
        { container: 'noona-vault', image: 'captainpax/noona-vault:latest' },
        { container: 'noona-portal', image: 'captainpax/noona-portal:latest' }
        // Add more images as needed.
    ];

    const updates = [];

    for (const { container, image } of imagesToCheck) {
        const result = await checkImageUpdate(image);
        if (result.updateAvailable) {
            printNote(`Update available for ${container}: remote updated at ${result.remoteLastUpdated}, local created at ${result.localCreated}`);
            // In this case, we assume the new image is still tagged "latest".
            updates.push({ container, currentImage: image, newImage: image });
        } else {
            printNote(`No update for ${container}: local image is up-to-date.`);
        }
    }

    return updates;
}
