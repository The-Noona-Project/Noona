import {NextResponse} from "next/server";
import {jsonError, wardenJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await wardenJson("/api/storage/layout");
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
