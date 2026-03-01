import {cookies} from "next/headers";

export const NOONA_SESSION_COOKIE = "noona_session";

export const getNoonaSessionToken = async () => {
    const store = await cookies();
    const token = store.get(NOONA_SESSION_COOKIE)?.value;
    return typeof token === "string" && token.trim() ? token.trim() : null;
};

export const withNoonaAuthHeaders = async (headers: Record<string, string> = {}) => {
    const token = await getNoonaSessionToken();
    if (!token) return headers;
    return {...headers, Authorization: `Bearer ${token}`};
};

export const buildNoonaSessionCookieOptions = (request: Request) => {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const requestProto = new URL(request.url).protocol.replace(":", "");
    const effectiveProto = (forwardedProto ?? requestProto ?? "http").trim().toLowerCase();
    const secureCookie = process.env.NODE_ENV === "production" && effectiveProto === "https";

    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: secureCookie,
        path: "/",
        maxAge: 60 * 60 * 24,
    };
};
