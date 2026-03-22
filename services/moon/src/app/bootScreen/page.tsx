import {Meta} from "@once-ui-system/core";
import {BootScreenPage} from "@/components/noona/BootScreenPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

type SearchParamValue = string | string[] | undefined;

type BootScreenPageRouteProps = {
    searchParams?: Promise<Record<string, SearchParamValue>> | Record<string, SearchParamValue>;
};

const readSearchParam = (value: SearchParamValue): string | null => {
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0] : null;
    }
    return typeof value === "string" ? value : null;
};

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Boot Screen",
        description: "Start the saved Noona ecosystem and monitor lifecycle recovery.",
        baseURL: resolveMoonBaseUrl(),
        path: "/bootScreen",
        image: "/favicon.ico",
    });
}

export default async function BootScreen({searchParams}: BootScreenPageRouteProps) {
    const resolvedSearchParams = searchParams && typeof searchParams === "object" && "then" in searchParams
        ? await searchParams
        : (searchParams ?? {});

    return <BootScreenPage returnToParam={readSearchParam(resolvedSearchParams.returnTo)}/>;
}
