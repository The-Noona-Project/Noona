import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../../_backend";
import {withNoonaAuthHeaders} from "../../../_auth";

export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
    const routeParams = await context.params;
    const id = typeof routeParams?.id === "string" ? routeParams.id.trim() : "";
    if (!id) {
        return jsonError("Recommendation id is required.", 400);
    }

    const body = await request.json().catch(() => ({}));
    const comment = typeof body?.comment === "string" ? body.comment : "";

    try {
        const {status, payload} = await sageJson(`/api/recommendations/${encodeURIComponent(id)}/comments`, {
            method: "POST",
            headers: await withNoonaAuthHeaders({
                "Content-Type": "application/json",
            }),
            body: JSON.stringify({comment}),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
