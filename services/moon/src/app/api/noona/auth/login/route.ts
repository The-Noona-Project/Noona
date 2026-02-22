import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {NOONA_SESSION_COOKIE} from "../../_auth";

export const dynamic = "force-dynamic";

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

export async function POST(request: Request) {
    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson("/api/auth/login", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });

        if (status >= 400) {
            return NextResponse.json(payload, {status});
        }

        const token =
            payload && typeof payload === "object" && "token" in payload
                ? normalizeString((payload as { token?: unknown }).token).trim()
                : "";

        const user =
            payload && typeof payload === "object" && "user" in payload && typeof (payload as {
                user?: unknown
            }).user === "object"
                ? (payload as { user?: unknown }).user
                : null;

        if (!token) {
            return jsonError("Login succeeded but no session token was returned.", 502);
        }

        const res = NextResponse.json({user}, {status: 200});
        const forwardedProto = request.headers.get("x-forwarded-proto") ?? "http";
        const secureCookie = process.env.NODE_ENV === "production" && forwardedProto === "https";
        res.cookies.set(NOONA_SESSION_COOKIE, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookie,
            path: "/",
            maxAge: 60 * 60 * 24,
        });
        return res;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
