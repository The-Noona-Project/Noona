import {NextResponse} from "next/server";
import {sageJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await sageJson("/api/setup/status");
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({
            completed: false,
            configured: false,
            installing: false,
            debugEnabled: false,
            selectionMode: "unspecified",
            selectedServices: [],
            lifecycleServices: [],
            manualBootRequired: false,
            error: message
        });
    }
}
