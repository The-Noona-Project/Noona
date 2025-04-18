// ✅ services/warden/initmain.mjs — Warden 2.0.0 Bootstrap

import {
    printBanner,
    printDivider,
    printSection,
    printStep,
    printResult,
    printError
} from '../../utilities/logger/logUtils.mjs';

import { buildConfig } from './filesystem/build/buildConfig.mjs';
import { loadConfig } from './filesystem/load/loadConfig.mjs';
import { generateKeyPair } from '../../utilities/auth/keys/generateKeyPair.mjs';
import { sendPublicKeyToRedis } from '../../utilities/auth/sendToRedis.mjs';
import { manageContainers } from './docker/containerManager.mjs';

const SERVICE_LIST = [
    'noona-warden',
    'noona-vault',
    'noona-portal',
    'noona-moon',
    'noona-sage',
    'noona-raven',
    'noona-oracle'
];

// 🧠 Main Warden Execution
printBanner('Noona');

(async () => {
    try {
        // 📁 Build Configuration
        printSection('📂 Filesystem & Config');
        const configBuilt = await buildConfig();
        if (configBuilt) {
            printStep('Warden entered SETUP MODE — please edit the config file');
            printDivider();
            return;
        }

        const config = await loadConfig();

        // 🔑 Generate RSA Key Pairs
        printSection('🔐 Generating Key Pairs');
        for (const service of SERVICE_LIST) {
            const { privateKey, publicKey } = await generateKeyPair(service);
            global[`__privateKey__${service}`] = privateKey;
            await sendPublicKeyToRedis(service, publicKey);
            printResult(`✔ Keypair ready for ${service}`);
        }

        // 🐳 Container Management
        printSection('🐳 Managing Containers');
        await manageContainers(config);

        printDivider();
        printResult('✅ Warden 2.0.0 Boot Complete');
        printDivider();
    } catch (err) {
        printError('❌ Warden Boot Failure');
        console.error(err);
        process.exit(1);
    }
})();
