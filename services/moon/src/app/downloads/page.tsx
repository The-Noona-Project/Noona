import {Meta} from "@once-ui-system/core";
import {DownloadsPage} from "@/components/noona/DownloadsPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Downloads",
        description: "Queue and monitor Raven downloads.",
        baseURL: resolveMoonBaseUrl(),
        path: "/downloads",
        image: "/favicon.ico",
    });
}

export default function Downloads() {
    return <DownloadsPage/>;
}
