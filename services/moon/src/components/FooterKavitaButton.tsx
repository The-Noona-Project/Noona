"use client";

import {useEffect, useState} from "react";
import {Button} from "@once-ui-system/core";

type KavitaInfoResponse = {
    baseUrl?: string | null;
};

type ServicesResponse = {
    services?: Array<{
        hostServiceUrl?: string | null;
        installed?: boolean | null;
        name?: string | null;
    }> | null;
};

const normalizeUrl = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function FooterKavitaButton() {
    const [baseUrl, setBaseUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const setIfAvailable = (value: unknown) => {
            const nextUrl = normalizeUrl(value);
            if (!cancelled && nextUrl) {
                setBaseUrl(nextUrl);
                return true;
            }

            return false;
        };

        const load = async () => {
            try {
                const response = await fetch("/api/noona/services", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as ServicesResponse | null;
                if (response.ok && !cancelled) {
                    const services = Array.isArray(payload?.services) ? payload.services : [];
                    const managedKavita = services.find((entry) =>
                        normalizeUrl(entry?.name) === "noona-kavita" && entry?.installed === true,
                    );

                    if (setIfAvailable(managedKavita?.hostServiceUrl)) {
                        return;
                    }
                }
            } catch {
                // Fall back to Portal's configured Kavita URL below.
            }

            try {
                const response = await fetch("/api/noona/portal/kavita/info", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as KavitaInfoResponse | null;
                if (!response.ok || cancelled) {
                    return;
                }

                setIfAvailable(payload?.baseUrl);
            } catch {
                // Ignore footer helper failures.
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    if (!baseUrl) {
        return null;
    }

    return (
        <Button size="s" variant="secondary" onClick={() => window.open(baseUrl, "_blank", "noopener,noreferrer")}>
            Open Kavita
        </Button>
    );
}
