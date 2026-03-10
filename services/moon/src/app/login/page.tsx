import {Suspense} from "react";
import {Meta} from "@once-ui-system/core";
import {LoginPage} from "@/components/noona/LoginPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Sign In / Create Account",
        description: "Sign in to Moon with Discord OAuth or create your account on first login.",
        baseURL: resolveMoonBaseUrl(),
        path: "/login",
        image: "/favicon.ico",
    });
}

export default function Login() {
    return (
        <Suspense fallback={null}>
            <LoginPage/>
        </Suspense>
    );
}
