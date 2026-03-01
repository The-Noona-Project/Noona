import {spawn} from "node:child_process";
import {createRequire} from "node:module";

import {createNoonaLogWriter} from "../../../utilities/etc/logFile.mjs";

const DEFAULT_WEBGUI_PORT = 3000;
const require = createRequire(import.meta.url);

const resolveWebGuiPort = () => {
    const rawValue = process.env.WEBGUI_PORT ?? process.env.PORT ?? String(DEFAULT_WEBGUI_PORT);
    const parsed = Number.parseInt(String(rawValue), 10);

    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        return String(parsed);
    }

    return String(DEFAULT_WEBGUI_PORT);
};

const mode = process.argv[2] === "dev" ? "dev" : "start";
const port = resolveWebGuiPort();
const nextBin = require.resolve("next/dist/bin/next");
const logWriter = createNoonaLogWriter({
    onError: (error, filePath) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[moon] Failed to write log file ${filePath}: ${message}\n`);
    },
});

const child = spawn(process.execPath, [nextBin, mode, "-H", "0.0.0.0", "-p", port], {
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
});

const pipeOutput = (stream, target) => {
    stream?.on("data", (chunk) => {
        target.write(chunk);
        logWriter.write(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    });
};

pipeOutput(child.stdout, process.stdout);
pipeOutput(child.stderr, process.stderr);

child.on("exit", (code, signal) => {
    logWriter.end();

    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
