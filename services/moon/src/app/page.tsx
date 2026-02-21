import {Meta} from "@once-ui-system/core";
import {HomePage} from "@/components/noona/HomePage";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona",
        description: "Browse your Noona libraries and downloads.",
        baseURL: "http://localhost:3000",
        path: "/",
        image: "/favicon.ico",
    });
}

export default function Home() {
    return <HomePage/>;
}
