"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Row, Spinner, Text} from "@once-ui-system/core";

type SetupStatus = {
    completed: boolean;
};

type SetupWizardGateProps = {
    children: React.ReactNode;
};

export function SetupWizardGate({children}: SetupWizardGateProps) {
    const router = useRouter();
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setReady(false);
            setError(null);

            try {
                const setupRes = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const setupJson = (await setupRes.json().catch(() => null)) as SetupStatus | null;
                if (cancelled) return;

                const completed = setupJson?.completed === true;
                if (completed) {
                    router.replace("/");
                    return;
                }
                setReady(true);
            } catch (error_) {
                if (cancelled) return;
                const message = error_ instanceof Error ? error_.message : String(error_);
                setError(message || "Unable to prepare setup wizard.");
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [router]);

    if (ready) {
        return <>{children}</>;
    }

    if (error) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Text onBackground="danger-strong">{error}</Text>
            </Row>
        );
    }

    return (
        <Row fillWidth horizontal="center" paddingY="64">
            <Spinner/>
        </Row>
    );
}
