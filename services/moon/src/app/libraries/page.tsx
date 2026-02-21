import {Meta} from "@once-ui-system/core";
import {LibrariesPage} from "@/components/noona/LibrariesPage";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Library",
        description: "View downloaded titles managed by Raven.",
        baseURL: "http://localhost:3000",
        path: "/libraries",
        image: "/favicon.ico",
    });
}

export default function Libraries() {
    return <LibrariesPage/>;
}

