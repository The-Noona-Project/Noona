import {NextResponse} from "next/server";

type LogFn = (message: string) => void;

const fallbackDebugMSG: LogFn = (message) => {
    if (process.env.DEBUG === "true") {
        console.debug(message);
    }
};

const fallbackErrMSG: LogFn = (message) => {
    console.error(message);
};

let logDebug: LogFn = fallbackDebugMSG;
let logError: LogFn = fallbackErrMSG;

const initSharedLogger = (() => {
    let initialized = false;
    return () => {
        if (initialized) return;
        initialized = true;
        const dynamicImport = new Function("specifier", "return import(specifier);") as (
            specifier: string,
        ) => Promise<any>;

        dynamicImport("noona-utilities/etc/logger.mjs")
            .then((loggerModule) => {
                if (typeof loggerModule.debugMSG === "function") {
                    logDebug = loggerModule.debugMSG as LogFn;
                }
                if (typeof loggerModule.errMSG === "function") {
                    logError = loggerModule.errMSG as LogFn;
                }
            })
            .catch(() => {
                // Keep console fallback when shared utilities package is unavailable.
            });
    };
})();

initSharedLogger();

const DEFAULT_TIMEOUT_MS = 8000;
let preferredWardenBaseUrl: string | null = null;
let preferredSageBaseUrl: string | null = null;
let preferredRavenBaseUrl: string | null = null;
let preferredPortalBaseUrl: string | null = null;

