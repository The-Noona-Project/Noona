import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson("/api/setup/services/noona-kavita/service-key", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body ?? {}),
        }, {
            timeoutMs: 45_000,
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
