"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Button, Card, Column, Row, Spinner, Text} from "@once-ui-system/core";
import {buildBootScreenHref, normalizeSetupStatus} from "./setupStatus.mjs";

type SetupStatus = {
    completed: boolean;
    manualBootRequired?: boolean;
    error?: string;
};

type SetupModeGateProps = {
    children: React.ReactNode;
};

const normalizeError = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;

export function SetupModeGate({children}: SetupModeGateProps) {
    const router = useRouter();
    const [setup, setSetup] = useState<SetupStatus | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);

            try {
                const setupRes = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const setupJson = normalizeSetupStatus(await setupRes.json().catch(() => null)) as SetupStatus;
                if (cancelled) return;

                const completed = setupJson?.completed === true;
                if (completed) {
                    if (setupJson?.manualBootRequired === true) {
                        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
                        router.replace(buildBootScreenHref(returnTo));
                        return;
                    }

                    setSetup({completed: true, manualBootRequired: false});
                    setLoading(false);
                    return;
                }
                router.replace("/setupwizard");
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setSetup({completed: false, error: normalizeError(message, "Unable to determine setup status.")});
                setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [router]);

    if (loading) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Spinner/>
            </Row>
        );
    }

    if (setup?.completed === true) {
        return <>{children}</>;
    }

    return (
        <Column maxWidth="m" horizontal="center" gap="16" paddingY="24">
            <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                <Column gap="12">
                    <Text onBackground="danger-strong">
                        {setup?.error || "Unable to determine setup mode."}
                    </Text>
                    <Button variant="secondary" onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </Column>
            </Card>
        </Column>
    );
}
