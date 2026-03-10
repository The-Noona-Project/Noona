import {redirect} from "next/navigation";

type LegacyRecommendationParams = {
    id: string;
};

export default async function LegacyRecommendationDetailRoute({params}: {
    params: Promise<LegacyRecommendationParams>
}) {
    const routeParams = await params;
    const id = typeof routeParams?.id === "string" ? routeParams.id.trim() : "";
    if (!id) {
        redirect("/myrecommendations");
    }

    redirect(`/myrecommendations/${encodeURIComponent(id)}`);
}
