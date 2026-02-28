import {Meta} from "@once-ui-system/core";
import {LoginPage} from "@/components/noona/LoginPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Login",
        description: "Sign in to Noona.",
        baseURL: resolveMoonBaseUrl(),
        path: "/login",
        image: "/favicon.ico",
    });
}

export default function Login() {
    return <LoginPage/>;
}
