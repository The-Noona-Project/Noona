import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const limit = request.nextUrl.searchParams.get("limit");
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : "";

    try {
        const {status, payload} = await sageJson(`/api/setup/services/installation/logs${suffix}`);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
