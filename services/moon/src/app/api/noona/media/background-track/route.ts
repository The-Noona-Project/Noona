import {jsonError, sageResponse} from "../../_backend";
import {withNoonaAuthHeaders} from "../../_auth";
import {proxyBackgroundTrackRequest} from "../backgroundTrackProxy.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const authHeaders = await withNoonaAuthHeaders();
        return await proxyBackgroundTrackRequest({
            authorization: authHeaders.Authorization,
            range: request.headers.get("range") ?? "",
            fetchTrack: (init: RequestInit) => sageResponse("/api/media/background-track", init),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message);
    }
}
