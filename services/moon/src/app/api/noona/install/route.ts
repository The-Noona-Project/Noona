import {NextRequest, NextResponse} from "next/server";
import {jsonError, sageJson, wardenJson} from "../_backend";

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
    const requestInit = {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({services}),
    } as const;
    const timeout = {timeoutMs: 1000 * 60 * 30} as const;

    try {
        const {status, payload} = await wardenJson("/api/services/install", {
            ...requestInit,
        }, timeout);
        return NextResponse.json(payload, {status});
    } catch (wardenError) {
        try {
            const {status, payload} = await sageJson("/api/setup/install", {
                ...requestInit,
            }, timeout);
            return NextResponse.json(payload, {status});
        } catch (sageError) {
            const wardenMessage = wardenError instanceof Error ? wardenError.message : String(wardenError);
            const sageMessage = sageError instanceof Error ? sageError.message : String(sageError);
            return jsonError(`Warden install failed (${wardenMessage}). Sage fallback failed (${sageMessage}).`);
        }
    }
}
