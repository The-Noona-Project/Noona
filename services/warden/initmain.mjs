// ✅ services/warden/initmain.mjs — Warden Bootstrap (Noona Stack 2.0.0)

import {
    printBanner,
    printDivider,
    printSection,
    printResult,
    printError
} from '../../utilities/logger/logUtils.mjs';

import { manageFiles } from '../../utilities/filesystem/fileSystemManager.mjs';
import { generateKeys } from '../../utilities/jwt/generateKeys.mjs';
import { sendPublicKeyToRedis } from '../../utilities/jwt/sendToRedis.mjs';
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
