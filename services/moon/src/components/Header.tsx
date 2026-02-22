"use client";

import {usePathname} from "next/navigation";
import {useEffect, useState} from "react";

import {Fade, Flex, Line, Row, ToggleButton} from "@once-ui-system/core";

import {display, person, routes} from "@/resources";
import {ThemeToggle} from "./ThemeToggle";
import styles from "./Header.module.scss";

type TimeDisplayProps = {
    timeZone: string;
    locale?: string; // Optionally allow locale, defaulting to 'en-GB'
};

const TimeDisplay: React.FC<TimeDisplayProps> = ({timeZone, locale = "en-GB"}) => {
    const [currentTime, setCurrentTime] = useState("");

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                timeZone,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            };
            const timeString = new Intl.DateTimeFormat(locale, options).format(now);
            setCurrentTime(timeString);
        };

        updateTime();
        const intervalId = setInterval(updateTime, 1000);

        return () => clearInterval(intervalId);
    }, [timeZone, locale]);

    return <>{currentTime}</>;
};

export default TimeDisplay;

export const Header = () => {
    const pathname = usePathname() ?? "";
    const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;

        const loadSetup = async () => {
            try {
                const res = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as { completed?: unknown } | null;
                if (cancelled) return;

                if (json && typeof json.completed === "boolean") {
                    setSetupCompleted(json.completed);
                    return;
                }

                setSetupCompleted(false);
            } catch {
                if (cancelled) return;
                setSetupCompleted(false);
            }
        };

        void loadSetup();
        return () => {
            cancelled = true;
        };
    }, []);

    const setupLocked = setupCompleted !== true;
    const showSetup = setupLocked;
    const showMainNav = !setupLocked;

    return (
        <>
            <Fade s={{hide: true}} fillWidth position="fixed" height="80" zIndex={9}/>
            <Fade
                hide
                s={{hide: false}}
                fillWidth
                position="fixed"
                bottom="0"
                to="top"
                height="80"
                zIndex={9}
            />
            <Row
                fitHeight
                className={styles.position}
                position="sticky"
                as="header"
                zIndex={9}
                fillWidth
                padding="8"
                horizontal="center"
                data-border="rounded"
                s={{
                    position: "fixed",
                }}
            >
                <Row paddingLeft="12" fillWidth vertical="center" textVariant="body-default-s">
                    {display.location && <Row s={{hide: true}}>{person.location}</Row>}
                </Row>
                <Row fillWidth horizontal="center">
                    <Row
                        background="page"
                        border="neutral-alpha-weak"
                        radius="m-4"
                        shadow="l"
                        padding="4"
                        horizontal="center"
                        zIndex={1}
                    >
                        <Row gap="4" vertical="center" textVariant="body-default-s" suppressHydrationWarning>
                            {showMainNav && routes["/"] && (
                                <ToggleButton prefixIcon="home" href="/" selected={pathname === "/"}/>
                            )}
                            {showMainNav && routes["/libraries"] && (
                                <>
                                    <Row s={{hide: true}}>
                                        <ToggleButton
                                            prefixIcon="book"
                                            href="/libraries"
                                            label="Library"
                                            selected={pathname.startsWith("/libraries")}
                                        />
                                    </Row>
                                    <Row hide s={{hide: false}}>
                                        <ToggleButton
                                            prefixIcon="book"
                                            href="/libraries"
                                            selected={pathname.startsWith("/libraries")}
                                        />
                                    </Row>
                                </>
                            )}
                            {showMainNav && routes["/settings"] && (
                                <>
                                    <Row s={{hide: true}}>
                                        <ToggleButton
                                            prefixIcon="settings"
                                            href="/settings"
                                            label="Settings"
                                            selected={pathname.startsWith("/settings")}
                                        />
                                    </Row>
                                    <Row hide s={{hide: false}}>
                                        <ToggleButton
                                            prefixIcon="settings"
                                            href="/settings"
                                            selected={pathname.startsWith("/settings")}
                                        />
                                    </Row>
                                </>
                            )}
                            {routes["/setupwizard"] && showSetup && (
                                <>
                                    <Row s={{hide: true}}>
                                        <ToggleButton
                                            prefixIcon="rocket"
                                            href="/setupwizard"
                                            label="Setup"
                                            selected={pathname === "/setupwizard"}
                                        />
                                    </Row>
                                    <Row hide s={{hide: false}}>
                                        <ToggleButton
                                            prefixIcon="rocket"
                                            href="/setupwizard"
                                            selected={pathname === "/setupwizard"}
                                        />
                                    </Row>
                                </>
                            )}
                            {display.themeSwitcher && (
                                <>
                                    <Line background="neutral-alpha-medium" vert maxHeight="24"/>
                                    <ThemeToggle/>
                                </>
                            )}
                        </Row>
                    </Row>
                </Row>
                <Flex fillWidth horizontal="end" vertical="center">
                    <Flex
                        paddingRight="12"
                        horizontal="end"
                        vertical="center"
                        textVariant="body-default-s"
                        gap="20"
                    >
                        <Flex s={{hide: true}}>
                            {display.time && <TimeDisplay timeZone={person.location}/>}
                        </Flex>
                    </Flex>
                </Flex>
            </Row>
        </>
    );
};
