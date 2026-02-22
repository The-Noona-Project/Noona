import {Meta} from "@once-ui-system/core";
import {SettingsPage} from "@/components/noona/SettingsPage";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Settings",
        description: "Configure Noona behavior.",
        baseURL: "http://localhost:3000",
        path: "/settings",
        image: "/favicon.ico",
    });
}

export default function Settings() {
    return <SettingsPage/>;
}

