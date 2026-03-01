import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {
    buildNoonaSessionCookieOptions,
    getNoonaSessionToken,
    NOONA_SESSION_COOKIE,
    withNoonaAuthHeaders,
} from "../../_auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        const token = await getNoonaSessionToken();
        if (token) {
            await sageJson("/api/auth/logout", {
                method: "POST",
                headers: await withNoonaAuthHeaders(),
            }).catch(() => null);
        }

        const res = NextResponse.json({ok: true});
        res.cookies.set(NOONA_SESSION_COOKIE, "", {
            ...buildNoonaSessionCookieOptions(request),
            maxAge: 0,
        });
        return res;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
