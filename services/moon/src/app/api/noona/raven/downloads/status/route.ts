import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";
import {withNoonaAuthHeaders} from "../../../_auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const {status, payload} = await sageJson("/api/raven/downloads/status", {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}

export async function DELETE() {
    try {
        const {status, payload} = await sageJson("/api/raven/downloads/status", {
            method: "DELETE",
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