const normalizeUrl = (candidate: unknown): string | null => {
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `http://${trimmed}`;
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        if (!value) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

const resolveWardenBaseUrls = (env: NodeJS.ProcessEnv = process.env): string[] =>
    uniqueStrings([
        normalizeUrl(env.WARDEN_BASE_URL),
        normalizeUrl(env.WARDEN_INTERNAL_BASE_URL),
        normalizeUrl(env.WARDEN_DOCKER_URL),
        "http://noona-warden:4001",
        "http://host.docker.internal:4001",
        "http://127.0.0.1:4001",
        "http://localhost:4001",
    ]);

const resolveSageBaseUrls = (env: NodeJS.ProcessEnv = process.env): string[] =>
    uniqueStrings([
        normalizeUrl(env.SAGE_BASE_URL),
        normalizeUrl(env.SAGE_INTERNAL_BASE_URL),
        "http://noona-sage:3004",
        "http://host.docker.internal:3004",
        "http://127.0.0.1:3004",
        "http://localhost:3004",
    ]);

const resolveRavenBaseUrls = (env: NodeJS.ProcessEnv = process.env): string[] =>
    uniqueStrings([
        normalizeUrl(env.RAVEN_BASE_URL),
        normalizeUrl(env.RAVEN_INTERNAL_BASE_URL),
        normalizeUrl(env.RAVEN_DOCKER_URL),
        "http://noona-raven:8080",
        "http://host.docker.internal:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3002",
        "http://host.docker.internal:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ]);

const resolvePortalBaseUrls = (env: NodeJS.ProcessEnv = process.env): string[] =>
    uniqueStrings([
        normalizeUrl(env.PORTAL_BASE_URL),
        normalizeUrl(env.PORTAL_INTERNAL_BASE_URL),
        normalizeUrl(env.PORTAL_DOCKER_URL),
        "http://noona-portal:3003",
        "http://host.docker.internal:3003",
        "http://127.0.0.1:3003",
        "http://localhost:3003",
    ]);

const fetchWithTimeout = async (
    url: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            cache: "no-store",
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
};

const prioritizeBaseUrls = (baseUrls: string[], preferredBaseUrl: string | null): string[] => {
    if (!preferredBaseUrl) return baseUrls;
    return [preferredBaseUrl, ...baseUrls.filter((url) => url !== preferredBaseUrl)];
};

const summarizeFailedResponseBody = (body: string): string => {
    const trimmed = body.trim();
    if (!trimmed) return "";

    try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown } | null;
        const structuredMessage = typeof parsed?.error === "string"
            ? parsed.error.trim()
            : typeof parsed?.message === "string"
                ? parsed.message.trim()
                : "";
        if (structuredMessage) {
            return structuredMessage;
        }
    } catch {
        // Fall back to a trimmed plain-text summary.
    }

    const condensed = trimmed.replace(/\s+/g, " ");
    return condensed.length > 180 ? `${condensed.slice(0, 177)}...` : condensed;
};

const fetchFirstOk = async (
    baseUrls: string[],
    path: string,
    init: RequestInit,
    timeoutMs: number,
    options: {
        preferredBaseUrl?: string | null;
        onSuccess?: (baseUrl: string) => void;
        acceptServerErrorResponse?: boolean;
    } = {},
): Promise<Response> => {
    const orderedBaseUrls = prioritizeBaseUrls(baseUrls, options.preferredBaseUrl ?? null);
    const errors: string[] = [];
    let firstClientError: Response | null = null;

    for (const baseUrl of orderedBaseUrls) {
        try {
            const url = new URL(path, baseUrl).toString();
            const res = await fetchWithTimeout(url, init, timeoutMs);
            if (!res.ok) {
                logDebug(`[Moon API] ${path} via ${baseUrl} responded with HTTP ${res.status}`);
                if (res.status >= 400 && res.status < 500) {
                    // Keep trying other backends when no preferred target exists yet.
                    // This avoids false auth failures when one stale endpoint returns 4xx.
                    if (!options.preferredBaseUrl) {
                        firstClientError = firstClientError ?? res;
                        continue;
                    }
                    return res;
                }
                if (options.acceptServerErrorResponse && res.status >= 500) {
                    return res;
                }
                const body = await res.text().catch(() => "");
                const summary = summarizeFailedResponseBody(body);
                errors.push(`${baseUrl} (HTTP ${res.status}${summary ? `: ${summary}` : ""})`);
                continue;
            }
            options.onSuccess?.(baseUrl);
            logDebug(`[Moon API] ${path} succeeded via ${baseUrl}`);
            return res;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${baseUrl} (${message})`);
            logError(`[Moon API] ${path} via ${baseUrl} failed: ${message}`);
        }
    }

    if (firstClientError) {
        return firstClientError;
    }

    const message = `All backends failed for ${path}: ${errors.join(" | ")}`;
    logError(`[Moon API] ${message}`);
    throw new Error(message);
};

export const wardenJson = async (
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number } = {},
) => {
    const res = await fetchFirstOk(
        resolveWardenBaseUrls(),
        path,
        {...init, headers: {Accept: "application/json", ...(init.headers || {})}},
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        {
            preferredBaseUrl: preferredWardenBaseUrl,
            onSuccess: (baseUrl) => {
                preferredWardenBaseUrl = baseUrl;
            },
        },
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

export const sageJson = async (
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number } = {},
) => {
    const res = await fetchFirstOk(
        resolveSageBaseUrls(),
        path,
        {...init, headers: {Accept: "application/json", ...(init.headers || {})}},
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        {
            preferredBaseUrl: preferredSageBaseUrl,
            onSuccess: (baseUrl) => {
                preferredSageBaseUrl = baseUrl;
            },
        },
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

export const sageResponse = async (
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number; acceptServerErrorResponse?: boolean } = {},
) =>
    fetchFirstOk(
        resolveSageBaseUrls(),
        path,
        init,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        {
            preferredBaseUrl: preferredSageBaseUrl,
            acceptServerErrorResponse: options.acceptServerErrorResponse === true,
            onSuccess: (baseUrl) => {
                preferredSageBaseUrl = baseUrl;
            },
        },
    );

export const ravenJson = async (
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number } = {},
) => {
    const res = await fetchFirstOk(
        resolveRavenBaseUrls(),
        path,
        {...init, headers: {Accept: "application/json", ...(init.headers || {})}},
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        {
            preferredBaseUrl: preferredRavenBaseUrl,
            onSuccess: (baseUrl) => {
                preferredRavenBaseUrl = baseUrl;
            },
        },
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

export const portalJson = async (
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number; acceptServerErrorResponse?: boolean } = {},
) => {
    const res = await fetchFirstOk(
        resolvePortalBaseUrls(),
        path,
        {...init, headers: {Accept: "application/json", ...(init.headers || {})}},
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        {
            preferredBaseUrl: preferredPortalBaseUrl,
            acceptServerErrorResponse: options.acceptServerErrorResponse === true,
            onSuccess: (baseUrl) => {
                preferredPortalBaseUrl = baseUrl;
            },
        },
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

export const jsonError = (message: string, status = 502) =>
    NextResponse.json({error: message}, {status});
