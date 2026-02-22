import {Meta} from "@once-ui-system/core";
import {LoginPage} from "@/components/noona/LoginPage";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Login",
        description: "Sign in to Noona.",
        baseURL: "http://localhost:3000",
        path: "/login",
        image: "/favicon.ico",
    });
}

export default function Login() {
    return <LoginPage/>;
}

