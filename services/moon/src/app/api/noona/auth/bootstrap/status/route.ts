import {NextResponse} from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({
        available: false,
        error: "Username/password bootstrap is no longer available in Moon. Use the Discord OAuth setup summary instead.",
        redirectTo: "/setupwizard/summary",
    }, {status: 410});
}
