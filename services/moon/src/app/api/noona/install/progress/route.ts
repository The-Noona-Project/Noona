import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await sageJson("/api/setup/services/install/progress");
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

