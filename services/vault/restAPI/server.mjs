/**
 * @fileoverview
 * Lightweight standalone entry point to launch the Vault REST API.
 * Includes global middleware setup and mounts all versioned API routes (v2 only).
 *
 * Typically used for development or isolated REST testing outside of the full Vault stack.
 *
 * @module server
 */

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { printResult } from '../../../utilities/logger/logUtils.mjs';
import { mountRoutesV2 } from './routeManagerV2.mjs';

const app = express();
const PORT = process.env.PORT || 3130;

/**
 * 🌐 Applies core Express middleware for:
 * - CORS (Cross-Origin Resource Sharing)
 * - JSON parsing
 * - URL-encoded form parsing
 * - HTTP request logging (via morgan)
 */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

/**
 * 🧩 Mounts versioned REST API routes under /v2.
 * This allows dynamic route loading and is shared across the full Vault system.
 */
await mountRoutesV2(app);

/**
 * 🚀 Starts the API server on the defined port.
 * Displays a CLI confirmation once the server is live.
 */
app.listen(PORT, () => {
    printResult(`✔ ✅ Vault API listening on port ${PORT}`);
});
