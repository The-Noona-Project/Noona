import {Meta} from "@once-ui-system/core";
import {DownloadsAddPage} from "@/components/noona/DownloadsAddPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Add Raven Download",
        description: "Search Raven sources and queue downloads.",
        baseURL: resolveMoonBaseUrl(),
        path: "/downloads/add",
        image: "/favicon.ico",
    });
}

type DownloadsAddPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DownloadsAdd({searchParams}: DownloadsAddPageProps) {
    const resolvedSearchParams = (await searchParams) ?? {};
    const rawQuery = resolvedSearchParams.q;
    const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;

    return <DownloadsAddPage initialQuery={typeof initialQuery === "string" ? initialQuery : ""}/>;
}
