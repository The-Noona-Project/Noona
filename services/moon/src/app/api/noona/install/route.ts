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
    const requestInit = {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({services}),
    } as const;
    const timeout = {timeoutMs: 15_000} as const;

    try {
        const {status, payload} = await sageJson("/api/setup/install?async=true", {
            ...requestInit,
        }, timeout);
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
