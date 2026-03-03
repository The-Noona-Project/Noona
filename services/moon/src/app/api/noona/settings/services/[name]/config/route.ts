import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../_auth";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ name: string }> }) {
    const routeParams = await context.params;
    const name = typeof routeParams?.name === "string" ? routeParams.name.trim() : "";

    if (!name) {
        return jsonError("Service name is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/settings/services/${encodeURIComponent(name)}/config`, {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ name: string }> }) {
    const routeParams = await context.params;
    const name = typeof routeParams?.name === "string" ? routeParams.name.trim() : "";

    if (!name) {
        return jsonError("Service name is required.", 400);
    }

    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/settings/services/${encodeURIComponent(name)}/config`, {
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
