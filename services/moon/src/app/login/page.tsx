import {Meta} from "@once-ui-system/core";
import {LoginPage} from "@/components/noona/LoginPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Discord Sign In",
        description: "Sign in to Moon with Discord OAuth.",
        baseURL: resolveMoonBaseUrl(),
        path: "/login",
        image: "/favicon.ico",
    });
}

export default function Login() {
    return <LoginPage/>;
}
