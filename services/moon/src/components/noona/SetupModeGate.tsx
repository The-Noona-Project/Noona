"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Row, Spinner, Text} from "@once-ui-system/core";

type SetupStatus = {
    completed: boolean;
    error?: string;
};

type SetupModeGateProps = {
    children: React.ReactNode;
};

export function SetupModeGate({children}: SetupModeGateProps) {
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
        if (setup && setup.completed === false && !setup.error) {
            router.replace("/setupwizard");
        }
    }, [router, setup]);

    if (!setup) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Spinner/>
            </Row>
        );
    }

    if (setup.completed === false) {
        return (
            <Column maxWidth="m" horizontal="center" gap="16" paddingY="24">
                <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                    <Column gap="12">
                        <Row gap="8" vertical="center">
                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                Setup required
                            </Badge>
                            <Text onBackground="neutral-weak">Noona is not configured yet.</Text>
                        </Row>
                        {setup.error && <Text onBackground="danger-strong">{setup.error}</Text>}
                        <Button variant="primary" onClick={() => router.push("/setupwizard")}>
                            Open setup wizard
                        </Button>
                    </Column>
                </Card>
            </Column>
        );
    }

    return <>{children}</>;
}

