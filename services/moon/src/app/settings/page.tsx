import {Meta} from "@once-ui-system/core";
import {SettingsPage} from "@/components/noona/SettingsPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Settings",
        description: "Configure Noona behavior.",
        baseURL: resolveMoonBaseUrl(),
        path: "/settings",
        image: "/favicon.ico",
    });
}

export default function Settings() {
    return <SettingsPage/>;
}
