const SHELLLESS_ROUTES = new Set(["/login", "/signup", "/discord/callback", "/bootScreen", "/rebooting"]);

const normalizePathname = (value) => (typeof value === "string" ? value.trim() : "");

export const isMoonShellSuppressedPath = (pathname) => {
    const normalized = normalizePathname(pathname);
    return SHELLLESS_ROUTES.has(normalized);
};

export const isMoonSetupPath = (pathname) => {
    const normalized = normalizePathname(pathname);
    return normalized === "/setupwizard" || normalized.startsWith("/setupwizard/");
};

export const isMoonSignedInAppPath = (pathname) =>
    !isMoonShellSuppressedPath(pathname) && !isMoonSetupPath(pathname);
