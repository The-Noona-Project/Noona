import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const sourceUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!sourceUrl) {
        return jsonError("url is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/raven/title-details?url=${encodeURIComponent(sourceUrl)}`, {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
