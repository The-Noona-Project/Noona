import Docker from 'dockerode';
import fetch from 'node-fetch';

const docker = new Docker();
const image = 'captainpax/noona-moon:latest';
const containerName = 'noona-moon';
const networkName = 'noona-network';
const trackedContainers = new Set();

/**
 * Check if container exists.
 */
async function containerExists(name) {
    const containers = await docker.listContainers({all: true});
    return containers.some(c => c.Names.includes(`/${name}`));
}

/**
 * Ensure the Docker network exists.
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
 * Attach current Warden container to the Docker network.
 */
async function attachSelfToNetwork() {
    const containerInfo = await docker.getContainer(process.env.HOSTNAME).inspect();
    const attached = containerInfo.NetworkSettings.Networks[networkName];
    if (!attached) {
        console.log(`[warden] Attaching self to ${networkName}`);
        await docker.getNetwork(networkName).connect({Container: process.env.HOSTNAME});
    }
}

/**
 * Pull Moon image if needed.
 */
async function pullImageIfNeeded() {
    const images = await docker.listImages();
    const found = images.some(i => i.RepoTags?.includes(image));
    if (!found) {
        console.log(`[warden] Pulling image: ${image}`);
        await new Promise((resolve, reject) => {
            docker.pull(image, (err, stream) => {
                if (err) return reject(err);
                docker.modem.followProgress(stream, resolve, (event) => {
                    if (event.status) process.stdout.write(`\r[warden] ${event.status} ${event.progress || ''}`);
                });
            });
        });
        console.log(`\n[warden] Pull complete.`);
    } else {
        console.log(`[warden] Image already present.`);
    }
}

/**
 * Run Moon container, attach to network, and stream logs.
 */
async function runContainer() {
    console.log(`[warden] Creating and starting container: ${containerName}`);

    const container = await docker.createContainer({
        name: containerName,
        Image: image,
        Env: ['TEST_BUTTON=Launch Sequence 🚀'],
        ExposedPorts: {'3000/tcp': {}},
        HostConfig: {
            PortBindings: {'3000/tcp': [{HostPort: '3000'}]}
        },
        NetworkingConfig: {
            EndpointsConfig: {
                [networkName]: {}
            }
        }
    });

    trackedContainers.add(containerName);
    await container.start();

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
 * Registers the setup wizard HTML page with Moon.
 */
async function registerSetupWizard() {
    const moonURL = 'http://noona-moon:3000/api/register-page';
    const services = ['warden', 'moon', 'raven', 'oracle', 'portal', 'sage', 'vault'];

    const html = `
  <html>
    <head><title>Noona Setup Wizard</title></head>
    <body>
      <h1>Noona Setup Wizard</h1>
      <p>Select the services you want to install:</p>
      <form method="POST" action="http://localhost:3001/api/install-services">
        ${services.map(s => `
          <label>
            <input type="checkbox" name="services" value="${s}"> ${s}
          </label><br>
        `).join('')}
        <br>
        <button type="submit">Install</button>
      </form>
    </body>
  </html>`;

    try {
        const res = await fetch(moonURL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({route: 'setupwizard', html})
        });

        if (!res.ok) throw new Error(`Moon returned ${res.status}`);
        console.log(`[warden] Setup wizard registered successfully.`);
    } catch (err) {
        console.error(`[warden] Failed to register setup wizard: ${err.message}`);
    }
}

/**
 * Stop and remove tracked containers.
 */
async function shutdownAll() {
    console.log(`\n[warden] Shutting down tracked containers...`);
    for (const name of trackedContainers) {
        try {
            const container = docker.getContainer(name);
            await container.stop();
            await container.remove();
            console.log(`[warden] Stopped and removed ${name}`);
        } catch (err) {
            console.warn(`[warden] Error shutting down ${name}:`, err.message);
        }
    }
    process.exit(0);
}

/**
 * Boot and manage containers.
 */
async function init() {
    await ensureNetwork(networkName);
    await attachSelfToNetwork();

    const exists = await containerExists(containerName);
    if (!exists) {
        await pullImageIfNeeded();
        await runContainer();
    } else {
        console.log(`[warden] Container '${containerName}' already exists.`);
    }

    await registerSetupWizard();

    console.log(`[warden] Staying online...`);
    setInterval(() => process.stdout.write('.'), 60_000);
}

// Handle shutdown signals
process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);

init().catch(err => {
    console.error(`[warden] Error:`, err);
});
