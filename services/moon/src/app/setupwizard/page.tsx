import {Meta} from "@once-ui-system/core";
import {SetupWizard} from "@/components/noona/SetupWizard";
import {SetupWizardGate} from "@/components/noona/SetupWizardGate";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Setup",
        description: "Configure and install the Noona stack.",
        baseURL: resolveMoonBaseUrl(),
        path: "/setupwizard",
        image: "/favicon.ico",
    });
}

export default function SetupWizardPage() {
    return (
        <SetupWizardGate>
            <SetupWizard/>
        </SetupWizardGate>
    );
}
