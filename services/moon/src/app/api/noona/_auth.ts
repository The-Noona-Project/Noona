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
