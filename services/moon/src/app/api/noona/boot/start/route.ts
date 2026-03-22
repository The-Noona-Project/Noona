import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));

    try {
        const {status, payload} = await sageJson("/api/setup/boot/start", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body ?? {}),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
