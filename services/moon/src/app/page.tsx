import {Meta} from "@once-ui-system/core";
import {HomePage} from "@/components/noona/HomePage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona",
        description: "Browse your Noona libraries and downloads.",
        baseURL: resolveMoonBaseUrl(),
        path: "/",
        image: "/favicon.ico",
    });
}

export default function Home() {
    return <HomePage/>;
}
