import {redirect} from "next/navigation";
import {resolveLegacySettingsHref} from "@/components/noona/settings";

type SettingsRootPageProps = {
    searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function SettingsRootPage({searchParams}: SettingsRootPageProps) {
    const resolvedSearchParams = await searchParams;
    redirect(resolveLegacySettingsHref(resolvedSearchParams?.tab));
}
