import {NextResponse} from "next/server";
import {jsonError, sageJson, wardenJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await wardenJson("/api/services/install/progress");
        return NextResponse.json(payload, {status});
    } catch (wardenError) {
        try {
            const {status, payload} = await sageJson("/api/setup/services/install/progress");
            return NextResponse.json(payload, {status});
        } catch (sageError) {
            const wardenMessage = wardenError instanceof Error ? wardenError.message : String(wardenError);
            const sageMessage = sageError instanceof Error ? sageError.message : String(sageError);
            return jsonError(`Warden progress failed (${wardenMessage}). Sage fallback failed (${sageMessage}).`);
        }
    }
}
