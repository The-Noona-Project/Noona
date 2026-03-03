import {Suspense} from "react";
import {Meta} from "@once-ui-system/core";
import {DiscordCallbackPage} from "@/components/noona/DiscordCallbackPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Discord Callback",
        description: "Completes the Discord OAuth flow for Moon.",
        baseURL: resolveMoonBaseUrl(),
        path: "/discord/callback",
        image: "/favicon.ico",
    });
}

export default function DiscordCallbackRoute() {
    return (
        <Suspense fallback={null}>
            <DiscordCallbackPage/>
        </Suspense>
    );
}
