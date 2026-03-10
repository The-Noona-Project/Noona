import {NextResponse} from "next/server";
import {jsonError, portalJson, sageJson} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";

export const dynamic = "force-dynamic";

type NoonaAuthStatusPayload = {
    user?: {
        username?: string | null;
        email?: string | null;
        discordUserId?: string | null;
        discordUsername?: string | null;
        discordGlobalName?: string | null;
    } | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export async function POST() {
    try {
        const authHeaders = await withNoonaAuthHeaders();
        const authResponse = await sageJson("/api/auth/status", {
            headers: authHeaders,
        });
        const authPayload = authResponse.payload as NoonaAuthStatusPayload | null;
        if (authResponse.status !== 200) {
            return NextResponse.json(authPayload ?? {error: "Not authenticated with Noona."}, {status: authResponse.status});
        }

        const user = authPayload?.user;
        const discordId = normalizeString(user?.discordUserId);
        const email = normalizeString(user?.email);
        if (!discordId || !email) {
            return jsonError("Your Noona account is missing the Discord id or email required to create a Kavita account.", 400);
        }

        const {status, payload} = await portalJson("/api/portal/kavita/noona-login", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                discordId,
                email,
                username: normalizeString(user?.username),
                discordUsername: normalizeString(user?.discordUsername),
                displayName: normalizeString(user?.discordGlobalName) || normalizeString(user?.username),
            }),
        });

        return NextResponse.json(payload, {status});
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
