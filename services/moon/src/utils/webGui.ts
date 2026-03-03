const DEFAULT_WEBGUI_PORT = 3000;

export const resolveWebGuiPort = (): number => {
    const rawValue = process.env.WEBGUI_PORT ?? process.env.PORT ?? String(DEFAULT_WEBGUI_PORT);
    const parsed = Number.parseInt(String(rawValue), 10);

    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        return parsed;
    }

    return DEFAULT_WEBGUI_PORT;
};

export const resolveMoonBaseUrl = (): string => `http://localhost:${resolveWebGuiPort()}`;

