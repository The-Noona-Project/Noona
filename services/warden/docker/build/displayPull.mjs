// /noona/warden/docker/displayPull.mjs

import { makeLoadBar } from '../../noona/logger/makeLoadBar.mjs';
import {
    printSubHeader,
    printNote,
    printResult,
    printDivider,
    printError
} from '../../noona/logger/logUtils.mjs';
import { formatBytes, ordinalSuffix } from '../update/getMetadata.mjs';

/**
 * Handles Docker image pull progress with precise milestone logging per layer.
 * @param {import('dockerode')} docker - Dockerode instance
 * @param {NodeJS.ReadableStream} stream - Docker pull stream
 * @param {string} imageName - Name of the Docker image
 */
export async function handlePullProgress(docker, stream, imageName) {
    return new Promise((resolve, reject) => {
        try {
            const layers = {};
            const printed = {};

            docker.modem.followProgress(stream, onFinished, onProgress);

            function onProgress(event) {
                const { id, progressDetail, status } = event;

                if (!id) return;

                if (!layers[id]) {
                    layers[id] = {
                        current: 0,
                        total: progressDetail?.total || 0,
                        index: Object.keys(layers).length + 1
                    };
                    printed[id] = { zero: false, hundred: false };
                }

                // Handle cached or "already exists"
                if (status?.includes('Cached') || status?.includes('Already exists')) {
                    if (!printed[id].hundred) {
                        const bar = makeLoadBar(100);
                        printResult(`✔ ${bar} 100% of ${ordinalSuffix(layers[id].index)} layer ${id} (cached)`);
                        printed[id].hundred = true;
                    }
                    return;
                }

                if (!progressDetail?.total || !progressDetail?.current) return;

                layers[id].current = progressDetail.current;
                layers[id].total = progressDetail.total;

                if (!printed[id].zero) {
                    printSubHeader(`❇️ Downloading ${ordinalSuffix(layers[id].index)} layer: ${id}`);
                    printNote(`Size: ${formatBytes(layers[id].total)}`);
                    const bar = makeLoadBar(0);
                    printResult(`🔻 ${bar} 0% of ${ordinalSuffix(layers[id].index)} layer ${id}`);
                    printed[id].zero = true;
                }

                if (
                    progressDetail.current >= progressDetail.total &&
                    !printed[id].hundred
                ) {
                    const bar = makeLoadBar(100);
                    printResult(`✔ ${bar} 100% of ${ordinalSuffix(layers[id].index)} layer ${id}`);
                    printed[id].hundred = true;
                }
            }

            function onFinished(err) {
                if (err) {
                    printError(`❌ Failed to pull image: ${imageName}`);
                    return reject(err);
                }

                const totalSize = Object.values(layers).reduce((acc, l) => acc + l.total, 0);
                if (totalSize === 0) {
                    printResult(`✔ Pulled: ${imageName} (cached)`);
                } else {
                    printResult(`✔ Pulled: ${imageName}`);
                    printNote(`› › Total Size: ${formatBytes(totalSize)}`);
                }

                printDivider();
                resolve();
            }

        } catch (err) {
            printError(`❌ Error during pull of ${imageName}: ${err.message}`);
            reject(err);
        }
    });
}
