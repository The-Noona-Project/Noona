// docker/build/downloadImages.mjs

import Docker from 'dockerode';
import { handlePullProgress } from './displayPull.mjs';
import { getImageSize, formatBytes } from '../update/getMetadata.mjs';
import {
    printSubHeader,
    printSpacer,
    printDivider,
    printError,
    printNote,
    printDownloadSummary,
    printResult
} from '../../noona/logger/logUtils.mjs';
import { getContainerPresets } from '../start/containerPresets.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Checks if an image already exists locally.
 * @param {string} imageName
 * @returns {Promise<boolean>}
 */
async function imageExistsLocally(imageName) {
    try {
        const images = await docker.listImages();
        return images.some(img => img.RepoTags && img.RepoTags.includes(imageName));
    } catch (err) {
        printError(`❌ Failed to check local images: ${err.message}`);
        return false;
    }
}

/**
 * Pulls all required dependency images for Warden core.
 */
export async function pullDependencyImages() {
    const containerPresets = getContainerPresets();

    printDivider();
    printSubHeader('📦 Downloading Docker Images');
    printDivider();

    const dependencyContainers = [
        'noona-redis',
        'noona-mongodb',
        'noona-mariadb'
    ];

    const uniqueImages = [
        ...new Set(
            dependencyContainers
                .map(name => containerPresets[name])
                .filter(Boolean)
                .map(preset => preset.Image)
        )
    ];

    for (const imageName of uniqueImages) {
        printSpacer();
        printSubHeader(`📦 Image: ${imageName}`);

        try {
            const exists = await imageExistsLocally(imageName);

            if (exists) {
                printResult(`✔ Reusing image: ${imageName}`);
                const size = await getImageSize(imageName);
                printNote(`› › Total Size: ${formatBytes(size)}`);
                printDivider();
                continue;
            }

            printNote(`Pulling image: ${imageName}...`);
            const pullStream = await docker.pull(imageName);
            await handlePullProgress(docker, pullStream, imageName);
            const size = await getImageSize(imageName);
            printNote(`› › Downloaded Size: ${formatBytes(size)}`);
            printDivider();
        } catch (err) {
            printError(`❌ Failed to pull ${imageName}: ${err.message}`);
            printDivider();
        }
    }

    printDownloadSummary();
}

/**
 * Pulls Docker images for core Noona services like vault/portal/etc.
 */
export async function pullNoonaImages() {
    const containerPresets = getContainerPresets();

    printDivider();
    printSubHeader('📦 Downloading Noona Component Images');
    printDivider();

    const noonaServices = [
        'noona-vault',
        'noona-portal'
    ];

    const uniqueImages = [
        ...new Set(
            noonaServices
                .map(name => containerPresets[name])
                .filter(Boolean)
                .map(preset => preset.Image)
        )
    ];

    for (const imageName of uniqueImages) {
        printSpacer();
        printSubHeader(`📦 Image: ${imageName}`);

        try {
            const exists = await imageExistsLocally(imageName);

            if (exists) {
                printResult(`✔ Reusing image: ${imageName}`);
                const size = await getImageSize(imageName);
                printNote(`› › Total Size: ${formatBytes(size)}`);
                printDivider();
                continue;
            }

            printNote(`Pulling image: ${imageName}...`);
            const pullStream = await docker.pull(imageName);
            await handlePullProgress(docker, pullStream, imageName);
            const size = await getImageSize(imageName);
            printNote(`› › Downloaded Size: ${formatBytes(size)}`);
            printDivider();
        } catch (err) {
            printError(`❌ Failed to pull ${imageName}: ${err.message}`);
            printDivider();
        }
    }

    printDownloadSummary();
}
