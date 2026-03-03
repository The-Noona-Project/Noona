import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";
import {withNoonaAuthHeaders} from "../../../_auth";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, context: { params: Promise<{ username: string }> }) {
    const routeParams = await context.params;
    const username = typeof routeParams?.username === "string" ? routeParams.username.trim() : "";

    if (!username) {
        return jsonError("Username is required.", 400);
    }

    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/auth/users/${encodeURIComponent(username)}`, {
            method: "PUT",
            headers: await withNoonaAuthHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify(body ?? {}),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ username: string }> }) {
    const routeParams = await context.params;
    const username = typeof routeParams?.username === "string" ? routeParams.username.trim() : "";

    if (!username) {
        return jsonError("Username is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/auth/users/${encodeURIComponent(username)}`, {
            method: "DELETE",
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
