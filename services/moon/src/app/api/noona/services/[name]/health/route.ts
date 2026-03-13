import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function GET(
    _request: Request,
    context: { params: Promise<{ name: string }> },
) {
    const routeParams = await context.params;
    const name = typeof routeParams?.name === "string" ? routeParams.name.trim() : "";

    if (!name) {
        return jsonError("Service name is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/setup/services/${encodeURIComponent(name)}/health`);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
