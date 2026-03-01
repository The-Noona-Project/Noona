import {NextRequest, NextResponse} from "next/server";
import {jsonError, portalJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    if (!query) {
        return jsonError("query is required.", 400);
    }

    try {
        const {
            status,
            payload
        } = await portalJson(`/api/portal/kavita/title-search?query=${encodeURIComponent(query)}`);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
