import {Meta} from "@once-ui-system/core";
import {MySubscriptionsPage} from "@/components/noona/MySubscriptionsPage";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export async function generateMetadata() {
    return Meta.generate({
        title: "Noona My Subscriptions",
        description: "View and manage your subscribed title notifications.",
        baseURL: resolveMoonBaseUrl(),
        path: "/mysubscriptions",
        image: "/favicon.ico",
    });
}

export default function MySubscriptionsRoute() {
    return <MySubscriptionsPage/>;
}
