"use client";

import {useEffect, useState} from "react";
import {Button} from "@once-ui-system/core";
import {fetchManagedServiceHostUrl} from "@/utils/kavitaLinks";

type KavitaInfoResponse = {
    baseUrl?: string | null;
    externalBaseUrl?: string | null;
    internalBaseUrl?: string | null;
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
                const response = await fetch("/api/noona/portal/kavita/info", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as KavitaInfoResponse | null;
                if (!response.ok || cancelled) {
                    const managedKavitaUrl = await fetchManagedServiceHostUrl("noona-kavita");
                    setIfAvailable(managedKavitaUrl);
                    return;
                }

                if (setIfAvailable(payload?.baseUrl) || setIfAvailable(payload?.externalBaseUrl) || setIfAvailable(payload?.internalBaseUrl)) {
                    return;
                }

                const managedKavitaUrl = await fetchManagedServiceHostUrl("noona-kavita");
                setIfAvailable(managedKavitaUrl);
            } catch {
                const managedKavitaUrl = await fetchManagedServiceHostUrl("noona-kavita");
                setIfAvailable(managedKavitaUrl);
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
