import {Meta} from "@once-ui-system/core";
import {TitleDetailPage} from "@/components/noona/TitleDetailPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata({params}: { params: Promise<{ uuid: string }> }) {
    const routeParams = await params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid : "";

    return Meta.generate({
        title: uuid ? `Noona Title ${uuid}` : "Noona Title",
        description: "View downloaded files and status for this title.",
        baseURL: resolveMoonBaseUrl(),
        path: uuid ? `/libraries/${uuid}` : "/libraries",
        image: "/favicon.ico",
    });
}

export default async function TitlePage({params}: { params: Promise<{ uuid: string }> }) {
    const routeParams = await params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid : "";

    return <TitleDetailPage uuid={uuid}/>;
}
