import {NextRequest, NextResponse} from "next/server";
import {jsonError, portalJson} from "../../../../_backend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const state = request.nextUrl.searchParams.get("state")?.trim() || "notMatched";
    const searchTerm = request.nextUrl.searchParams.get("searchTerm")?.trim() || "";
    const pageNumber = request.nextUrl.searchParams.get("pageNumber")?.trim() || "1";
    const pageSize = request.nextUrl.searchParams.get("pageSize")?.trim() || "0";
    const libraryType = request.nextUrl.searchParams.get("libraryType")?.trim() || "-1";

    try {
        const query = new URLSearchParams({
            state,
            pageNumber,
            pageSize,
            libraryType,
        });
        if (searchTerm) {
            query.set("searchTerm", searchTerm);
        }

        const {
            status,
            payload
        } = await portalJson(`/api/portal/kavita/series-metadata?${query.toString()}`, undefined, {
            acceptServerErrorResponse: true,
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
