import {Meta} from "@once-ui-system/core";
import {HomePage} from "@/components/noona/HomePage";
import {moonSite} from "@/resources";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: moonSite.title,
        description: moonSite.description,
        baseURL: resolveMoonBaseUrl(),
        path: "/",
        image: moonSite.image,
    });
}

export default function Home() {
    return <HomePage/>;
}
