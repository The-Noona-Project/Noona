import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    await request.json().catch(() => ({}));

    try {
        const finalize = await sageJson("/api/auth/bootstrap/finalize", {
            method: "POST",
            headers: await withNoonaAuthHeaders(),
        });
        if (finalize.status >= 400) {
            return NextResponse.json(finalize.payload, {status: finalize.status});
        }

        const currentState = await sageJson("/api/setup/wizard/state", {
            headers: await withNoonaAuthHeaders(),
        });
        if (currentState.status >= 400) {
            return NextResponse.json(currentState.payload, {status: currentState.status});
        }

        const current = currentState.payload;
        const normalized = current && typeof current === "object" ? {...(current as Record<string, unknown>)} : {};

        const now = new Date().toISOString();
        normalized.completed = true;
        normalized.updatedAt = now;

        const {status, payload} = await sageJson("/api/setup/wizard/state", {
            method: "PUT",
            headers: await withNoonaAuthHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({state: normalized}),
        });

        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
