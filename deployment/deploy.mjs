// deploy.mjs - Noona Docker Manager (Node.js version)
import readline from 'readline/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { chmod } from 'fs/promises';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DOCKERHUB_USER = 'captainpax';
const SERVICES = ['moon', 'warden', 'raven', 'sage', 'vault'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

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
    console.log('5) 🧹 Clean');
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

const dockerRunPowerShell = async (service, image) => {
    const cmd = `start powershell -NoExit -Command "docker run -d --rm --name noona-${service} --network noona-network -v /var/run/docker.sock:/var/run/docker.sock -e DEBUG=false ${image}:latest"`;
    await execAsync(cmd);
    print.success(`${service} started in new PowerShell window.`);
};

const run = async () => {
    while (true) {
        printHeader();
        printMainMenu();
        const mainChoice = await rl.question('Enter choice: ');
        if (mainChoice === '0') break;
        if (!['1','2','3','4','5'].includes(mainChoice)) { print.error('Invalid main choice'); continue; }

        printServicesMenu();
        const svcChoice = await rl.question('Enter service choice: ');
        const selected = svcChoice === '0' ? SERVICES : [SERVICES[parseInt(svcChoice) - 1]];

        for (const svc of selected) {
            const image = `${DOCKERHUB_USER}/noona-${svc}`;
            const local = `noona-${svc}`;
            const dockerfile = `${ROOT_DIR}/deployment/${svc}.Dockerfile`;

            switch (mainChoice) {
                case '1': // Build
                    console.log(`${colors.yellow}🔨 Building ${svc}...${colors.reset}`);
                    try {
                        await ensureExecutables(svc);
                        await execAsync(`docker build --no-cache -f "${dockerfile}" -t "${image}" "${ROOT_DIR}"`, { stdio: 'inherit' });
                        print.success(`Build complete: ${image}`);
                    } catch (e) {
                        print.error(`Build failed: ${e.message}`);
                    }
                    break;

                case '2': // Push
                    console.log(`${colors.yellow}📤 Pushing ${svc}...${colors.reset}`);
                    await execAsync(`docker push ${image}:latest`);
                    print.success(`Push complete: ${image}`);
                    break;

                case '3': // Pull
                    console.log(`${colors.yellow}📥 Pulling ${svc}...${colors.reset}`);
                    await execAsync(`docker pull ${image}:latest`);
                    print.success(`Pull complete: ${image}`);
                    break;

                case '4': // Start
                    console.log(`${colors.yellow}▶️  Starting ${svc}...${colors.reset}`);
                    try {
                        await execAsync(`docker network inspect noona-network >/dev/null 2>&1 || docker network create noona-network`);
                        await dockerRunPowerShell(svc, image);
                    } catch (e) {
                        print.error(`Failed to start ${svc}: ${e.message}`);
                    }
                    break;

                case '5': // Clean
                    console.log(`${colors.yellow}🧹 Cleaning ${svc}...${colors.reset}`);
                    await execAsync(`docker rm -f ${local} 2>/dev/null || true`);
                    await execAsync(`docker rmi ${image} 2>/dev/null || true`);
                    print.success(`Cleaned ${svc}`);
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
