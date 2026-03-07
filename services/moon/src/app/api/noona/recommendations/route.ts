import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../_backend";
import {withNoonaAuthHeaders} from "../_auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const nextUrl = new URL(request.url);
    const limit = nextUrl.searchParams.get("limit");
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : "";

    try {
        const {status, payload} = await sageJson(`/api/recommendations${suffix}`, {
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
