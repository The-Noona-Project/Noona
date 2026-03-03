import {NextResponse} from "next/server";
import {jsonError, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

const normalizeSelectedServices = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const selected = new Set<string>();
    for (const entry of value) {
        if (typeof entry !== "string") {
            continue;
        }

        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }

        selected.add(trimmed);
    }

    return Array.from(selected).sort((left, right) => left.localeCompare(right));
};

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const selectedServices = normalizeSelectedServices(
        body && typeof body === "object" ? (body as { selectedServices?: unknown }).selectedServices : undefined,
    );

    try {
        const finalize = await sageJson("/api/auth/bootstrap/finalize", {
            method: "POST",
            headers: await withNoonaAuthHeaders(),
        });
        if (finalize.status >= 400) {
            return NextResponse.json(finalize.payload, {status: finalize.status});
        }

        const {payload: current} = await sageJson("/api/setup/wizard/state");
        const normalized = current && typeof current === "object" ? {...(current as Record<string, unknown>)} : {};

        const now = new Date().toISOString();
        normalized.completed = true;
        normalized.updatedAt = now;

        if (selectedServices.length > 0) {
            const verification =
                normalized.verification && typeof normalized.verification === "object"
                    ? {...(normalized.verification as Record<string, unknown>)}
                    : {};
            const actor =
                verification.actor && typeof verification.actor === "object"
                    ? {...(verification.actor as Record<string, unknown>)}
                    : {};
            const metadata =
                actor.metadata && typeof actor.metadata === "object"
                    ? {...(actor.metadata as Record<string, unknown>)}
                    : {};

            actor.metadata = {
                ...metadata,
                selectedServices,
            };
            verification.actor = actor;
            normalized.verification = verification;
        }

        const {status, payload} = await sageJson("/api/setup/wizard/state", {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({state: normalized}),
        });

        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
