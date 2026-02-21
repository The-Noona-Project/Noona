import {NextResponse} from "next/server";
import {sageJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {payload} = await sageJson("/api/setup/wizard/state");
        const completed = payload && typeof payload === "object" && (payload as {
            completed?: unknown
        }).completed === true;
        return NextResponse.json({completed});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({completed: false, error: message});
    }
}

