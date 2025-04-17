// /noona/warden/docker/update/getMetadata.mjs

import Docker from 'dockerode';
const docker = new Docker();

/**
 * Gets the size of an image by name.
 * @param {string} imageName
 * @returns {Promise<number>} Size in bytes
 */
export async function getImageSize(imageName) {
    try {
        const image = docker.getImage(imageName);
        const inspect = await image.inspect();
        return inspect.Size || 0;
    } catch (err) {
        return 0;
    }
}

/**
 * Converts bytes into human-readable format.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    return `${size} ${sizes[i]}`;
}

/**
 * Returns ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
 * @param {number} num
 * @returns {string}
 */
export function ordinalSuffix(num) {
    const j = num % 10, k = num % 100;
    if (j === 1 && k !== 11) return `${num}st`;
    if (j === 2 && k !== 12) return `${num}nd`;
    if (j === 3 && k !== 13) return `${num}rd`;
    return `${num}th`;
}
