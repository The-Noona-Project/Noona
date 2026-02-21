"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Row, Spinner} from "@once-ui-system/core";

type SetupStatus = {
    completed: boolean;
    error?: string;
};

type SetupWizardGateProps = {
    children: React.ReactNode;
};

export function SetupWizardGate({children}: SetupWizardGateProps) {
    const router = useRouter();
    const [setup, setSetup] = useState<SetupStatus | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const res = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as SetupStatus | null;
                if (cancelled) return;

                if (json && typeof json.completed === "boolean") {
                    setSetup(json);
                    return;
                }

                setSetup({completed: false, error: "Unable to determine setup status."});
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setSetup({completed: false, error: message});
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (setup?.completed === true) {
            router.replace("/");
        }
    }, [router, setup]);

    if (!setup) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Spinner/>
            </Row>
        );
    }

    if (setup.completed === true) {
        return null;
    }

    return <>{children}</>;
}

