import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    let body: unknown = null;

    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    try {
        const {status, payload} = await sageJson("/api/raven/download", {
            method: "POST",
            headers: await withNoonaAuthHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify(body),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
