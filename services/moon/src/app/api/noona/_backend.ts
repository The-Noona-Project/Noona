import {NextResponse} from "next/server";

const DEFAULT_TIMEOUT_MS = 8000;

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

const fetchFirstOk = async (
    baseUrls: string[],
    path: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> => {
    const errors: string[] = [];
    for (const baseUrl of baseUrls) {
        try {
            const url = new URL(path, baseUrl).toString();
            const res = await fetchWithTimeout(url, init, timeoutMs);
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                errors.push(`${baseUrl} (HTTP ${res.status}${body ? `: ${body}` : ""})`);
                continue;
            }
            return res;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${baseUrl} (${message})`);
        }
    }

    throw new Error(`All backends failed for ${path}: ${errors.join(" | ")}`);
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
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

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
    );

    const payload = await res.json().catch(() => ({}));
    return {status: res.status, payload};
};

export const jsonError = (message: string, status = 502) =>
    NextResponse.json({error: message}, {status});
