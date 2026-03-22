import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../_backend";
import {retryBackendRead} from "../backendReadRetry.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await retryBackendRead(() => sageJson("/api/setup/services"));
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
