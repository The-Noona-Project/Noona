import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";
const FACTORY_RESET_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));

    try {
        const {status, payload} = await sageJson("/api/settings/factory-reset", {
            method: "POST",
            headers: await withNoonaAuthHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify(body ?? {}),
        }, {
            timeoutMs: FACTORY_RESET_TIMEOUT_MS,
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
