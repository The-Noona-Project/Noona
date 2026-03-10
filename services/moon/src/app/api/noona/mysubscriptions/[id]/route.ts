import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
    const routeParams = await context.params;
    const id = typeof routeParams?.id === "string" ? routeParams.id.trim() : "";
    if (!id) {
        return jsonError("Subscription id is required.", 400);
    }

    try {
        const {status, payload} = await sageJson(`/api/mysubscriptions/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: await withNoonaAuthHeaders(),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
