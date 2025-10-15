// deploy.mjs - Noona Docker Manager (Node.js version)
import readline from 'readline/promises';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { chmod } from 'fs/promises';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DOCKERHUB_USER = 'captainpax';
const SERVICES = ['moon', 'warden', 'raven', 'sage', 'vault', 'portal'];
const NETWORK_NAME = 'noona-network';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

const CLI_ARGS = new Set(process.argv.slice(2));
const FORCE_CLEAN_BUILD = CLI_ARGS.has('--clean-build');
const FORCE_CACHED_BUILD = CLI_ARGS.has('--cached-build');
const CONFLICTING_BUILD_FLAGS = FORCE_CLEAN_BUILD && FORCE_CACHED_BUILD;

const printHeader = () => {
    console.log(`\n${colors.bold}${colors.cyan}`);
    console.log('==============================');
    console.log('   🚀 Noona Docker Manager');
    console.log('==============================');
    console.log(`${colors.reset}`);
};

const printMainMenu = () => {
    console.log(`${colors.yellow}Select an action:${colors.reset}`);
    console.log('1) 🛠️  Build');
    console.log('2) 📤 Push');
    console.log('3) 📥 Pull');
    console.log('4) ▶️  Start');
    console.log('5) ⏹ Stop All');
    console.log('6) 🧹 Clean');
    console.log('7) 🗑️ Delete Docker');
    console.log('0) ❌ Exit\n');
};

const printServicesMenu = () => {
    console.log(`${colors.yellow}Select a service:${colors.reset}`);
    console.log('0) All');
    SERVICES.forEach((svc, i) => console.log(`${i + 1}) ${svc}`));
    console.log('');
};

const print = {
    success: msg => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: msg => console.error(`${colors.red}❌ ${msg}${colors.reset}`)
};

const ensureExecutables = async service => {
    if (service !== 'raven') return;

    const gradlewPath = resolve(ROOT_DIR, 'services', service, 'gradlew');

    try {
        await chmod(gradlewPath, 0o755);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`${colors.yellow}⚠️  Unable to update permissions for ${gradlewPath}: ${error.message}${colors.reset}`);
        }
    }
};

const dockerRunPowerShell = async (service, image, envVars = {}) => {
    const envParts = Object.entries(envVars)
        .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
        .map(([key, value]) => `-e ${key}=${value}`);

    envParts.push(`-e SERVICE_NAME=noona-${service}`);

    const envString = envParts.join(' ');
    const envSection = envString ? `${envString} ` : '';

    const cmd = `start powershell -NoExit -Command "docker run -d --rm --name noona-${service} --hostname noona-${service} --network ${NETWORK_NAME} -v /var/run/docker.sock:/var/run/docker.sock ${envSection}${image}:latest"`;
    await execAsync(cmd);
    print.success(`${service} started in new PowerShell window.`);
};

