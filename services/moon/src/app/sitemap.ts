import {moonRoutes} from "@/resources";
import {resolveMoonBaseUrl} from "@/utils/webGui";

export default async function sitemap() {
    const baseUrl = resolveMoonBaseUrl();
    const hiddenRoutes = new Set(["/bootScreen", "/rebooting"]);
    const activeRoutes = Object.keys(moonRoutes).filter(
        (route) => moonRoutes[route as keyof typeof moonRoutes] && !hiddenRoutes.has(route),
    );

    return activeRoutes.map((route) => ({
        url: `${baseUrl}${route !== "/" ? route : ""}`,
        lastModified: new Date().toISOString().split("T")[0],
    }));
}
