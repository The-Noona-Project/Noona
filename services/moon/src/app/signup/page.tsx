import {Meta} from "@once-ui-system/core";
import {SignupPage} from "@/components/noona/SignupPage";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona Admin Signup",
        description: "Create the initial Noona admin account.",
        baseURL: "http://localhost:3000",
        path: "/signup",
        image: "/favicon.ico",
    });
}

export default function Signup() {
    return <SignupPage/>;
}
