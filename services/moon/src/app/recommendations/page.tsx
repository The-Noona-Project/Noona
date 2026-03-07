import {Meta} from "@once-ui-system/core";
import {AdminRecommendationsPage} from "@/components/noona/AdminRecommendationsPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Recommendations Admin",
        description: "Manage and approve user-submitted recommendations.",
        baseURL: resolveMoonBaseUrl(),
        path: "/recommendations",
        image: "/favicon.ico",
    });
}

export default function Recommendations() {
    return <AdminRecommendationsPage/>;
}
