import {spawn} from "node:child_process";
import {createRequire} from "node:module";

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

const child = spawn(process.execPath, [nextBin, mode, "-H", "0.0.0.0", "-p", port], {
    env: process.env,
    stdio: "inherit",
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});

