"use client";

import {usePathname} from "next/navigation";
import {moonDynamicRoutePrefixes, moonRoutes} from "@/resources";
import NotFound from "@/app/not-found";

interface RouteGuardProps {
    children: React.ReactNode;
}

const RouteGuard: React.FC<RouteGuardProps> = ({children}) => {
    const pathname = usePathname();
    if (!pathname) {
        return <>{children}</>;
    }

    const isRouteEnabled = (() => {
        if (pathname in moonRoutes) {
            return moonRoutes[pathname as keyof typeof moonRoutes];
        }

        return moonDynamicRoutePrefixes.some(
            (routePrefix) => pathname.startsWith(`${routePrefix}/`) && moonRoutes[routePrefix],
        );
    })();

    if (!isRouteEnabled) {
        return <NotFound/>;
    }

    return <>{children}</>;
};

export {RouteGuard};
