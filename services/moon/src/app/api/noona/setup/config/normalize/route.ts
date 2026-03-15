import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonError("Request body must be a JSON object.", 400);
    }

    try {
        const {status, payload} = await sageJson("/api/setup/config/normalize", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
