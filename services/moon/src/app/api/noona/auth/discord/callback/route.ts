import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";
import {buildNoonaSessionCookieOptions, NOONA_SESSION_COOKIE} from "../../../_auth";

export const dynamic = "force-dynamic";

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const resolveRequestOrigin = (request: Request): string => {
    const forwardedProto = normalizeString(request.headers.get("x-forwarded-proto")).trim();
    const forwardedHost = normalizeString(request.headers.get("x-forwarded-host")).trim();
    const host = forwardedHost || normalizeString(request.headers.get("host")).trim();
    if (forwardedProto && host) {
        return `${forwardedProto}://${host}`;
    }

    return new URL(request.url).origin;
};

export async function POST(request: Request) {
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const origin = resolveRequestOrigin(request);
    const redirectUri = normalizeString(payload.redirectUri).trim() || `${origin}/discord/callback`;

    try {
        const {status, payload: responsePayload} = await sageJson("/api/auth/discord/callback", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                ...payload,
                redirectUri,
            }),
        });

        const token =
            responsePayload && typeof responsePayload === "object" && "token" in responsePayload
                ? normalizeString((responsePayload as { token?: unknown }).token).trim()
                : "";

        const response = NextResponse.json(responsePayload, {status});
        if (status < 400 && token) {
            response.cookies.set(NOONA_SESSION_COOKIE, token, buildNoonaSessionCookieOptions(request));
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
