import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../_auth";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, context: { params: Promise<{ uuid: string }> }) {
    const routeParams = await context.params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid.trim() : "";

    if (!uuid) {
        return jsonError("Title UUID is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}/checkForNew`, {
            method: "POST",
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
