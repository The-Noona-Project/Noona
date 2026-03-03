import {resolveMoonBaseUrl} from "@/utils/webGui";

export default function robots() {
    const baseUrl = resolveMoonBaseUrl();

    return {
        rules: [
            {
                userAgent: "*",
            },
        ],
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
