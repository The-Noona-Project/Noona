import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
    const routeParams = await context.params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid.trim() : "";

    if (!uuid) {
        return jsonError("Title UUID is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}`);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
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
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
    const routeParams = await context.params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid.trim() : "";

    if (!uuid) {
        return jsonError("Title UUID is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}`, {
            method: "DELETE",
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
