// services/moon/backend/initmain.mjs

import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import {
  printDivider,
  printSection,
  printResult,
  printError
} from '../../../utilities/logger/logUtils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const IS_SETUP_MODE = process.env.IS_SETUP === 'true';

// ─────────────────────────────────────────────
// 🌙 Noona-Moon Startup Logs
// ─────────────────────────────────────────────
printDivider();
printSection('🌙 Noona-Moon Backend Launch');
printResult(`🛰️  Running in ${IS_SETUP_MODE ? '🛠️ Setup' : '🚀 Normal'} Mode`);
printResult(`📦 Serving React frontend from /frontend/dist`);
printDivider();

// ─────────────────────────────────────────────
// 📦 Serve React Build Output
// ─────────────────────────────────────────────
const frontendPath = path.resolve(__dirname, '../frontend/dist');
app.use(cors());
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
  try {
    res.sendFile(path.join(frontendPath, 'index.html'));
  } catch (err) {
    printError('❌ Failed to serve frontend');
    printError(err.message);
    res.status(500).send('Internal Server Error');
  }
});

// ─────────────────────────────────────────────
// 🚀 Start Express Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  printResult(`🌐 Moon is online at http://localhost:${PORT}`);
  printDivider();
});
