import {Meta} from "@once-ui-system/core";
import {RecommendationDetailPage} from "@/components/noona/RecommendationDetailPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

type RecommendationPageParams = {
    id: string;
};

export async function generateMetadata({params}: { params: Promise<RecommendationPageParams> }) {
    const routeParams = await params;
    const id = typeof routeParams?.id === "string" ? routeParams.id : "";

    return Meta.generate({
        title: id ? `Recommendation ${id}` : "Recommendation timeline",
        description: "Review recommendation decisions and comments.",
        baseURL: resolveMoonBaseUrl(),
        path: id ? `/recommendations/${id}` : "/recommendations",
        image: "/favicon.ico",
    });
}

export default async function RecommendationRoute({params}: { params: Promise<RecommendationPageParams> }) {
    const routeParams = await params;
    const id = typeof routeParams?.id === "string" ? routeParams.id : "";
    return <RecommendationDetailPage recommendationId={id} scope="admin"/>;
}
