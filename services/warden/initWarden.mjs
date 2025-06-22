import Docker from 'dockerode';

const docker = new Docker();
const image = 'captainpax/noona-moon:latest';
const containerName = 'noona-moon';
const networkName = 'noona-network';

/**
 * Checks if a Docker container exists by name.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function containerExists(name) {
    const containers = await docker.listContainers({all: true});
    return containers.some(c => c.Names.includes(`/${name}`));
}

/**
 * Checks if a Docker network exists; creates it if missing.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function ensureNetwork(name) {
    const networks = await docker.listNetworks();
    const exists = networks.some(n => n.Name === name);

    if (!exists) {
        console.log(`[warden] Creating network: ${name}`);
        await docker.createNetwork({Name: name});
    }
}

/**
 * Pulls the specified image from Docker Hub if not already present.
 * @returns {Promise<void>}
 */
async function pullImageIfNeeded() {
    const images = await docker.listImages();
    const found = images.some(i => i.RepoTags?.includes(image));
    if (!found) {
        console.log(`[warden] Pulling image: ${image}`);
        await new Promise((resolve, reject) => {
            docker.pull(image, (err, stream) => {
                if (err) return reject(err);
                docker.modem.followProgress(stream, onFinished, onProgress);

                function onFinished(err) {
                    if (err) reject(err);
                    else resolve();
                }

                function onProgress(event) {
                    if (event.status) {
                        process.stdout.write(`\r[warden] ${event.status} ${event.progress || ''}      `);
                    }
                }
            });
        });
        console.log(`\n[warden] Pull complete.`);
    } else {
        console.log(`[warden] Image already present: ${image}`);
    }
}

/**
 * Creates and starts the Moon container with environment and network attached.
 * @returns {Promise<void>}
 */
async function runContainer() {
    console.log(`[warden] Creating and starting container: ${containerName}`);

    const container = await docker.createContainer({
        name: containerName,
        Image: image,
        Env: [
            'TEST_BUTTON=Launch Sequence 🚀'
        ],
        ExposedPorts: {
            '3000/tcp': {}
        },
        HostConfig: {
            PortBindings: {
                '3000/tcp': [{HostPort: '3000'}]
            }
        },
        NetworkingConfig: {
            EndpointsConfig: {
                [networkName]: {}
            }
        }
    });

    await container.start();

    // Stream logs
    const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 10
    });

    logStream.on('data', chunk => {
        process.stdout.write(`[moon] ${chunk.toString()}`);
    });

    console.log(`[warden] ${containerName} is now running and streaming logs.`);
}

/**
 * Entry point
 */
async function init() {
    await ensureNetwork(networkName);

    const exists = await containerExists(containerName);
    if (!exists) {
        await pullImageIfNeeded();
        await runContainer();
    } else {
        console.log(`[warden] Container '${containerName}' already exists.`);
    }

    console.log(`[warden] Staying online...`);
    setInterval(() => {
        process.stdout.write('.');
    }, 60_000);
}

init().catch(err => {
    console.error(`[warden] Error:`, err);
});
