import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../_auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
    const routeParams = await context.params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid.trim() : "";

    if (!uuid) {
        return jsonError("Title UUID is required.", 400);
    }

    const limit = request.nextUrl.searchParams.get("limit");
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : "";

    try {
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}/files${suffix}`, {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
    const routeParams = await context.params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid.trim() : "";

    if (!uuid) {
        return jsonError("Title UUID is required.", 400);
    }

    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}/files`, {
            method: "DELETE",
            headers: await withNoonaAuthHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify(body ?? {}),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