const execLines = async command => {
    try {
        const { stdout } = await execAsync(command);
        return stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
};

const runDockerCommand = ({ args, successMessage, errorMessage }) =>
    new Promise((resolve, reject) => {
        const child = spawn('docker', args, {
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });

        child.on('error', error => {
            if (errorMessage) {
                print.error(`${errorMessage}: ${error.message}`);
            } else {
                print.error(`Docker command failed: ${error.message}`);
            }
            reject(error);
        });

        child.on('close', code => {
            if (code === 0) {
                if (successMessage) {
                    print.success(successMessage);
                }
                resolve();
                return;
            }

            const failureMessage = errorMessage
                ? `${errorMessage} (exit code ${code})`
                : `Docker command exited with code ${code}`;
            print.error(failureMessage);
            reject(new Error(failureMessage));
        });
    });

const ensureNetwork = async () => {
    const networks = await execLines(`docker network ls --filter "name=^${NETWORK_NAME}$" --format "{{.Name}}"`);
    if (networks.length) {
        console.log(`${colors.cyan}🔗 Using existing Docker network ${NETWORK_NAME}.${colors.reset}`);
        return;
    }

    console.log(`${colors.yellow}🌐 Creating Docker network ${NETWORK_NAME}...${colors.reset}`);
    await execAsync(`docker network create ${NETWORK_NAME}`);
    print.success(`Created Docker network ${NETWORK_NAME}`);
};

const stopAllContainers = async () => {
    console.log(`${colors.yellow}⏹ Stopping all running Noona containers...${colors.reset}`);
    const containers = await execLines('docker ps --filter "name=noona-" --format "{{.Names}}"');

    if (containers.length === 0) {
        print.success('No running Noona containers found.');
        return;
    }

    for (const name of containers) {
        await execAsync(`docker stop ${name} 2>/dev/null || true`);
    }

    print.success('Stop command sent to all running Noona containers.');
};

const cleanService = async service => {
    const image = `${DOCKERHUB_USER}/noona-${service}`;
    const local = `noona-${service}`;

    await execAsync(`docker rm -f ${local} 2>/dev/null || true`);
    await execAsync(`docker image rm ${image}:latest 2>/dev/null || true`);
    await execAsync(`docker image rm ${image} 2>/dev/null || true`);
    await execAsync(`docker image rm ${local}:latest 2>/dev/null || true`);
    await execAsync(`docker image rm ${local} 2>/dev/null || true`);
};

const deleteDockerResources = async () => {
    const confirmation = (await rl.question(`${colors.red}This will delete ALL local Noona Docker containers, images, volumes, and networks. Type DELETE to continue: ${colors.reset}`)).trim().toUpperCase();

    if (confirmation !== 'DELETE') {
        print.error('Delete aborted.');
        return;
    }

    console.log(`${colors.yellow}🗑️ Deleting Noona Docker resources...${colors.reset}`);

    const containers = await execLines('docker ps -a --filter "name=noona-" --format "{{.Names}}"');
    for (const name of containers) {
        await execAsync(`docker rm -f ${name} 2>/dev/null || true`);
    }

    const images = await execLines('docker images --format "{{.Repository}}:{{.Tag}}"');
    for (const image of images) {
        if (image.startsWith('captainpax/noona-') || image.startsWith('noona-')) {
            await execAsync(`docker image rm ${image} 2>/dev/null || true`);
        }
    }

    const volumes = await execLines('docker volume ls --filter "name=noona-" --format "{{.Name}}"');
    for (const volume of volumes) {
        await execAsync(`docker volume rm ${volume} 2>/dev/null || true`);
    }

    const networks = await execLines('docker network ls --filter "name=noona-" --format "{{.Name}}"');
    for (const network of networks) {
        await execAsync(`docker network rm ${network} 2>/dev/null || true`);
    }

    print.success('All local Noona Docker resources deleted.');
};

const selectServices = async mainChoice => {
    if (mainChoice === '4') {
        console.log(`${colors.cyan}▶️  Start is limited to launching the warden orchestrator.${colors.reset}`);
        return ['warden'];
    }

    printServicesMenu();
    const svcChoice = (await rl.question('Enter service choice: ')).trim();

    if (svcChoice === '0') {
        return [...SERVICES];
    }

    const index = Number.parseInt(svcChoice, 10);
    if (!Number.isInteger(index) || index < 1 || index > SERVICES.length) {
        print.error('Invalid service choice.');
        return null;
    }

    return [SERVICES[index - 1]];
};

const askDebugSetting = async () => {
    const answer = (await rl.question('Select DEBUG level (false/true/super) [false]: ')).trim().toLowerCase();
    const allowed = new Set(['false', 'true', 'super']);
    if (!answer) return 'false';
    if (allowed.has(answer)) return answer;
    print.error('Invalid DEBUG level supplied. Defaulting to "false".');
    return 'false';
};

const askBootMode = async () => {
    const answer = (await rl.question('Select boot mode (minimal/super) [minimal]: ')).trim().toLowerCase();
    const allowed = new Set(['minimal', 'super']);
    if (!answer) return 'minimal';
    if (allowed.has(answer)) return answer;
    print.error('Invalid boot mode supplied. Defaulting to "minimal".');
    return 'minimal';
};

const askCleanBuild = async () => {
    if (CONFLICTING_BUILD_FLAGS) {
        console.warn(`${colors.yellow}⚠️  Conflicting build cache flags detected; defaulting to cached builds.${colors.reset}`);
        return false;
    }

    if (FORCE_CLEAN_BUILD) {
        console.log(`${colors.cyan}🧼 Clean build requested via CLI flag (--clean-build).${colors.reset}`);
        return true;
    }

    if (FORCE_CACHED_BUILD) {
        console.log(`${colors.cyan}📦 Cached build requested via CLI flag (--cached-build).${colors.reset}`);
        return false;
    }

    const answer = (await rl.question('Perform a clean build (use --no-cache)? (y/N): ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
};

const run = async () => {
    while (true) {
        printHeader();
        printMainMenu();
        const mainChoice = (await rl.question('Enter choice: ')).trim();
        if (mainChoice === '0') break;

        if (!['1','2','3','4','5','6','7'].includes(mainChoice)) {
            print.error('Invalid main choice');
            continue;
        }

        if (mainChoice === '5') {
            try {
                await stopAllContainers();
            } catch (e) {
                print.error(`Failed to stop containers: ${e.message}`);
            }
            continue;
        }

        if (mainChoice === '7') {
            try {
                await deleteDockerResources();
            } catch (e) {
                print.error(`Failed to delete Docker resources: ${e.message}`);
            }
            continue;
        }

        const selected = await selectServices(mainChoice);
        if (!selected || selected.length === 0) {
            continue;
        }

        let useNoCache = false;
        if (mainChoice === '1') {
            useNoCache = await askCleanBuild();
        }

        for (const svc of selected) {
            if (!svc) continue;
            const image = `${DOCKERHUB_USER}/noona-${svc}`;
            const local = `noona-${svc}`;
            const dockerfile = `${ROOT_DIR}/deployment/${svc}.Dockerfile`;

            switch (mainChoice) {
                case '1': // Build
                    console.log(`${colors.yellow}🔨 Building ${svc}...${colors.reset}`);
                    try {
                        await ensureExecutables(svc);
                        const buildArgs = ['build', '-f', dockerfile, '-t', image, ROOT_DIR];
                        if (useNoCache) {
                            buildArgs.splice(1, 0, '--no-cache');
                        }
                        await runDockerCommand({
                            args: buildArgs,
                            successMessage: `Build complete: ${image}`,
                            errorMessage: `Build failed: ${image}`
                        });
                    } catch {
                        // Errors are reported by runDockerCommand
                    }
                    break;

                case '2': // Push
                    console.log(`${colors.yellow}📤 Pushing ${svc}...${colors.reset}`);
                    try {
                        await runDockerCommand({
                            args: ['push', `${image}:latest`],
                            successMessage: `Push complete: ${image}`,
                            errorMessage: `Push failed: ${image}`
                        });
                    } catch {
                        // Errors are reported by runDockerCommand
                    }
                    break;

                case '3': // Pull
                    console.log(`${colors.yellow}📥 Pulling ${svc}...${colors.reset}`);
                    try {
                        await runDockerCommand({
                            args: ['pull', `${image}:latest`],
                            successMessage: `Pull complete: ${image}`,
                            errorMessage: `Pull failed: ${image}`
                        });
                    } catch {
                        // Errors are reported by runDockerCommand
                    }
                    break;

                case '4': // Start
                    console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
                    try {
                        await ensureNetwork();
                        const DEBUG = await askDebugSetting();
                        const BOOT_MODE = await askBootMode();
                        await dockerRunPowerShell(svc, image, { DEBUG, BOOT_MODE });
                    } catch (e) {
                        print.error(`Failed to start ${svc}: ${e.message}`);
                    }
                    break;

                case '6': // Clean
                    console.log(`${colors.yellow}🧹 Cleaning ${svc}...${colors.reset}`);
                    try {
                        await cleanService(svc);
                        if (svc === 'warden') {
                            await execAsync(`docker network rm ${NETWORK_NAME} 2>/dev/null || true`);
                        }
                        print.success(`Cleaned ${svc}`);
                    } catch (e) {
                        print.error(`Failed to clean ${svc}: ${e.message}`);
                    }
                    break;
            }
        }

        const again = await rl.question('\nReturn to main menu? (y/N): ');
        if (again.toLowerCase() !== 'y') break;
    }

    rl.close();
    console.log(`${colors.cyan}Goodbye!${colors.reset}`);
};

run();
