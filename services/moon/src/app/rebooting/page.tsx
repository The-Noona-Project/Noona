import {Meta} from "@once-ui-system/core";
import {RebootingPage} from "@/components/noona/RebootingPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

type SearchParamValue = string | string[] | undefined;

type RebootingPageRouteProps = {
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
        title: "Noona Rebooting",
        description: "Monitor Noona while services restart and come back online.",
        baseURL: resolveMoonBaseUrl(),
        path: "/rebooting",
        image: "/favicon.ico",
    });
}

export default async function Rebooting({searchParams}: RebootingPageRouteProps) {
    const resolvedSearchParams = searchParams && typeof searchParams === "object" && "then" in searchParams
        ? await searchParams
        : (searchParams ?? {});

    return (
        <RebootingPage
            servicesParam={readSearchParam(resolvedSearchParams.services)}
            returnToParam={readSearchParam(resolvedSearchParams.returnTo)}
        />
    );
}
