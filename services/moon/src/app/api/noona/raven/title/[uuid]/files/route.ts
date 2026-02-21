import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";

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
        const {status, payload} = await sageJson(`/api/raven/title/${encodeURIComponent(uuid)}/files${suffix}`);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
