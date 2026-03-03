import {Meta} from "@once-ui-system/core";
import {SignupPage} from "@/components/noona/SignupPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Sign In / Create Account",
        description: "Sign in to Moon with Discord OAuth or create your account on first login.",
        baseURL: resolveMoonBaseUrl(),
        path: "/signup",
        image: "/favicon.ico",
    });
}

export default function Signup() {
    return <SignupPage/>;
}
