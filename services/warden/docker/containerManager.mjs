// docker/containerManager.mjs
import Docker from 'dockerode';
import {
    printResult,
    printError,
    printNote,
    printAction,
    printDivider,
    printSection,
    printDebug
} from '../noona/logger/logUtils.mjs';

// Import container lifecycle functions from our modular files:
import { createContainer } from './start/createContainer.mjs';
import { startContainer } from './start/startContainer.mjs';
import { pullDependencyImages } from './build/downloadImages.mjs';
import { ensureNetworkExists } from './build/buildNetwork.mjs';
import updateContainer from './update/UpdateContainer.mjs';
import checkForUpdate from './update/checkForUpdate.mjs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Define the dependency containers for the stack.
const DEPEND_CONTAINERS = [
    'noona-redis',
    'noona-mongodb',
    'noona-mariadb'
];

/**
 * Stops all running containers that start with "noona-" (except "noona-warden").
 */
async function stopRunningNoonaContainers() {
    try {
        const containers = await docker.listContainers({ all: true });
        const targets = containers.filter(c => {
            const name = c.Names[0]?.replace(/^\//, '');
            return name.startsWith('noona-') && name !== 'noona-warden' && c.State === 'running';
        });
        if (targets.length === 0) {
            printResult('✔ No running Noona containers found');
            return;
        }
        for (const containerInfo of targets) {
            const containerName = containerInfo.Names[0]?.replace(/^\//, '');
            try {
                printAction(`Stopping container: ${containerName}`);
                const container = docker.getContainer(containerInfo.Id);
                await container.stop();
                printResult(`✔ Stopped container: ${containerName}`);
            } catch (err) {
                printError(`❌ Failed to stop ${containerName}: ${err.message}`);
            }
        }
    } catch (err) {
        printError('❌ Error during container stop phase: ' + err.message);
        throw err;
    }
}

/**
 * Connects the current container ("warden") to required networks.
 */
async function connectWardenToNetworks() {
    const wardenContainerId = process.env.HOSTNAME;
    const networksToConnect = ['bridge', 'noona-network'];
    for (const net of networksToConnect) {
        try {
            const network = docker.getNetwork(net);
            await network.connect({ Container: wardenContainerId });
            printResult(`✔ Connected to network: ${net}`);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                printError(`❌ Failed to connect to network ${net}: ${err.message}`);
            }
        }
    }
}

/**
 * Manages the initial start of the entire container stack.
 */
async function manageContainers() {
    printDivider();
    printSection('🐳 Starting Noona Container Management');

    await checkDockerAccess();

    // Stop currently running containers (except warden).
    await stopRunningNoonaContainers();

    // Ensure required Docker networks exist.
    await ensureNetworkExists('bridge');
    await ensureNetworkExists('noona-network');
    printResult('✔ Docker networks ready');

    // Connect Warden container to networks.
    await connectWardenToNetworks();

    // Pull dependency images.
    await pullDependencyImages();

    // Start dependency containers.
    printAction('🚀 Creating dependency containers...');
    for (const name of DEPEND_CONTAINERS) {
        await createContainer(name);
    }

    // Start core containers: noona-vault and noona-portal.
    printAction('🚀 Creating core containers...');
    await createContainer('noona-vault');
    await createContainer('noona-portal');

    printResult('✔ All Noona containers started successfully');

    // Schedule daily update checks at local midnight.
    scheduleDailyUpdate();

    printResult('🐳 Noona Container Management is running');
    printDivider();
}

/**
 * Checks Docker access and logs the version.
 */
async function checkDockerAccess() {
    try {
        const version = await docker.version();
        printResult(`✔ Docker Version: ${version.Version}`);
    } catch (err) {
        printError(`Docker access error: ${err.message}`);
        process.exit(1);
    }
}

/**
 * Schedules a daily update check to run at local midnight.
 */
function scheduleDailyUpdate() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const delay = nextMidnight - now;
    printDebug(`Scheduling update check in ${delay} ms (next midnight).`);
    setTimeout(async () => {
        await runUpdateCheck();
        setInterval(runUpdateCheck, 24 * 60 * 60 * 1000);
    }, delay);
}

/**
 * Runs the update check: if any images require updating, it updates the corresponding containers.
 */
async function runUpdateCheck() {
    try {
        printDivider();
        printAction('Performing scheduled update check...');
        const updates = await checkForUpdate();
        if (updates.length > 0) {
            printAction('Updates available. Updating containers...');
            for (const update of updates) {
                await updateContainer(update.container);
            }
            printResult('✔ Update process completed.');
        } else {
            printNote('No updates available at this time.');
        }
        printDivider();
    } catch (err) {
        printError(`Error during scheduled update check: ${err.message}`);
    }
}

// Export manageContainers for external usage.
export { manageContainers };

// If this module is run directly, start the management process.
if (process.argv[1] === new URL(import.meta.url).pathname) {
    manageContainers();
}
