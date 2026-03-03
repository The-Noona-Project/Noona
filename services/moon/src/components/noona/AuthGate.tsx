"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";
import {hasMoonPermission, MOON_PERMISSION_LABELS, type MoonPermission} from "@/utils/moonPermissions";

type AuthStatus = {
    user?: {
        permissions?: string[] | null;
    } | null;
    error?: string;
};

type AuthGateProps = {
    children: React.ReactNode;
    requiredPermission?: MoonPermission;
    deniedMessage?: string;
};

export function AuthGate({children, requiredPermission, deniedMessage}: AuthGateProps) {
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

    if (requiredPermission && !hasMoonPermission(status.user?.permissions, requiredPermission)) {
        const permissionLabel = MOON_PERMISSION_LABELS[requiredPermission];
        return (
            <Column maxWidth="m" horizontal="center" gap="16" paddingY="24">
                <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                    <Column gap="8">
                        <Heading as="h2" variant="heading-strong-l">
                            Access denied
                        </Heading>
                        <Text>
                            {deniedMessage || `This page requires ${permissionLabel}.`}
                        </Text>
                    </Column>
                </Card>
            </Column>
        );
    }

    return <>{children}</>;
}
