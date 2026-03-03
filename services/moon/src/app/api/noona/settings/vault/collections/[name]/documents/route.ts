import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../../_auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
    const routeParams = await context.params;
    const name = typeof routeParams?.name === "string" ? routeParams.name.trim() : "";

    if (!name) {
        return jsonError("Collection name is required.", 400);
    }

    const limit = request.nextUrl.searchParams.get("limit");
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : "";

    try {
        const {
            status,
            payload
        } = await sageJson(`/api/settings/vault/collections/${encodeURIComponent(name)}/documents${suffix}`, {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
