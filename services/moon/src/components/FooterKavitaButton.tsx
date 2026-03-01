"use client";

import {useEffect, useState} from "react";
import {Button} from "@once-ui-system/core";

type KavitaInfoResponse = {
    baseUrl?: string | null;
};

export function FooterKavitaButton() {
    const [baseUrl, setBaseUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const response = await fetch("/api/noona/portal/kavita/info", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as KavitaInfoResponse | null;
                if (!response.ok || cancelled) {
                    return;
                }

                const nextUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
                if (nextUrl) {
                    setBaseUrl(nextUrl);
                }
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
