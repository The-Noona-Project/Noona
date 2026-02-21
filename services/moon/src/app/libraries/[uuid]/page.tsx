import {Meta} from "@once-ui-system/core";
import {TitleDetailPage} from "@/components/noona/TitleDetailPage";

export async function generateMetadata({params}: { params: Promise<{ uuid: string }> }) {
    const routeParams = await params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid : "";

    return Meta.generate({
        title: uuid ? `Noona Title ${uuid}` : "Noona Title",
        description: "View downloaded files and status for this title.",
        baseURL: "http://localhost:3000",
        path: uuid ? `/libraries/${uuid}` : "/libraries",
        image: "/favicon.ico",
    });
}

export default async function TitlePage({params}: { params: Promise<{ uuid: string }> }) {
    const routeParams = await params;
    const uuid = typeof routeParams?.uuid === "string" ? routeParams.uuid : "";

    return <TitleDetailPage uuid={uuid}/>;
}

