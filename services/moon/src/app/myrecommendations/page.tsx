import {Meta} from "@once-ui-system/core";
import {MyRecommendationsPage} from "@/components/noona/MyRecommendationsPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona My Recommendations",
        description: "View your submitted recommendations and status timeline.",
        baseURL: resolveMoonBaseUrl(),
        path: "/myrecommendations",
        image: "/favicon.ico",
    });
}

export default function MyRecommendationsRoute() {
    return <MyRecommendationsPage/>;
}
