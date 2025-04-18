import { promises as fs } from 'fs';
import path from 'path';
import {
    printResult,
    printWarning,
    printError,
    printDivider,
    printSection,
    printDebug
} from '../../logger/logUtils.mjs';

// Updated folder tree without "depends", and updated for new structure.
const TREE_STRUCTURE = {
    "noona-moon": { files: {} },
    "noona-oracle": { files: {} },
    "noona-portal": { files: {} },
    "noona-raven": { files: {} },
    "noona-sage": { files: {} },
    "noona-vault": { files: {} },
    "noona-warden": {
        files: {
            keys: {},
            settings: {}
        }
    }
};

// Using an absolute path for the family tree root
const ROOT_PATH = path.resolve('/noona/family');

const ensureDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        printDebug(`Directory ensured: ${dirPath}`);
        await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        const stats = await fs.stat(dirPath);
        printResult(`Verified: ${dirPath} with permissions ${stats.mode.toString(8)}`);
    } catch (err) {
        if (err.code === 'EACCES') {
            printWarning(`Permission denied for ${dirPath}. Attempting to fix permissions.`);
            try {
                await fs.chmod(dirPath, 0o775);
                await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
                const stats = await fs.stat(dirPath);
                printResult(`Permissions fixed for ${dirPath}: ${stats.mode.toString(8)}`);
            } catch (chmodErr) {
                printError(`Failed to fix permissions for ${dirPath}: ${chmodErr.message}`);
            }
        } else {
            printWarning(`Error ensuring directory ${dirPath}: ${err.message}`);
        }
    }
};

const createTree = async (basePath, tree) => {
    for (const [folder, subtree] of Object.entries(tree)) {
        const currentPath = path.join(basePath, folder);
        printDebug(`Creating directory: ${currentPath}`);
        await ensureDir(currentPath);
        if (subtree && typeof subtree === 'object' && Object.keys(subtree).length > 0) {
            await createTree(currentPath, subtree);
        }
    }
};

export const buildFolderTree = async () => {
    printDivider();
    printSection('📂 Building Noona Family Folder Tree');
    printDebug(`Target root path: ${ROOT_PATH}`);

    await createTree(ROOT_PATH, TREE_STRUCTURE);

    printResult('✔ Folder tree created successfully');
    printDivider();
};
