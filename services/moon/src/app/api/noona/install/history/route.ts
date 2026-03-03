import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson, wardenJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const limit = request.nextUrl.searchParams.get("limit");
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : "";

    try {
        const {status, payload} = await wardenJson(`/api/services/installation/logs${suffix}`);
        return NextResponse.json(payload, {status});
    } catch (wardenError) {
        try {
            const {status, payload} = await sageJson(`/api/setup/services/installation/logs${suffix}`);
            return NextResponse.json(payload, {status});
        } catch (sageError) {
            const wardenMessage = wardenError instanceof Error ? wardenError.message : String(wardenError);
            const sageMessage = sageError instanceof Error ? sageError.message : String(sageError);
            return jsonError(`Warden install logs failed (${wardenMessage}). Sage fallback failed (${sageMessage}).`);
        }
    }
}
