import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../_auth";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, context: { params: Promise<{ username: string }> }) {
    const routeParams = await context.params;
    const username = typeof routeParams?.username === "string" ? routeParams.username.trim() : "";

    if (!username) {
        return jsonError("Username is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/auth/users/${encodeURIComponent(username)}/reset-password`, {
            method: "POST",
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
