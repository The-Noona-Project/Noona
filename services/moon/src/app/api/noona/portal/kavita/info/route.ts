import {NextResponse} from "next/server";
import {jsonError, portalJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await portalJson("/api/portal/kavita/info");
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
