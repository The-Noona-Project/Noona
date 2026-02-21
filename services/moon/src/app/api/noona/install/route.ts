import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson} from "../_backend";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        return jsonError("Request body must be valid JSON.", 400);
    }

    const services =
        body && typeof body === "object" && "services" in body
            ? (body as { services?: unknown }).services
            : body;

    try {
        const {status, payload} = await sageJson("/api/setup/install", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({services}),
        }, {timeoutMs: 1000 * 60 * 30});

        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
