import {Meta} from "@once-ui-system/core";
import {SignupPage} from "@/components/noona/SignupPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Admin Signup",
        description: "Create the initial Noona admin account.",
        baseURL: resolveMoonBaseUrl(),
        path: "/signup",
        image: "/favicon.ico",
    });
}

export default function Signup() {
    return <SignupPage/>;
}
