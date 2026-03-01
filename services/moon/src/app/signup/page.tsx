import {Meta} from "@once-ui-system/core";
import {SignupPage} from "@/components/noona/SignupPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Setup Redirect",
        description: "Redirects legacy signup requests into the Discord-based setup flow.",
        baseURL: resolveMoonBaseUrl(),
        path: "/signup",
        image: "/favicon.ico",
    });
}

export default function Signup() {
    return <SignupPage/>;
}
