// ✅ /noona/restAPI/routeManagerV2.mjs — Auto-Mounts All /v2 Routes
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

import { printResult, printError } from '../../../utilities/logger/logUtils.mjs';
import authLock from './middleware/authLock.mjs';

// ─────────────────────────────────────────────
// 🧠 Resolve __dirname for ESM
// ─────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────
// 🌐 Mount All V2 Routes (Dynamic, Per-Service)
// ─────────────────────────────────────────────
export async function mountRoutesV2(app) {
    const v2Base = path.join(__dirname, 'v2');
    const categories = await fs.readdir(v2Base);

    for (const category of categories) {
        const categoryPath = path.join(v2Base, category);
        const stats = await fs.stat(categoryPath);
        if (!stats.isDirectory()) continue;

        const actions = await fs.readdir(categoryPath);
        for (const action of actions) {
            const actionPath = path.join(categoryPath, action);
            const actionStats = await fs.stat(actionPath);
            if (!actionStats.isDirectory()) continue;

            const files = await fs.readdir(actionPath);
            for (const file of files) {
                if (!file.endsWith('.mjs')) continue;

                const routeFile = path.join(actionPath, file);
                try {
                    const routeModule = await import(routeFile);
                    const routePath = `/v2/${category}/${action}/${file.replace('.mjs', '')}`;

                    if (!routeModule.default) {
                        printError(`❌ ❌ Skipped ${routePath} — no default export`);
                        continue;
                    }

                    const isPublic = category === 'system';

                    if (isPublic) {
                        app.use(routePath, routeModule.default);
                        printResult(`✔ 🌐 Public Route: ${routePath}`);
                    } else {
                        app.use(routePath, authLock, routeModule.default);
                        printResult(`✔ 🔐 Private Route: ${routePath}`);
                    }
                } catch (err) {
                    printError(`❌ ❌ Failed to load route: ${file}`);
                    printError(`DEBUG: ${err.stack}`);
                }
            }
        }
    }

    printResult('✔ ✅ All /v2 routes mounted successfully');
}
