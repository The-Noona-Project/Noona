// initmain.mjs

import {
    printBanner,
    printDivider,
    printSection,
    printResult,
    printError
} from './noona/logger/logUtils.mjs';

import { manageFiles } from './noona/filesystem/fileSystemManager.mjs';
import { generateKeys } from './noona/jwt/generateKeys.mjs';
import { sendPublicKeyToRedis } from './noona/jwt/sendToRedis.mjs';
import { manageContainers } from './docker/containerManager.mjs';

printBanner('Noona');

(async () => {
    try {
        // 🧾 Filesystem + Configuration Setup
        printSection('📂 File & Config Setup');
        await manageFiles();

        // 🔐 JWT Key Generation
        printSection('🔑 JWT Key Generation');
        await generateKeys();
        printResult('✔ JWT Keys generated and stored');

        // 📦 Container Bootstrapping
        await manageContainers();

        // 📡 JWT Public Key → Redis for Vault
        printSection('📡 Sharing Public Key with Vault');
        await sendPublicKeyToRedis(null, 'noona-vault');
        printResult('✔ Public key shared with Vault via Redis');

        // ✅ Done!
        printDivider();
        printResult('🏁 Noona-Warden Boot Complete');
        printDivider();
    } catch (err) {
        printError('❌ Boot error:');
        console.error(err);
        process.exit(1);
    }
})();
