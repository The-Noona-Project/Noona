const normalizeUrl = (candidate) => {
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `http://${trimmed}`;
};

const uniqueStrings = (values) => {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

export const resolveWardenBaseUrls = (env = process.env) =>
    uniqueStrings([
        normalizeUrl(env.WARDEN_BASE_URL),
        normalizeUrl(env.WARDEN_INTERNAL_BASE_URL),
        normalizeUrl(env.WARDEN_DOCKER_URL),
        "http://noona-warden:4001",
        "http://host.docker.internal:4001",
        "http://127.0.0.1:4001",
        "http://localhost:4001",
    ]);

export const resolveSageBaseUrls = (env = process.env) =>
    uniqueStrings([
        normalizeUrl(env.SAGE_BASE_URL),
        normalizeUrl(env.SAGE_INTERNAL_BASE_URL),
        "http://noona-sage:3004",
        "http://host.docker.internal:3004",
        "http://127.0.0.1:3004",
        "http://localhost:3004",
    ]);

export const resolveRavenBaseUrls = (env = process.env) =>
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

export const resolvePortalBaseUrls = (env = process.env) =>
    uniqueStrings([
        normalizeUrl(env.PORTAL_BASE_URL),
        normalizeUrl(env.PORTAL_INTERNAL_BASE_URL),
        normalizeUrl(env.PORTAL_DOCKER_URL),
        "http://noona-portal:3003",
        "http://host.docker.internal:3003",
        "http://127.0.0.1:3003",
        "http://localhost:3003",
    ]);

export const summarizeFailedResponseBody = (body) => {
    const trimmed = typeof body === "string" ? body.trim() : "";
    if (!trimmed) return "";

    try {
        const parsed = JSON.parse(trimmed);
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

export const SAGE_BACKEND_FAILURE_GUIDANCE =
    "Moon could not reach Sage. For Warden-managed installs, check noona-sage health and confirm noona-moon and noona-sage share noona-network. For custom deployments, set noona-moon SAGE_BASE_URL to a reachable Sage URL.";

const containsHttpBackendResponse = (errors = []) =>
    Array.isArray(errors)
    && errors.some((entry) => typeof entry === "string" && /\(HTTP\s+\d{3}\b/i.test(entry));

export const buildBackendFailureMessage = (path, errors = [], options = {}) => {
    const normalizedPath = typeof path === "string" && path.trim() ? path.trim() : "unknown path";
    const details = Array.isArray(errors)
        ? errors
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean)
        : [];
    const guidance = (() => {
        const normalizedGuidance = typeof options.guidance === "string" ? options.guidance.trim() : "";
        if (!normalizedGuidance) return "";
        if (options.guidanceMode !== "transport-only") return normalizedGuidance;
        return containsHttpBackendResponse(details) ? "" : normalizedGuidance;
    })();
    const prefix = details.length > 0
        ? `All backends failed for ${normalizedPath}: ${details.join(" | ")}`
        : `All backends failed for ${normalizedPath}`;

    return guidance ? `${prefix}. ${guidance}` : prefix;
};
