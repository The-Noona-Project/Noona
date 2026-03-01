"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";
import {Badge, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";

type SetupStatus = {
    completed?: boolean;
};

export function SignupPage() {
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;

        const redirect = async () => {
            try {
                const response = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as SetupStatus | null;
                if (cancelled) return;

                if (payload?.completed === true) {
                    router.replace("/login");
                    return;
                }

                router.replace("/setupwizard");
            } catch {
                if (!cancelled) {
                    router.replace("/setupwizard");
                }
            }
        };

        void redirect();
        return () => {
            cancelled = true;
        };
    }, [router]);

    return (
        <Column maxWidth="s" horizontal="center" gap="16" paddingY="32">
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                <Column gap="16">
                    <Column gap="8">
                        <Row gap="8" vertical="center">
                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                Noona
                            </Badge>
                            <Heading as="h1" variant="heading-strong-l">
                                Redirecting to setup
                            </Heading>
                        </Row>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Moon no longer exposes username/password signup. The initial superuser is created from the
                            setup summary with Discord OAuth.
                        </Text>
                    </Column>
                    <Row fillWidth horizontal="center" paddingY="16">
                        <Spinner/>
                    </Row>
                </Column>
            </Card>
        </Column>
    );
}
