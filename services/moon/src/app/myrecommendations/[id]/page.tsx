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
        title: id ? `My Recommendation ${id}` : "My recommendation timeline",
        description: "Track recommendation events and comments.",
        baseURL: resolveMoonBaseUrl(),
        path: id ? `/myrecommendations/${id}` : "/myrecommendations",
        image: "/favicon.ico",
    });
}

export default async function MyRecommendationDetailRoute({params}: { params: Promise<RecommendationPageParams> }) {
    const routeParams = await params;
    const id = typeof routeParams?.id === "string" ? routeParams.id : "";
    return <RecommendationDetailPage recommendationId={id} scope="my"/>;
}
