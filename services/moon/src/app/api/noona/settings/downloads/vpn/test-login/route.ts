import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../../_backend";
import {withNoonaAuthHeaders} from "../../../../_auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    let body: unknown = {};

    try {
        body = await request.json();
    } catch {
        // Accept an empty body and fall back to persisted Vault credentials.
    }

    try {
        const {status, payload} = await sageJson("/api/settings/downloads/vpn/test-login", {
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
