import {Suspense} from "react";
import {Meta} from "@once-ui-system/core";
import {notFound} from "next/navigation";
import {SettingsPage} from "@/components/noona/SettingsPage";
import {parseSettingsSlug} from "@/components/noona/settings";
import {resolveMoonBaseUrl} from "@/utils/webGui";

type SettingsRoutePageProps = {
    params: Promise<{ slug: string[] }>;
};

export async function generateMetadata({params}: SettingsRoutePageProps) {
    const routeParams = await params;
    const selection = parseSettingsSlug(routeParams?.slug);

    return Meta.generate({
        title: selection ? `Noona Settings: ${selection.title}` : "Noona Settings",
        description: selection?.description ?? "Configure Noona behavior.",
        baseURL: resolveMoonBaseUrl(),
        path: selection?.href ?? "/settings",
        image: "/favicon.ico",
    });
}

export default async function SettingsRoutePage({params}: SettingsRoutePageProps) {
    const routeParams = await params;
    const selection = parseSettingsSlug(routeParams?.slug);

    if (!selection) {
        notFound();
    }

    return (
        <Suspense fallback={null}>
            <SettingsPage selection={selection}/>
        </Suspense>
    );
}
