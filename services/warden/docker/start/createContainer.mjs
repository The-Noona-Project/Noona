// docker/start/createContainer.mjs
import Docker from 'dockerode';
import {
    printAction,
    printResult,
    printStep,
    printError,
    printNote,
    printDivider,
    printDebug
} from '../../noona/logger/logUtils.mjs';
import { getContainerPresets } from '../start/containerPresets.mjs';
import path from 'path';
import fs from 'fs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Define core Noona containers that should receive the private key
const NOONA_CORE_SERVICES = ['noona-vault', 'noona-portal', 'noona-oracle', 'noona-raven', 'noona-moon', 'noona-sage'];

export async function createContainer(containerName) {
    const presets = getContainerPresets();
    const preset = presets[containerName];

    if (!preset) {
        printError(`❌ No preset found for container: ${containerName}`);
        return;
    }

    const imageName = preset.Image;

    // ───── Remove existing container if needed ─────
    const containers = await docker.listContainers({ all: true });
    const existing = containers.find(c => c.Names.includes(`/${containerName}`));
    if (existing) {
        const container = docker.getContainer(existing.Id);
        printAction(`🔌 Removing existing container ${containerName} for fresh creation...`);
        try {
            await container.remove({ force: true });
            printResult(`✔ Removed existing container: ${containerName}`);
        } catch (err) {
            printError(`❌ Failed to remove container ${containerName}: ${err.message}`);
            throw err;
        }
    }

    // ───── Pull image if not already pulled ─────
    const images = await docker.listImages();
    const pulled = images.some(img =>
        (img.RepoTags || []).some(tag => tag === imageName || tag === `${imageName}:latest`)
    );

    if (!pulled) {
        printStep(`› Pulling image: ${imageName}`);
        await new Promise((resolve, reject) => {
            docker.pull(imageName, (err, stream) => {
                if (err) return reject(err);
                docker.modem.followProgress(stream, onFinished, onProgress);
                function onFinished(err) {
                    if (err) return reject(err);
                    printResult(`✔ Pulled image: ${imageName}`);
                    resolve();
                }
                function onProgress() {}
            });
        });
    } else {
        printNote(`✔ Reusing local image: ${imageName}`);
    }

    // ───── Inject private key if this is a Noona core service ─────
    if (NOONA_CORE_SERVICES.includes(containerName)) {
        const privateKeyPath = path.join('/noona/family/noona-warden/files/keys', 'private.pem');
        try {
            if (!fs.existsSync(privateKeyPath)) throw new Error('Private key missing');
            const currentPrivateKey = fs.readFileSync(privateKeyPath, 'utf-8');
            printDebug(`[createContainer] Read private key from: ${privateKeyPath}`);
            if (Array.isArray(preset.Env)) {
                const keyLine = `JWT_PRIVATE_KEY=${currentPrivateKey}`;
                const index = preset.Env.findIndex(e => e.startsWith('JWT_PRIVATE_KEY='));
                if (index !== -1) {
                    preset.Env[index] = keyLine;
                    printDebug(`[createContainer] Updated JWT_PRIVATE_KEY for ${containerName}`);
                } else {
                    preset.Env.push(keyLine);
                    printDebug(`[createContainer] Injected JWT_PRIVATE_KEY for ${containerName}`);
                }
            }
        } catch (err) {
            printError(`[createContainer] Error injecting private key: ${err.message}`);
            throw err;
        }
    }

    // ───── ENV Debug & Validation ─────
    if (Array.isArray(preset.Env)) {
        printAction(`🔐 Validating ENV vars for: ${containerName}`);
        for (const line of preset.Env) {
            const [key, value] = line.split('=');
            const clean = (value || '').trim();
            const valid = clean !== '' && clean !== 'undefined';
            const mark = valid ? '✔' : '⚠️';
            printDebug(`${mark} ${key} = ${clean}`);
        }
    }

    // ───── Create and start container ─────
    printAction(`› Creating container: ${containerName}`);
    try {
        const container = await docker.createContainer(preset);
        await container.start();
        printResult(`✔ Created and started container: ${containerName}`);
        printDivider();
    } catch (err) {
        printError(`❌ Error creating container "${containerName}": ${err.message}`);
        if (err.json?.message?.includes('port')) {
            printNote(`🔻 Tip: Double-check that the PORT for "${containerName}" is set in your .env or config file.`);
        }
        throw err;
    }
}
