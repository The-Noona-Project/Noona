import {Suspense} from "react";
import {Meta} from "@once-ui-system/core";
import {SetupWizardGate} from "@/components/noona/SetupWizardGate";
import {SetupSummaryPage} from "@/components/noona/SetupSummaryPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Setup Summary",
        description: "Review the installed Noona services, validate Discord OAuth, and finalize setup.",
        baseURL: resolveMoonBaseUrl(),
        path: "/setupwizard/summary",
        image: "/favicon.ico",
    });
}

export default function SetupSummaryRoute() {
    return (
        <SetupWizardGate>
            <Suspense fallback={null}>
                <SetupSummaryPage/>
            </Suspense>
        </SetupWizardGate>
    );
}
