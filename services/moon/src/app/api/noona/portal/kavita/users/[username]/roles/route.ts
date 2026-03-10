import {NextRequest, NextResponse} from "next/server";
import {jsonError, portalJson} from "../../../../../_backend";

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
        const {status, payload} = await portalJson(
            `/api/portal/kavita/users/${encodeURIComponent(username)}/roles`,
            {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body ?? {}),
            },
        );
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
