import {NextResponse} from "next/server.js";

export const backendJsonResponse = (payload, status = 200) =>
    status === 204
        ? new NextResponse(null, {status})
        : NextResponse.json(payload ?? {}, {status});

export default backendJsonResponse;
