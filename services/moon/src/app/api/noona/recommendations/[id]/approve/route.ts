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

    let bodyText = "";
    try {
        bodyText = await request.text();
    } catch {
        return jsonError("Request body could not be read.", 400);
    }

    let body: unknown = undefined;
    if (bodyText.trim()) {
        try {
            body = JSON.parse(bodyText);
        } catch {
            return jsonError("Request body must be valid JSON.", 400);
        }
    }

    try {
        const {status, payload} = await sageJson(`/api/recommendations/${encodeURIComponent(id)}/approve`, {
            method: "POST",
            headers: {
                ...(await withNoonaAuthHeaders()),
                ...(body === undefined ? {} : {"Content-Type": "application/json"}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
