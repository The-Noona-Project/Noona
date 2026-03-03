"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Row, Spinner, Text} from "@once-ui-system/core";

type AuthStatus = {
    user?: unknown;
    error?: string;
};

type AuthGateProps = {
    children: React.ReactNode;
};

export function AuthGate({children}: AuthGateProps) {
    const router = useRouter();
    const [status, setStatus] = useState<AuthStatus | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as AuthStatus | null;
                if (cancelled) return;

                if (res.ok) {
                    setStatus(json ?? {});
                    return;
                }

                if (res.status === 401) {
                    router.replace("/login");
                    return;
                }

                const message = typeof json?.error === "string" && json.error.trim()
                    ? json.error.trim()
                    : `Auth check failed (HTTP ${res.status}).`;
                setStatus({error: message});
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setStatus({error: message});
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [router]);

    if (!status) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Spinner/>
            </Row>
        );
    }

    if (status.error) {
        return (
            <Row fillWidth horizontal="center" paddingY="64">
                <Text onBackground="danger-strong">{status.error}</Text>
            </Row>
        );
    }

    return <>{children}</>;
}

